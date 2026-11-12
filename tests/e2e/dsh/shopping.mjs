import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

export async function shopping({page,commerce,workspace}){
  let currentCase='DSH-002-domain-prompt-real-agent-product-card',started=performance.now();
  const passed=(id,extra={})=>{console.log(JSON.stringify({suite:'dsh-e2e',case:id,status:'passed',durationMs:Math.round(performance.now()-started),...extra}));started=performance.now();};
  const idle=async()=>{
    const stop=page.getByRole('button',{name:/^(Stop generating|停止生成)$/});
    await stop.waitFor({state:'visible',timeout:2000}).catch(()=>{});
    await stop.waitFor({state:'hidden',timeout:180000});
  };
  try {
  await page.getByRole('button',{name:/^(New session|新会话)$/i}).first().click();
  const choose=page.getByRole('button',{name:/^Choose workspace$/i});
  if(await choose.isVisible()){
    await choose.click();
    const picker=page.getByRole('dialog',{name:'Select Workspace Directory'});
    const add=page.getByRole('menuitem',{name:/Add workspace/});
    await picker.or(add).filter({visible:true}).first().waitFor({state:'visible'});
    if(!await picker.isVisible())await add.click();
    await picker.getByRole('button',{name:'Edit path',exact:true}).click();
    const path=picker.getByRole('textbox',{name:'Edit path',exact:true});
    await path.fill(workspace);await path.press('Enter');
    await picker.getByRole('button',{name:'Open',exact:true}).click();
    await picker.waitFor({state:'hidden'});
  }
  const input=page.locator('textarea,[contenteditable="true"]').filter({visible:true}).first();
  await input.fill(`去 ${commerce.domain} 看一下有哪些商品。请实际调用 Frontvia 连接和商品工具，展示商品卡片。不要下单。`);
  await input.press('Enter');
  const card=page.getByLabel('Frontvia 购物卡片',{exact:true}).filter({visible:true}).last();
  await card.waitFor({state:'visible',timeout:120000});
  await card.getByText(commerce.productTitle,{exact:true}).first().waitFor({state:'visible',timeout:60000});
  await idle();
  passed('DSH-002-domain-prompt-real-agent-product-card');
  currentCase='DSH-003-refresh-restores-business-card';
  await page.reload({waitUntil:'domcontentloaded'});
  await card.waitFor({state:'visible',timeout:30000});
  passed('DSH-003-refresh-restores-business-card');
  currentCase='DSH-004-sku-quantity-and-real-cart';
  await card.getByRole('tab',{name:'选购商品',exact:true}).click();
  await card.getByRole('button',{name:'选择规格',exact:true}).first().click();
  const quantity=card.getByRole('spinbutton').first();
  await quantity.waitFor({state:'visible',timeout:120000});
  await idle();
  await quantity.fill('2');assert.equal(await quantity.inputValue(),'2');await quantity.fill('1');
  await card.getByRole('button',{name:'加购 1 件',exact:true}).first().click();
  await card.getByRole('tab',{name:'收货配送',exact:true}).click();
  await card.getByText('由商家交付，无需填写收货地址。',{exact:true}).waitFor({state:'visible',timeout:120000});
  await idle();
  await card.getByRole('textbox',{name:'联系邮箱',exact:true}).fill('dsh-owned@example.test');
  await card.getByRole('button',{name:'保存联系邮箱',exact:true}).click();
  await card.getByRole('button',{name:'联系邮箱已保存',exact:true}).waitFor({state:'visible',timeout:30000});
  passed('DSH-004-sku-quantity-and-real-cart');
  const facts=async phase=>{
    await writeFile(join(commerce.controlDir,phase+'.request'),'ready',{mode:0o600});
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){try{return JSON.parse(await readFile(join(commerce.controlDir,phase+'.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}await delay(50);}
    throw Error('owned_native_facts_timeout');
  };
  currentCase='DSH-005-public-approval-dialog-original-order';
  await input.fill('请先读取当前购物车最新版本，再生成完整报价并准备结算，不要确认购买，不要创建新购物车。');await input.press('Enter');
  await idle();
  await card.getByRole('tab',{name:'核对订单',exact:true}).click();
  await card.getByRole('button',{name:'核对完整报价',exact:true}).click({timeout:120000});
  await card.getByRole('button',{name:/^确认购买/}).click();
  const approval=page.getByRole('dialog',{name:'确认本次操作',exact:true});
  await approval.waitFor({state:'visible',timeout:30000});
  assert((await approval.innerText()).includes('commerce.checkouts.confirm'));
  const parameters=JSON.parse(await approval.getByLabel('参数摘要',{exact:true}).innerText());
  assert.equal(parameters.confirmation.currency,'USD');assert.equal(parameters.confirmation.amount_minor,String(commerce.productPriceMinor));
  assert.equal((await facts('before-confirm')).orders,0);
  await approval.getByRole('button',{name:'允许本次操作',exact:true}).click();
  await approval.waitFor({state:'hidden'});
  await card.getByRole('tab',{name:'订单结果',exact:true}).click();
  await card.getByText(/^订单号：/).waitFor({state:'visible',timeout:60000});
  assert.equal((await facts('after-confirm')).orders,1);
  passed('DSH-005-public-approval-dialog-original-order',{ordersBeforeApproval:0,ordersAfterApproval:1});
  currentCase='DSH-006-same-domain-real-consultation';
  await input.fill('请实际向当前商家咨询这个商品如何交付。使用 Frontvia 商家咨询工具，等待商家回复后告诉我，不要下单。');await input.press('Enter');
  const consultation=page.getByLabel('Frontvia 商家咨询',{exact:true}).filter({visible:true}).last();
  await consultation.waitFor({state:'visible',timeout:120000});
  const details=consultation.locator('details').first();
  if(await details.getAttribute('open')===null)await details.locator('summary').click();
  await consultation.getByText('商家回复',{exact:true}).first().waitFor({state:'visible',timeout:120000});
  const after=await facts('after-consultation');assert(after.consultationModelCalls>0);assert.equal(after.orders,1);
  passed('DSH-006-same-domain-real-consultation',{modelCalls:after.consultationModelCalls});
  } catch(error) {console.log(JSON.stringify({suite:'dsh-e2e',case:currentCase,status:'failed',durationMs:Math.round(performance.now()-started),code:error.name}));throw error;}
}
