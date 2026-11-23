// Browser interaction with the same Order component used by the store and chat cards.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {build} from 'esbuild';
const require = createRequire(resolve(process.env.FRONTVIA_CORE_ROOT ?? '../frontvia-core','web/package.json'));
const {chromium} = require('playwright-core');
const browser = await chromium.launch({headless:true,args:['--no-sandbox'],
  ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
try {
  const result = await build({bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
    loader:{'.css':'text'},
    stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {Order} from './packages/customer/src/client/commerce-display.tsx';
      import {AftersalesPanel} from './packages/customer/src/client/aftersales.tsx';
      import styles from './packages/customer/src/client/styles.css';
      import {buyerTrackingEvents, orderShipments, orderShippingProgress} from './packages/customer/src/order-tracking.ts';
      document.head.appendChild(Object.assign(document.createElement('style'),{textContent:styles}));
      const root=createRoot(document.getElementById('root'));
      window.showOrder=(events,code)=>{
        const order={ucp:{},id:'order',lines:[],line_items:[{id:'line',item:{title:'装订本'},quantity:{total:2,fulfilled:2}}],
          fulfillment:{expectations:code?[]:[{method_type:'shipping'}],events:buyerTrackingEvents(events)}};
        root.render(<Order order={{...order,pending_items:orderShippingProgress(order, events)?.pending,
        messages:code?[{code}]:[],shipments:orderShipments(buyerTrackingEvents(events))}} download={async()=>({bytes_base64:btoa('%PDF-synthetic')})}/>);};
      window.afterSalesCalls=[];
      window.showAftersales=(mode)=>{
        const entry=mode==='return'?{id:'case',kind:'return_and_refund',stage:'waiting_return',updated_at:'2026-11-23T08:00Z',
          currency:'CNY',requested_minor:'21000',allowed_actions:[],return:{items:[{received:1,quantity:2,damaged:0}]},
          return_instructions:{recipient:'退货组',address:'很长的寄回地址'.repeat(16),delivery_notes:'请妥善包装'}}:null;
        const eligibility={allowed:entry?[]:['cancel_order'],reasons:[],lines:[],currency:'CNY',captured_minor:'21000',
          original_shipping_minor:'1000',support:{support_contact:'support@example.test'}};
        const request=async(op,body)=>{
          window.afterSalesCalls.push({op,body});
          if(op==='aftersales-change')throw new Error('AFTERSALES_CHANGED');
          return {eligibility,selected:entry,history:{items:[],page:{has_more:false}}};
        };
        root.render(<div className="fv fv-inline"><AftersalesPanel key={mode} orderId="order" request={request}/></div>);
      };
    `}});
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({content:result.outputFiles[0].text});
  const entry=(id,tracking_number,type,day)=>({id,tracking_number,type,carrier:'测试承运商',description:id,
    occurred_at:'2026-11-'+day+'T00:00:00Z',line_items:[{id:'line',quantity:1}]});
  const a=entry('揽件','A','shipped',10), b=entry('派送失败记录','B','failed_attempt',12);
  const show=(events,code)=>page.evaluate(([e,c])=>window.showOrder(e,c),[events,code]);
  await show([],null);
  await page.getByText('装订本 × 2',{exact:true}).waitFor();
  await show([a,b,a],null);
  await page.getByText('装订本 × 1',{exact:true}).last().waitFor();
  await page.getByText('已发货，暂无承运商轨迹。').waitFor();
  await page.getByText('待发商品',{exact:true}).waitFor();
  await page.getByText('查看轨迹（1）',{exact:true}).first().click();
  assert.equal(await page.locator('details[open]').count(),1);
  await show([a,b,entry('签收记录','B','delivered',14)],null);
  await page.getByText('已签收',{exact:false}).first().waitFor();
  const corrections = [entry('r1','A','tracking_replaced',15),entry('c1','MID','tracking_corrected',15),
    entry('r2','MID','tracking_replaced',16),entry('c2','NEW','tracking_corrected',16)];
  await show([a,...corrections,entry('迟到旧号','A','delivered',17)],null);
  assert.equal(await page.getByText('迟到旧号',{exact:true}).count(),0);
  await page.getByText('测试承运商 · NEW',{exact:true}).waitFor();
  assert.equal(await page.getByText('测试承运商 · A',{exact:true}).count(),0);
  assert.equal(await page.getByText('测试承运商 · MID',{exact:true}).count(),0);
  assert.equal(await page.getByText(/运单已更新/).count(),2);
  assert.equal(await page.getByText('待发商品',{exact:true}).count(),1);
  await show([a,...corrections,entry('二号包裹','B','shipped',17)],null);
  await page.getByText('测试承运商 · B',{exact:true}).waitFor();
  assert.equal(await page.getByText('待发商品',{exact:true}).count(),0);
  await show([],'digital_delivery_available');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'下载已购 PDF'}).click();
  assert.equal((await download).suggestedFilename(),'document.pdf');
  await show([],'digital_delivery_revoked');
  await page.getByText('下载权限已撤销').waitFor();
  assert.equal(await page.getByRole('button',{name:'下载已购 PDF'}).count(),0);

  await page.setViewportSize({width:390,height:820});
  await page.evaluate(()=>window.showAftersales('cancel'));
  const open=page.getByRole('button',{name:'查看售后'});
  await open.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'取消整张订单'}).waitFor();
  await page.getByText('¥210.00',{exact:true}).waitFor();
  assert.match(await page.getByText(/含运费/).innerText(),/¥10\.00/);
  const reason=page.getByLabel('申请原因');
  await reason.focus();
  await page.keyboard.type('Duplicate purchase');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'核对并确认申请');
  await page.keyboard.press('Enter');
  await page.getByRole('alert').getByText(/店铺已更新/).waitFor();
  assert.equal(await reason.inputValue(),'Duplicate purchase');
  assert.deepEqual(await page.evaluate(()=>window.afterSalesCalls.at(-1).body.input),{
    kind:'cancel_order',reason:'Duplicate purchase',
  });
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.FRONTVIA_ORDER_CARD_SCREENSHOTS)
    await page.screenshot({path:resolve(process.env.FRONTVIA_ORDER_CARD_SCREENSHOTS,'aftersales-390-light.png')});

  await page.emulateMedia({colorScheme:'dark'});
  await page.evaluate(()=>{
    document.documentElement.style.setProperty('--dsw-alias-bg-base','#171819');
    document.documentElement.style.setProperty('--dsw-alias-label-primary','#f4f4f5');
    document.documentElement.style.setProperty('--dsw-alias-label-secondary','#b9bdc2');
    document.documentElement.style.setProperty('--dsw-alias-border-l2','#494c52');
    window.showAftersales('return');
  });
  await page.getByRole('button',{name:'查看售后'}).click();
  await page.getByText(/商家已收/).waitFor();
  assert.match(await page.getByText(/商家已收/).innerText(),/1\/2/);
  assert(await page.getByRole('button',{name:'复制收件信息'}).isVisible());
  assert.equal(await page.getByLabel(/运单号|运输单号/).count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.FRONTVIA_ORDER_CARD_SCREENSHOTS)
    await page.screenshot({path:resolve(process.env.FRONTVIA_ORDER_CARD_SCREENSHOTS,'aftersales-390-dark.png')});
  await page.setViewportSize({width:1440,height:900});
  assert(await page.getByRole('heading',{name:'订单售后'}).isVisible());
  console.log('Order card browser interactions passed, including after-sales at 390px in light and dark themes');
} finally { await browser.close(); }
