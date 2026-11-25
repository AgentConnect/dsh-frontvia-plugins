import assert from 'node:assert/strict';
import {readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {caseFingerprint} from './network.mjs';

const SUITE='dsh-ucp-full-e2e';
const EMAIL='ucp-full-flow@example.test';

async function protocolTrace(logPath){
  const output=await readFile(logPath,'utf8');
  return output.split('\n').slice(0,-1)
    .filter(line=>line.startsWith('{"event":"frontvia-e2e-http"')).map(line=>JSON.parse(line));
}

async function observeFacts(commerce,phase,orderId,timeout=30000){
  const request=join(commerce.controlDir,phase+'.request');
  await writeFile(request+'.tmp',JSON.stringify({orderId}),{mode:0o600});
  await rename(request+'.tmp',request);
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    try{return JSON.parse(await readFile(join(commerce.controlDir,phase+'.json'),'utf8'));}
    catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
    await delay(50);
  }
  throw Error('owned_ucp_full_flow_facts_timeout');
}

async function openOriginalAftersales(page,domain,orderId){
  const storefront=page.getByRole('region',{name:'Frontvia 服务页面',exact:true});
  if(!await storefront.isVisible())await page.getByRole('button',{name:'Frontvia 服务',exact:true}).click({timeout:30000});
  const orderTab=storefront.getByRole('tab',{name:'我的订单',exact:true});
  const merchant=storefront.locator('.fv-store-card').filter({has:page.getByText(domain,{exact:true})});
  const enter=merchant.getByRole('button',{name:/^进入店铺：/});
  await orderTab.or(enter).first().waitFor({timeout:60000});
  if(!await orderTab.isVisible())await enter.click({timeout:60000});
  await orderTab.click({timeout:60000});
  const orders=storefront.getByRole('list',{name:'订单列表',exact:true});
  const original=orders.getByRole('listitem').filter({has:page.locator(`h4[title="${orderId}"]`)});
  await original.getByRole('button',{name:/^查看详情：/}).click({timeout:60000});
  const aftersales=storefront.getByRole('button',{name:'查看售后',exact:true});
  if(!await storefront.getByText('订单售后',{exact:true}).isVisible())await aftersales.click({timeout:60000});
  return storefront;
}

function assertOriginalRead(trace,orderId,caseId){
  assert(trace.some(entry=>entry.pap10&&entry.operationsV3&&entry.method==='GET'&&
    entry.originalCase===caseFingerprint(orderId,caseId)),
    'DSH must read the same Commerce case from the original order');
}

async function merchantRefundReadback({page,commerce,logPath,orderId,caseId}){
  const settled=await observeFacts(commerce,'ucp-after-merchant-refund',orderId,240000);
  const {amountMinor,shippingMinor,currency}=commerce.merchantCancellation;
  assert.deepEqual(settled,{orderId,caseId,cancelCases:1,refunds:1,status:'canceled',stage:'refunded',
    reservations:0,amountMinor,shippingMinor,currency});
  const before=await protocolTrace(logPath);
  await page.reload({waitUntil:'domcontentloaded'});
  const storefront=await openOriginalAftersales(page,commerce.domain,orderId);
  await storefront.getByRole('heading',{name:'渠道已确认退款',exact:true}).waitFor({timeout:60000});
  assert.equal(await storefront.getByRole('button',{name:'核对并确认申请',exact:true}).count(),0);
  assertOriginalRead((await protocolTrace(logPath)).slice(before.length),orderId,caseId);
}

export async function readUcpAftersales({page,commerce,logPath}){
  const {orderId,caseId,state}=commerce.existingAftersales;
  const heading={pending_merchant:'等待店铺审核',waiting_return:'退货已同意',refunded:'渠道已确认退款'}[state];
  const started=performance.now();
  const storefront=await openOriginalAftersales(page,commerce.domain,orderId);
  await storefront.getByRole('heading',{name:heading,exact:true}).waitFor({timeout:60000});
  const trace=await protocolTrace(logPath);
  assertOriginalRead(trace,orderId,caseId);
  assert(!trace.some(entry=>entry.method==='POST'&&(/^(carts|checkout-sessions|aftersales\/)/.test(entry.operation))),
    'Opening an existing case must not submit an order or an application');
  if(commerce.merchantCancellation){
    assert.deepEqual(await observeFacts(commerce,'ucp-aftersales-reopened',orderId),{orderId,caseId,cancelCases:1,refunds:0});
  }
  console.log(JSON.stringify({suite:SUITE,case:'DSH-UCP-FULL-004-original-order-aftersales-reopen',
    status:'passed',checkpoint:state,durationMs:Math.round(performance.now()-started)}));
  if(commerce.merchantCancellation){
    await merchantRefundReadback({page,commerce,logPath,orderId,caseId});
    console.log(JSON.stringify({suite:SUITE,case:'DSH-UCP-FULL-005-original-merchant-refund-readback',
      status:'passed',checkpoint:'buyer-refund-readback',durationMs:Math.round(performance.now()-started)}));
  }
}

export async function shopUcpFullFlow({page,commerce,logPath}){
  let currentCase='DSH-UCP-FULL-001-physical-draft-without-a-purchase';
  let started=performance.now(),otherContext, checkpoint='storefront';
  function result(status){
    console.log(JSON.stringify({suite:SUITE,case:currentCase,status,checkpoint,durationMs:Math.round(performance.now()-started)}));
    started=performance.now();
  }
  try{
    const before=await observeFacts(commerce,'ucp-before-shopping');
    const storefront=page.getByRole('region',{name:'Frontvia 服务页面',exact:true});
    const merchant=storefront.locator('.fv-store-card').filter({has:page.getByText(commerce.domain,{exact:true})});
    await merchant.getByRole('button',{name:/^进入店铺：/}).click({timeout:60000});
    const product=storefront.locator('.fv-catalog-item').filter({has:page.getByText(commerce.productTitle,{exact:true})});
    await product.getByRole('button',{name:'查看详情',exact:true}).click({timeout:60000});
    await storefront.getByRole('button',{name:'加入购物车',exact:true}).first().click({timeout:60000});
    await storefront.getByRole('tab',{name:'购物车 (1)',exact:true}).click({timeout:60000});
    await storefront.getByRole('button',{name:'去结算',exact:true}).click();
    await storefront.getByRole('button',{name:'保存到结算草稿',exact:true}).waitFor({state:'visible',timeout:60000});
    const draft=await observeFacts(commerce,'ucp-after-draft');
    assert.equal(draft.carts,before.carts+1);
    assert.equal(draft.drafts,before.drafts+1);
    const beforePayment=commerce.liveStore?['handoffs','paymentSessions','orders','captured']:
      ['nativeCheckouts','quotas','paymentSessions','orders','captured'];
    for(const key of beforePayment)assert.equal(draft[key],before[key],key);
    result('passed');

    currentCase='DSH-UCP-FULL-002-owner-browser-pairing-and-explicit-confirmation';
    const shippingContact=commerce.liveStore ? commerce.testContact : {
      email:EMAIL,name:'Test Buyer',street:'1 Fixture Street',city:'San Francisco',region:'CA',postalCode:'94105',phone:'+12025550123',
    };
    for(const [label,value] of [
      [/^联系邮箱/,shippingContact.email],[/^收货人/,shippingContact.name],[/^完整收货地址/,shippingContact.street],
      [/^城市/,shippingContact.city],[/^省 \/ 州 \/ 地区/,shippingContact.region],[/^邮编/,shippingContact.postalCode],[/^联系电话/,shippingContact.phone],
    ])await storefront.getByLabel(label).fill(value);
    await storefront.getByRole('button',{name:'保存到结算草稿',exact:true}).click();
    await storefront.getByRole('button',{name:commerce.liveStore?commerce.shippingLabel:/标准配送|Owned UCP US shipment/}).first().click({timeout:60000});
    await page.bringToFront();
    checkpoint='prepare-click';
    await storefront.getByRole('button',{name:'核对并继续',exact:true}).click({timeout:60000});
    checkpoint='prepare-approval';
    await page.getByRole('button',{name:'允许本次操作',exact:true}).click({timeout:30000});
    const handoffLink=storefront.getByRole('link',{name:'在浏览器继续',exact:true});
    checkpoint='handoff-link';
    await handoffLink.waitFor({state:'visible',timeout:60000});
    checkpoint='handoff-popup';
    const [handoff]=await Promise.all([
      page.context().waitForEvent('page',{timeout:60000}),
      handoffLink.click({timeout:60000}),
    ]);
    checkpoint='handoff-challenge';
    await handoff.locator('#handoff-challenge').waitFor({state:'visible'});
    assert.equal(new URL(handoff.url()).origin,commerce.origin);
    assert.match(new URL(handoff.url()).pathname,/^\/ucp\/v1\/checkout-sessions\/[a-f0-9-]+\/handoff$/);
    otherContext=await page.context().browser().newContext();
    const other=await otherContext.newPage();
    await other.goto(handoff.url(),{waitUntil:'domcontentloaded'});
    checkpoint='foreign-copy';
    await other.getByText('等待浏览器授权',{exact:true}).waitFor();
    assert.equal(await other.locator('#handoff-confirm').isVisible(),false);
    const code=await handoff.locator('#handoff-challenge').inputValue();
    assert.match(code,/^[A-Za-z0-9_-]{43}$/);
    await page.bringToFront();
    await storefront.getByLabel('浏览器配对代码',{exact:true}).fill(code);
    checkpoint='pair-click';
    await storefront.getByRole('button',{name:'授权浏览器',exact:true}).click({timeout:60000});
    await page.getByRole('button',{name:'允许本次操作',exact:true}).click({timeout:30000});
    checkpoint='pair-result';
    await handoff.locator('#handoff-confirm').waitFor({state:'visible',timeout:60000});
    assert.equal(await other.locator('#handoff-confirm').isVisible(),false);
    const beforeConfirm=await observeFacts(commerce,'ucp-before-browser-confirm');
    const checkoutFact=commerce.liveStore?'handoffs':'nativeCheckouts';
    assert.equal(beforeConfirm[checkoutFact],before[checkoutFact]+1);
    assert.equal(beforeConfirm.orders,before.orders);
    assert.equal(beforeConfirm.captured,before.captured);
    if(commerce.liveStore&&commerce.merchantCancellation){
      const {amountMinor,currency}=commerce.merchantCancellation;
      const digits=amountMinor.padStart(3,'0');
      assert.equal((await handoff.locator('#handoff-amount').innerText()).trim(),
        `${currency} ${digits.slice(0,-2)}.${digits.slice(-2)}`);
    }
    await handoff.locator('#handoff-confirm').click();
    checkpoint='order-result';
    await handoff.locator('#handoff-order').waitFor({state:'visible',timeout:90000});
    await handoff.locator('#handoff-order').click();
    checkpoint='order-support';
    await handoff.getByRole('heading',{name:'商品与金额',exact:true}).waitFor({state:'visible'});
    const support=handoff.getByRole('region',{name:'订单咨询与客服',exact:true});
    const contact=support.getByRole('link',{name:'联系客服',exact:true});
    await contact.waitFor({state:'visible'});
    const supportUrl=new URL(await contact.getAttribute('href'),handoff.url());
    assert.equal(supportUrl.origin,commerce.origin);
    assert.equal(supportUrl.pathname,'/');
    assert(supportUrl.searchParams.get('support_order'),'Support retains the order number');
    assert.equal(await support.locator('form').count(),0);
    assert.equal(await other.locator('#handoff-order').isVisible(),false);
    const done=await observeFacts(commerce,'ucp-after-full-purchase');
    for(const key of beforePayment)assert.equal(done[key],before[key]+1,key);
    result('passed');

    currentCase='DSH-UCP-FULL-003-refresh-preserves-the-original-transaction';
    checkpoint='order-list-restore';
    const originalOrder=/^\/ucp\/v1\/orders\/([a-f0-9-]{36})\/view$/.exec(new URL(handoff.url()).pathname)?.[1];
    assert(originalOrder,'The protected browser used the original UCP Order');
    await page.bringToFront();
    await page.reload({waitUntil:'domcontentloaded'});
    if(!await storefront.isVisible())await page.getByRole('button',{name:'Frontvia 服务',exact:true}).click({timeout:30000});
    await storefront.getByRole('tab',{name:'我的订单',exact:true}).click({timeout:60000});
    const orders=storefront.getByRole('list',{name:'订单列表',exact:true});
    const original=orders.getByRole('listitem').filter({has:page.locator(`h4[title="${originalOrder}"]`)});
    await original.getByRole('button',{name:/^查看详情：/}).click({timeout:60000});
    await storefront.getByRole('heading',{name:'订单详情',exact:true}).waitFor({state:'visible',timeout:60000});
    const restored=await observeFacts(commerce,'ucp-after-browser-refresh');
    assert.deepEqual(restored,done,'Reload did not re-create the accepted transaction');
    const http=await protocolTrace(logPath);
    for(const [method,operation] of [
      ['POST','catalog/search'],['POST','carts'],['POST','checkout-sessions'],
      ['PUT','checkout-sessions/:id'],['POST','checkout-sessions/:id/prepare'],['POST','checkout-sessions/:id/handoff/approve'],['GET','orders/:id'],
    ])assert(http.some(request=>request.pap10&&request.method===method&&request.operation===operation&&request.status<300),`Missing PAP 1.0 ${method} ${operation}`);
    result('passed');

    currentCase='DSH-UCP-FULL-004-original-order-aftersales-approval-and-reopen';
    await page.setViewportSize({width:390,height:844});
    const openAftersales=async()=>{
      await storefront.getByRole('button',{name:'查看售后',exact:true}).click({timeout:60000});
      await storefront.getByText('订单售后',{exact:true}).waitFor({state:'visible'});
    };
    checkpoint='aftersales-original-card';
    await openAftersales();
    await storefront.getByRole('heading',{name:'取消整张订单',exact:true}).waitFor({timeout:60000});
    await storefront.getByRole('textbox',{name:'申请原因',exact:true}).fill('I placed this test order by mistake');
    await storefront.getByRole('button',{name:'核对并确认申请',exact:true}).click();
    checkpoint='aftersales-host-approval';
    const approval=page.getByRole('dialog',{name:'确认本次操作',exact:true});
    const approvalButton=approval.getByRole('button',{name:'允许本次操作',exact:true});
    await approvalButton.waitFor({timeout:60000});
    if(!(await approval.innerText()).includes('取消整张订单')){
      await approvalButton.click();
    }
    const terms=approval.filter({hasText:'取消整张订单'});
    await terms.getByText(/本单最多成功退款一次/).first().waitFor({timeout:60000});
    assert((await terms.innerText()).includes(originalOrder));
    const beforeApproval=await observeFacts(commerce,'ucp-before-aftersales-approval',originalOrder);
    assert.deepEqual(beforeApproval,{orderId:originalOrder,caseId:null,cancelCases:0,refunds:0});
    await terms.getByRole('button',{name:'允许本次操作',exact:true}).click();
    await terms.waitFor({state:'hidden'});
    checkpoint='aftersales-original-receipt';
    const status=storefront.getByRole('heading',{name:'等待店铺审核',exact:true});
    const checkOriginal=storefront.getByRole('button',{name:'查询这笔申请',exact:true});
    await status.or(checkOriginal).first().waitFor({state:'visible',timeout:60000});
    if(await checkOriginal.isVisible())await checkOriginal.click();
    await status.waitFor({state:'visible',timeout:60000});
    const admitted=await observeFacts(commerce,'ucp-after-aftersales-approval',originalOrder);
    assert.match(admitted.caseId,/^[a-f0-9-]{36}$/);
    assert.deepEqual(admitted,{orderId:originalOrder,caseId:admitted.caseId,cancelCases:1,refunds:0});
    const admissionTrace=await protocolTrace(logPath);
    checkpoint='aftersales-reload';
    await page.setViewportSize({width:1440,height:1000});
    await page.reload({waitUntil:'domcontentloaded'});
    await openOriginalAftersales(page,commerce.domain,originalOrder);
    await status.waitFor({state:'visible',timeout:60000});
    assert.deepEqual(await observeFacts(commerce,'ucp-aftersales-reopened',originalOrder),admitted);
    const restoredTrace=(await protocolTrace(logPath)).slice(admissionTrace.length);
    assertOriginalRead(restoredTrace,originalOrder,admitted.caseId);
    const operations=admissionTrace.filter(entry=>entry.operation==='aftersales/orders/:id/cases'&&entry.method==='POST');
    assert(operations.some(entry=>entry.pap10&&entry.operationsV3&&!entry.userApproval&&entry.status===403));
    assert(operations.some(entry=>entry.pap10&&entry.operationsV3&&entry.userApproval&&[200,202].includes(entry.status)));
    result('passed');

    if(commerce.liveStore&&commerce.merchantCancellation){
      currentCase='DSH-UCP-FULL-005-original-merchant-refund-readback';
      checkpoint='merchant-confirmation';
      await merchantRefundReadback({page,commerce,logPath,orderId:originalOrder,caseId:admitted.caseId});
      checkpoint='buyer-refund-readback';
      result('passed');
    }
  }catch(error){
    result('failed');
    throw error;
  }finally{
    await otherContext?.close();
  }
}
