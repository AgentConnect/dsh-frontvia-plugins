import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

export async function shopUcp({page,commerce,logPath}){
  let currentCase='DSH-UCP-001-real-storefront-and-catalog',started=performance.now();
  const passed=(id,extra={})=>{
    console.log(JSON.stringify({suite:'dsh-ucp-e2e',case:id,status:'passed',durationMs:Math.round(performance.now()-started),...extra}));
    started=performance.now();
  };
  const facts=async phase=>{
    await writeFile(join(commerce.controlDir,phase+'.request'),'ready',{mode:0o600});
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){
      try{return JSON.parse(await readFile(join(commerce.controlDir,phase+'.json'),'utf8'));}
      catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
      await delay(50);
    }
    throw Error('owned_ucp_facts_timeout');
  };
  try{
    const before=await facts('ucp-before-shopping');
    const storefront=page.getByRole('region',{name:'Frontvia 服务页面',exact:true});
    const merchant=storefront.locator('.fv-store-card').filter({has:page.getByText(commerce.domain,{exact:true})});
    await merchant.getByRole('button',{name:/^进入店铺：/}).click({timeout:60000});
    const product=storefront.locator('.fv-catalog-item').filter({has:page.getByText(commerce.productTitle,{exact:true})});
    await product.getByRole('button',{name:'查看详情',exact:true}).click({timeout:60000});
    const add=storefront.getByRole('button',{name:'加入购物车',exact:true}).first();
    await add.waitFor({state:'visible',timeout:60000});
    passed(currentCase);

    currentCase='DSH-UCP-002-real-cart-and-draft';
    await add.click();
    await storefront.getByRole('tab',{name:'购物车 (1)',exact:true}).click({timeout:60000});
    await storefront.getByRole('button',{name:/^增加 .+ 数量$/}).first().click();
    await storefront.getByRole('tab',{name:'购物车 (2)',exact:true}).waitFor({state:'visible',timeout:60000});
    await storefront.getByRole('button',{name:'去结算',exact:true}).click();
    await storefront.getByRole('button',{name:'继续结算',exact:true}).waitFor({state:'visible',timeout:60000});
    await storefront.getByText('可以查看结算信息；商家尚未开放付款提交。',{exact:true}).waitFor({state:'visible'});
    assert(await storefront.getByRole('button',{name:'继续结账',exact:true}).isDisabled());
    assert.equal(await storefront.getByRole('button',{name:/确认购买|支付订单/}).count(),0);
    const after=await facts('ucp-after-draft');
    assert.equal(after.carts,before.carts+1);
    assert.equal(after.drafts,before.drafts+1);
    for(const field of ['nativeCheckouts','quotas','paymentSessions','orders'])assert.equal(after[field],before[field],field);
    passed(currentCase,{cartsCreated:1,draftsCreated:1,paymentEffects:0});

    currentCase='DSH-UCP-003-refresh-and-versioned-wire';
    await page.reload({waitUntil:'domcontentloaded'});
    if(!await storefront.isVisible())await page.getByRole('button',{name:'Frontvia 服务',exact:true}).click({timeout:30000});
    await storefront.getByRole('tab',{name:'购物车 (2)',exact:true}).click({timeout:60000});
    await storefront.getByRole('button',{name:'继续结算',exact:true}).waitFor({state:'visible',timeout:60000});
    const output=await readFile(logPath,'utf8');
    const requests=output.split('\n').filter(line=>line.startsWith('{"event":"frontvia-e2e-http"')).map(line=>JSON.parse(line));
    for(const [method,operation] of [['POST','catalog/search'],['POST','catalog/product'],['POST','carts'],['PUT','carts/:id'],['POST','checkout-sessions']])
      assert(requests.some(req=>req.method===method&&req.operation===operation&&req.status>=200&&req.status<300&&req.pap10),
        `Expected signed PAP 1.0 ${method} ${operation}`);
    assert(!requests.some(req=>req.operation==='checkout-sessions/:id/complete'||req.operation==='commerce.checkouts.confirm'));
    passed(currentCase);
  }catch(error){
    console.log(JSON.stringify({suite:'dsh-ucp-e2e',case:currentCase,status:'failed',code:error.name,durationMs:Math.round(performance.now()-started)}));
    throw error;
  }
}
