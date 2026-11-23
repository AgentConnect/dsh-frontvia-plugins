import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const SUITE='dsh-ucp-full-e2e';
const EMAIL='ucp-full-flow@example.test';

async function observeFacts(commerce,phase){
  await writeFile(join(commerce.controlDir,phase+'.request'),'ready',{mode:0o600});
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    try{return JSON.parse(await readFile(join(commerce.controlDir,phase+'.json'),'utf8'));}
    catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
    await delay(50);
  }
  throw Error('owned_ucp_full_flow_facts_timeout');
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
    await storefront.getByRole('button',{name:'创建结算草稿',exact:true}).click();
    await storefront.getByRole('button',{name:'保存到结算草稿',exact:true}).waitFor({state:'visible',timeout:60000});
    const draft=await observeFacts(commerce,'ucp-after-draft');
    assert.equal(draft.carts,before.carts+1);
    assert.equal(draft.drafts,before.drafts+1);
    for(const key of ['nativeCheckouts','quotas','paymentSessions','orders','captured'])assert.equal(draft[key],before[key],key);
    result('passed');

    currentCase='DSH-UCP-FULL-002-owner-browser-pairing-and-explicit-confirmation';
    for(const [label,value] of [
      [/^联系邮箱/,EMAIL],[/^收货人/,'Test Buyer'],[/^完整收货地址/,'1 Fixture Street'],
      [/^城市/,'San Francisco'],[/^省 \/ 州 \/ 地区/,'CA'],[/^邮编/,'94105'],[/^联系电话/,'+12025550123'],
    ])await storefront.getByLabel(label).fill(value);
    await storefront.getByRole('button',{name:'保存到结算草稿',exact:true}).click();
    await storefront.getByRole('button',{name:/标准配送|Owned UCP US shipment/}).first().click({timeout:60000});
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
    assert.equal(beforeConfirm.nativeCheckouts,before.nativeCheckouts+1);
    assert.equal(beforeConfirm.orders,before.orders);
    assert.equal(beforeConfirm.captured,before.captured);
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
    for(const key of ['nativeCheckouts','quotas','paymentSessions','orders','captured'])assert.equal(done[key],before[key]+1,key);
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
    const http=(await readFile(logPath,'utf8')).split('\n').filter(line=>line.startsWith('{"event":"frontvia-e2e-http"')).map(line=>JSON.parse(line));
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
    const beforeApproval=await observeFacts(commerce,'ucp-before-aftersales-approval');
    assert.equal(beforeApproval.cancelCases,0);
    assert.equal(beforeApproval.refunds,0);
    await terms.getByRole('button',{name:'允许本次操作',exact:true}).click();
    await terms.waitFor({state:'hidden'});
    checkpoint='aftersales-original-receipt';
    const status=storefront.getByRole('heading',{name:'等待店铺审核',exact:true});
    const checkOriginal=storefront.getByRole('button',{name:'查询这笔申请',exact:true});
    await status.or(checkOriginal).first().waitFor({state:'visible',timeout:60000});
    if(await checkOriginal.isVisible())await checkOriginal.click();
    await status.waitFor({state:'visible',timeout:60000});
    const admitted=await observeFacts(commerce,'ucp-after-aftersales-approval');
    assert.deepEqual(admitted,{cancelCases:1,heldOrders:1,refunds:0});
    await page.reload({waitUntil:'domcontentloaded'});
    if(!await storefront.isVisible())await page.getByRole('button',{name:'Frontvia 服务',exact:true}).click({timeout:30000});
    await storefront.getByRole('tab',{name:'我的订单',exact:true}).click({timeout:60000});
    await original.getByRole('button',{name:/^查看详情：/}).click({timeout:60000});
    await openAftersales();
    await status.waitFor({state:'visible',timeout:60000});
    assert.deepEqual(await observeFacts(commerce,'ucp-aftersales-reopened'),admitted);
    const operations=(await readFile(logPath,'utf8')).split('\n').filter(line=>line.startsWith('{"event":"frontvia-e2e-http"'))
      .map(line=>JSON.parse(line)).filter(entry=>entry.operation==='aftersales/orders/:id/cases'&&entry.method==='POST');
    assert(operations.some(entry=>entry.pap10&&entry.operationsV3&&!entry.userApproval&&entry.status===403));
    assert(operations.some(entry=>entry.pap10&&entry.operationsV3&&entry.userApproval&&[200,202].includes(entry.status)));
    result('passed');
  }catch(error){
    result('failed');
    throw error;
  }finally{
    await otherContext?.close();
  }
}
