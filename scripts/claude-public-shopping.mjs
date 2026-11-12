/** One real Claude Code/DeepSeek domain-browsing check against installed tools. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {guidance} from '../packages/customer/src/tools.ts';

export async function checkClaudeDomain({domain,execute,definitions,privateDir}){
  assert(process.env.DEEPSEEK_API_KEY,'Task DeepSeek credential required');
  const sdk=resolve(import.meta.dirname,'../../frontvia-core/web/node_modules/@modelcontextprotocol/sdk/dist/esm');
  const {Server}=await import(pathToFileURL(join(sdk,'server/index.js')).href);
  const {StreamableHTTPServerTransport}=await import(pathToFileURL(join(sdk,'server/streamableHttp.js')).href);
  const {ListToolsRequestSchema,CallToolRequestSchema}=await import(pathToFileURL(join(sdk,'types.js')).href);
  const allowed=new Set(['frontvia_connection','frontvia_products']);
  const visible=definitions.filter(tool=>allowed.has(tool.name));
  assert.equal(visible.length,2);
  const calls=[];let listings=0;
  const mcp=new Server({name:'frontvia-core-acceptance',version:'1.0.0'},{capabilities:{tools:{}}});
  mcp.setRequestHandler(ListToolsRequestSchema,async()=>{listings++;return {tools:visible.map(tool=>({name:tool.name,description:tool.description,inputSchema:{type:'object',properties:tool.parameters.properties,required:tool.parameters.required,additionalProperties:false}}))};});
  mcp.setRequestHandler(CallToolRequestSchema,async(request)=>{
    assert(allowed.has(request.params.name));
    const args=request.params.arguments??{};
    if(request.params.name==='frontvia_connection'&&args.action==='connect')assert.equal(args.domain,domain);
    const value=await execute(request.params.name,args);
    calls.push({name:request.params.name,args,value});
    return {content:[{type:'text',text:JSON.stringify(value)}]};
  });
  const token=randomBytes(32).toString('base64url');
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=>randomUUID()});
  await mcp.connect(transport);
  const server=http.createServer(async(request,response)=>{
    if(request.url!=='/mcp'||request.headers.authorization!=='Bearer '+token){response.writeHead(403);response.end();return;}
    try{
      const chunks=[];let size=0;
      for await(const chunk of request){size+=chunk.length;if(size>131072){response.writeHead(413);response.end();return;}chunks.push(chunk);}
      const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
      await transport.handleRequest(request,response,body);
    }catch{if(!response.headersSent)response.writeHead(500);response.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{
    const config=join(privateDir,'claude-mcp.json'),state=join(privateDir,'claude-state');
    await mkdir(state,{mode:0o700});
    await writeFile(config,JSON.stringify({mcpServers:{frontvia:{type:'http',url:`http://127.0.0.1:${server.address().port}/mcp`,headers:{Authorization:'Bearer '+token}}}}),{mode:0o600});
    const prompt=`去 ${domain} 看一下有哪些商品。请实际调用连接工具按这个域名连接，再调用商品 browse 工具，只原样列出真实返回的商品名称和价格。不要下单，不要索取其他链接或账号。`;
    const args=['--print','--output-format','stream-json','--verbose','--model','deepseek-flash[1m]',
      '--strict-mcp-config','--mcp-config',config,'--allowedTools','mcp__frontvia__frontvia_connection,mcp__frontvia__frontvia_products,ToolSearch',
      '--tools','default','--disallowedTools','Agent,Task,Bash,Read,Write,Edit,MultiEdit,Glob,Grep,NotebookEdit,WebFetch,WebSearch,TodoWrite,AskUserQuestion,EnterPlanMode,ExitPlanMode,EnterWorktree,ExitWorktree,TaskCreate,TaskUpdate,TaskGet,TaskList,TaskOutput,TaskStop,Skill,ToolSearch,CronCreate,CronDelete,CronList,ListAgents,ReportFindings,ScheduleWakeup,SendMessage,Workflow','--permission-mode','dontAsk','--system-prompt',guidance,'--no-session-persistence','--disable-slash-commands','--setting-sources','',prompt];
    const child=spawn('claude',args,{cwd:privateDir,env:{...process.env,CLAUDE_CONFIG_DIR:state,
      ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic',ANTHROPIC_MODEL:'deepseek-flash[1m]',
      ANTHROPIC_API_KEY:process.env.DEEPSEEK_API_KEY,ANTHROPIC_AUTH_TOKEN:process.env.DEEPSEEK_API_KEY,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',ENABLE_TOOL_SEARCH:'false'},stdio:['ignore','pipe','pipe']});
    let stdout='',pendingOutput='',unexpectedTools=false;
    child.stdout.on('data',chunk=>{
      stdout+=chunk;pendingOutput+=chunk;
      let newline;while((newline=pendingOutput.indexOf('\n'))!==-1){
        const line=pendingOutput.slice(0,newline);pendingOutput=pendingOutput.slice(newline+1);
        try{const event=JSON.parse(line);if(event.type==='system'&&event.subtype==='init'&&event.tools?.some(name=>!['mcp__frontvia__frontvia_connection','mcp__frontvia__frontvia_products'].includes(name))){unexpectedTools=true;child.kill('SIGTERM');}}catch{}
      }
    });child.stderr.resume();
    const timer=setTimeout(()=>child.kill('SIGTERM'),180000);
    let exit;
    try{exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});}finally{clearTimeout(timer);}
    assert(!unexpectedTools,'unexpected_claude_tools_exposed');
    assert.equal(exit,0,'claude_domain_browsing_failed');
    const events=stdout.split('\n').filter(Boolean).map(line=>JSON.parse(line));
    const result=events.findLast(event=>event.type==='result');
    assert(result,'claude_result_missing');
    assert(!result.is_error,'claude_domain_browsing_failed');
    if(!calls.some(call=>call.name==='frontvia_connection'&&call.args.action==='connect'&&call.args.domain===domain)){
      console.log(JSON.stringify({case:'claude-domain-browsing-diagnostic',toolListings:listings,toolCalls:calls.length,subtype:result.subtype,mcp:events.find(event=>event.type==='system'&&event.subtype==='init')?.mcp_servers,tools:events.find(event=>event.type==='system'&&event.subtype==='init')?.tools,reply:String(result.result).slice(0,400)}));
      throw Error('claude_domain_connection_tool_not_used');
    }
    const browse=calls.find(call=>call.name==='frontvia_products'&&call.args.action==='browse'&&call.value.data?.items?.length);
    assert(browse,'Claude must read actual products');
    assert(String(result.result).includes(browse.value.data.items[0].title),'Claude must name a returned product');
    return {status:'passed',case:'claude-deepseek-domain-only-real-product-browsing',model:'deepseek-flash[1m]',
      toolCalls:calls.length,products:browse.value.data.items.length};
  }finally{
    await mcp.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
}
