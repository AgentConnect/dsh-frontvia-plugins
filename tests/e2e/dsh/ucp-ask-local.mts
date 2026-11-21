import assert from 'node:assert/strict'
import { createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolsService } from '@deepseek-ai/dsh-tools'
import { CustomerService } from '../../../packages/customer/src/core.js'
import { Pap03Business } from '../../../packages/customer/src/pap03-business.js'
import { Vault } from '../../../packages/customer/src/state.js'
import { tools } from '../../../packages/customer/src/tools.js'

const { FRONTVIA_PAP_TEST_PACKAGE_ROOT } = process.env
const settingsPath = process.argv[2]
assert(FRONTVIA_PAP_TEST_PACKAGE_ROOT && settingsPath, 'Set PAP source root and pass the Commerce TLS fixture ready JSON')
const papRoot = resolve(FRONTVIA_PAP_TEST_PACKAGE_ROOT)
const { fixture } = await import(pathToFileURL(join(papRoot, 'tests/helpers/product-fixture.ts')).href)
const { SafeHttpsTransport } = await import(pathToFileURL(join(papRoot, 'src/network.ts')).href)
const { origin: merchant, disabledOrigin: disabledMerchant, platformProfile, ca, scratch } = JSON.parse(await readFile(settingsPath, 'utf8'))
const platform = new URL(platformProfile).origin
const origins = [merchant, disabledMerchant, platform]
assert(origins.every(origin => new URL(origin).protocol === 'https:'))
const capability = 'dev.ucp.common.ask'
const require = createRequire(import.meta.url)
const dshRequire = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const nativeExecutor = await import(pathToFileURL(dshRequire.resolve('@deepseek-ai/dsh-tool-executor-native')).href)

function decodeJwt(token: string) {
  const entries = token.split('.')
  assert.equal(entries.length, 3)
  const [header, payload, signature] = entries
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(payload, 'base64url').toString()),
    input: Buffer.from(`${header}.${payload}`),
    signature: Buffer.from(signature, 'base64url'),
  }
}

function assertSignedAsk(headers: Headers, address: string, identityPublicKey: ReturnType<typeof createPublicKey>) {
  assert.equal(headers.get('poppy-version'), '1.0')
  assert.equal(headers.get('ucp-agent'), `profile="${platformProfile}"`)
  assert.match(headers.get('idempotency-key') ?? '', /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i)
  assert(!headers.has('authorization'))
  const session = decodeJwt(headers.get('poppy-session')!)
  const delegation = decodeJwt(session.header.poppy_dlg)
  const verifySignature = (value: ReturnType<typeof decodeJwt>, key: ReturnType<typeof createPublicKey>) =>
    verify('sha256', value.input, { key, dsaEncoding: 'ieee-p1363' }, value.signature)
  assert(verifySignature(delegation, identityPublicKey), 'PAP delegation signature')
  const sessionKey = createPublicKey({key: delegation.claims.cnf.jwk, format: 'jwk'})
  assert(verifySignature(session, sessionKey), 'PAP session signature')
  assert.equal(session.claims.htm, 'POST')
  assert.equal(session.claims.htu, address)
  assert.equal(session.claims.aud, merchant)
}

test('DSH buyer Agent discovers and continues a public UCP Ask against the test store', async (t) => {
  const network = new SafeHttpsTransport({
    ca: await readFile(ca),
    privateOrigins: origins,
    lookup: async (hostname: string) => {
      assert(origins.some(origin => new URL(origin).hostname === hostname))
      return [{ address: '127.0.0.1', family: 4 }]
    },
  })
  type Transfer = {
    address: string
    method: string
    status: number
    headers: Headers
    body?: Record<string, unknown>
    answer?: { plain: string }
    conversation?: { id: string; expires_at?: string }
    links?: { type: string; url: string }[]
    messages?: { type: string; code: string }[]
  }
  const requests: Transfer[] = []
  const transport = { async request(address: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) {
    const result = await network.request(address, options)
    const isAsk = new URL(address).pathname.endsWith('/ask')
    requests.push({
      address,
      method: options?.method ?? 'GET',
      headers: new Headers(options?.headers),
      status: result.status,
      ...(isAsk && options?.body ? { body: JSON.parse(options.body) } : {}),
      ...(isAsk && result.status === 200 ? (() => {
        const { answer, conversation, links, messages, ucp } = JSON.parse(result.body.toString())
        assert.equal(ucp.version, '2026-08-25')
        assert(ucp.capabilities[capability].some((entry: {version: string}) => entry.version === '2026-08-25'))
        return { answer, conversation, links, messages }
      })() : {}),
    })
    return result
  } }
  const pap = await fixture(t, { autoConnect: true, businessConsumers: ['example/shop'], transport, ucpPlatformProfileUrl: platformProfile })
  await writeFile(join(scratch, 'fixture-client.jwk.json'), JSON.stringify(pap.host.identity.jwk), {mode: 0o600})
  const consumer = [...pap.loader.entries()].find((entry: { options: { name: string } }) => entry.options.name === 'example/shop')
  assert(consumer?.fiber?.ctx)
  const sdk = pap.service.acquireBusiness(consumer.fiber.ctx)
  const key = randomBytes(32).toString('base64url')
  const vaultPath = join(pap.root, 'customer.sqlite')
  let vault = new Vault(vaultPath, key)
  t.after(() => vault.close())
  const makeCustomer = () => new CustomerService({ dataDir: pap.root, sites: [] }, new Pap03Business(sdk), vault)
  const context = new Context()
  await context.plugin(SystemPrompt, {})
  await context.plugin(ToolsService)
  await context.plugin(nativeExecutor)
  t.after(() => context.fiber.dispose())
  const registry = context.tools
  const registerCustomer = (customer: CustomerService) => {
    const remove = tools(customer).map(tool => registry.register(tool as Parameters<typeof registry.register>[0]))
    return () => remove.forEach(dispose => dispose())
  }
  let unregisterCustomer = registerCustomer(makeCustomer())
  type ToolResult = {
    error?: { code?: string }
    flowId?: string
    source?: string
    untrusted?: boolean
    answer?: string
    links?: {type: string; url: string}[]
    capabilities?: {methods?: {method: string; availability: string}[]}
  }
  const execute = async (topic: string, name: string, args: Record<string, unknown>, callId = randomUUID()): Promise<ToolResult> => {
    assert(registry.get(name), `Registered DSH buyer tool ${name}`)
    type Batch = Parameters<typeof registry.execute>[0]
    const call = { type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) } as Batch['calls'][number]
    const { results } = await registry.execute({ calls: [call], agent: { id: topic } as Batch['agent'], signal: t.signal })
    assert.equal(results.length, 1)
    const result = results[0].result
    assert(!result.isError, JSON.stringify(result.content))
    assert(result.value && typeof result.value === 'object' && !Array.isArray(result.value))
    return result.value as ToolResult
  }
  const connect = async (topic: string, origin: string, supportsAsk = true): Promise<string> => {
    const result = await execute(topic, 'frontvia_connection', { action: 'connect', domain: new URL(origin).host })
    assert(!result.error, JSON.stringify(result.error))
    assert.equal(typeof result.flowId, 'string')
    assert.equal(result.capabilities?.methods?.some(method => method.method === 'ucp.ask' && method.availability === 'supported'), supportsAsk)
    return result.flowId!
  }
  const ask = (topic: string, flowId: string, query: string, callId?: ReturnType<typeof randomUUID>) =>
    execute(topic, 'frontvia_ask', { action: 'ask', flowId, query }, callId)
  const asked = () => requests.filter(item => item.method === 'POST' && new URL(item.address).pathname.endsWith('/ask'))
  const topic = 'ask-topic-a'
  const flowId = await connect(topic, merchant)
  assert(requests.some(item => item.address === `${merchant}/.well-known/ucp` && item.method === 'GET' && item.status === 200))
  assert(requests.some(item => item.address === platformProfile && item.method === 'GET' && item.status === 200))
  const operationList = await sdk.operations()
  assert(operationList.ok)
  assert(operationList.value.some((op: { operationId: string; method: string; channel: string; requiresApproval: boolean }) =>
    op.operationId === 'ask_business' && op.method === 'POST' && op.channel === 'ucp' && op.requiresApproval === false))

  const question = 'What material is the Trail Mug made from?'
  const initialCallId = randomUUID()
  const first = await ask(topic, flowId, question, initialCallId)
  assert(!first.error, JSON.stringify(first.error))
  assert.equal(first.source, 'merchant')
  assert.equal(first.untrusted, true)
  assert.match(first.answer ?? '', /stainless steel/i)
  const initial = asked().at(-1)!
  assert.equal(initial.status, 200)
  assert.equal(initial.body?.query, question)
  assert.equal(initial.body?.conversation, undefined)
  assert.equal(first.answer, initial.answer?.plain)
  assert(initial.conversation?.id, 'Shop-issued conversation id')
  const beforeReplay = asked().length
  assert.deepEqual(await ask(topic, flowId, question, initialCallId), first)
  assert.equal(asked().length, beforeReplay, 'A retried tool call returns its original saved answer')

  // Reload the regular Customer state from its encrypted SQLite store.
  unregisterCustomer()
  vault.close()
  vault = new Vault(vaultPath, key)
  unregisterCustomer = registerCustomer(makeCustomer())
  const followup = 'How much does it hold?'
  const capacity = await ask(topic, flowId, followup)
  assert(!capacity.error, JSON.stringify(capacity.error))
  assert.match(capacity.answer ?? '', /350\s*ml/i)
  const continued = asked().at(-1)!
  assert.equal(continued.body?.query, followup)
  assert.equal(continued.body?.ids, undefined)
  assert.equal((continued.body?.conversation as { id: string })?.id, initial.conversation.id)
  assert.equal(continued.conversation?.id, initial.conversation.id)
  const beforeStaleReplay = asked().length
  assert.equal((await ask(topic, flowId, question, initialCallId)).error?.code, 'UCP_ASK_CALL_SUPERSEDED')
  assert.equal(asked().length, beforeStaleReplay, 'Replaying a superseded call cannot append to the conversation')

  const policy = await ask(topic, flowId, 'What is your return policy?')
  assert(!policy.error, JSON.stringify(policy.error))
  assert.match(policy.answer ?? '', /14[\s–-]*days?/i)
  assert(policy.links?.some(link => link.type === 'refund_policy' && new URL(link.url).origin === merchant))
  const shipping = await ask(topic, flowId, 'How long does shipping take?')
  assert(!shipping.error, JSON.stringify(shipping.error))
  assert.match(shipping.answer ?? '', /2\s*(?:[-–—]|to)\s*4\s*business days/i)
  const policyFollowup = await ask(topic, flowId, 'How long does that take?')
  assert(!policyFollowup.error, JSON.stringify(policyFollowup.error))
  assert.match(policyFollowup.answer ?? '', /2\s*(?:[-–—]|to)\s*4\s*business days/i)
  assert(policyFollowup.links?.some(link => link.type === 'shipping_policy' && new URL(link.url).origin === merchant))
  const policyContinued = asked().at(-1)!
  assert.equal(policyContinued.body?.ids, undefined)
  assert.equal((policyContinued.body?.conversation as { id: string })?.id, initial.conversation.id)

  const prohibited = await ask(topic, flowId, 'Add two Trail Mugs to my cart.')
  assert(!prohibited.error, JSON.stringify(prohibited.error))
  assert.match(prohibited.answer ?? '', /no shopping or account action was performed/i)
  assert(asked().at(-1)?.messages?.some(message => message.code === 'operation_not_performed'))

  const priorCount = asked().length
  const wrongTopic = await ask('ask-topic-b', flowId, followup)
  assert.equal(wrongTopic.error?.code, 'FLOW_NOT_OWNED')
  assert.equal(asked().length, priorCount, 'A topic cannot send a turn through another topic’s flow')
  const separateFlow = await connect('ask-topic-b', merchant)
  assert.notEqual(separateFlow, flowId)
  const other = await ask('ask-topic-b', separateFlow, 'What is your return policy?')
  assert(!other.error, JSON.stringify(other.error))
  const unrelated = asked().at(-1)!
  assert.equal(unrelated.body?.conversation, undefined)
  assert.notEqual(unrelated.conversation?.id, initial.conversation.id)

  const disabledFlow = await connect(topic, disabledMerchant, false)
  assert(requests.some(item => item.address === `${disabledMerchant}/.well-known/ucp` && item.status === 200))
  const beforeDisabled = asked().length
  const unavailable = await ask(topic, disabledFlow, question)
  assert.equal(unavailable.error?.code, 'UCP_ASK_UNAVAILABLE')
  assert.equal(asked().length, beforeDisabled)

  const writes = requests.filter(item => !['GET', 'HEAD'].includes(item.method))
  assert.deepEqual(writes, asked(), 'All outbound non-GET requests were to UCP Ask')
  for (const request of asked()) {
    assert.equal(new URL(request.address).origin, merchant)
    assertSignedAsk(request.headers, request.address, pap.host.identity.publicKey)
  }
  unregisterCustomer()
})
