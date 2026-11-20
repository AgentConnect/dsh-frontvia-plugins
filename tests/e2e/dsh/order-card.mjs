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
    stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {Order} from './packages/customer/src/client/commerce-display.tsx';
      import {orderShipments} from './packages/customer/src/order-tracking.ts';
      const root=createRoot(document.getElementById('root'));
      window.showOrder=(events,code)=>root.render(<Order order={{ucp:{},id:'order',lines:[],line_items:[{id:'line',item:{title:'装订本'},quantity:{total:3,fulfilled:2}}],
        messages:code?[{code}]:[],shipments:orderShipments(events)}} download={async()=>({bytes_base64:btoa('%PDF-synthetic')})}/>);
    `}});
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({content:result.outputFiles[0].text});
  const entry=(id,tracking_number,type,day)=>({id,tracking_number,type,carrier:'测试承运商',description:id,
    occurred_at:'2026-11-'+day+'T00:00:00Z',line_items:[{id:'line',quantity:1}]});
  const a=entry('揽件','A','shipped',10), b=entry('派送失败记录','B','failed_attempt',12);
  const show=(events,code)=>page.evaluate(([e,c])=>window.showOrder(e,c),[events,code]);
  await show([a,b,a],null);
  await page.getByText('已发货，暂无承运商轨迹。').waitFor();
  await page.getByText('待发商品',{exact:true}).waitFor();
  await page.getByText('查看轨迹（1）',{exact:true}).first().click();
  assert.equal(await page.locator('details[open]').count(),1);
  await show([a,b,entry('签收记录','B','delivered',14)],null);
  await page.getByText('已签收',{exact:false}).first().waitFor();
  await show([],'digital_delivery_available');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'下载已购 PDF'}).click();
  assert.equal((await download).suggestedFilename(),'document.pdf');
  await show([],'digital_delivery_revoked');
  await page.getByText('下载权限已撤销').waitFor();
  assert.equal(await page.getByRole('button',{name:'下载已购 PDF'}).count(),0);
  console.log('Order card browser interactions passed');
} finally { await browser.close(); }
