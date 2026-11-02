// Visual/responsive checks after ui-check.playwright.cjs, in the same DSH tab.
async (page) => {
  const checks=[];const check=(name,ok)=>{if(!ok)throw new Error(name);checks.push({name,status:'PASS'});};
  const card=page.getByRole('region',{name:'Frontvia 购物卡片'}).last();
  await page.evaluate(()=>{const f=window.__fvTestState.fixture;delete f.order;delete f.intent;delete f.quote;delete f.checkout;f.pending=false;window.__fvTestControl={fixture:f,lostConfirm:false,delay:0};});
  await card.getByRole('button',{name:'刷新购物进度'}).click();await card.getByRole('tab',{name:'收货配送'}).click();await card.getByRole('textbox',{name:'收货人',exact:true}).waitFor();
  await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>!document.body.hasAttribute('data-ds-dark-theme'));
  await card.getByRole('heading',{name:'收货与配送'}).click();
  await card.screenshot({animations:'disabled',path:'output/playwright/ui-cart-light.png'});
  const light=await card.evaluate(el=>getComputedStyle(el.querySelector('[data-slot=card]')).backgroundColor);
  const contrast=await card.locator('[data-slot=badge][data-variant=success]').evaluate(el=>{const s=getComputedStyle(el);const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');const rgb=x=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=x;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};const lum=x=>rgb(x).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);return (Math.max(lum(s.color),lum(s.backgroundColor))+.05)/(Math.min(lum(s.color),lum(s.backgroundColor))+.05);});
  check('success label contrast at least 4.5:1',contrast>=4.5);
  await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.body.hasAttribute('data-ds-dark-theme'));
  const dark=await card.evaluate(el=>getComputedStyle(el.querySelector('[data-slot=card]')).backgroundColor);
  check('follows actual DSH theme variables',light!==dark);
  await card.screenshot({animations:'disabled',path:'output/playwright/ui-cart-dark.png'});
  await page.setViewportSize({width:390,height:1100});
  await card.getByRole('tab',{name:'收货配送'}).click();
  const geometry=await card.evaluate(el=>({width:el.getBoundingClientRect().width,overflow:el.scrollWidth>el.clientWidth,columns:getComputedStyle(el.querySelector('[data-slot=field-group]')).gridTemplateColumns}));
  check('narrow viewport fits card without horizontal overflow',geometry.width<=390&&!geometry.overflow);
  check('narrow form collapses to a single column',geometry.columns.split(' ').length===1);
  check('mobile input avoids automatic zoom',await card.getByRole('textbox',{name:'收货人',exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16));
  await page.setViewportSize({width:390,height:1700});await card.screenshot({animations:'disabled',path:'output/playwright/ui-cart-mobile-dark.png'});
  await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});await page.waitForFunction(()=>!document.body.hasAttribute('data-ds-dark-theme'));
  check('reduced motion disables loading animation',await card.evaluate(el=>{const sample=document.createElement('div');sample.className='fv-skeleton';el.append(sample);const name=getComputedStyle(sample).animationName;sample.remove();return name==='none';}));
  await card.screenshot({animations:'disabled',path:'output/playwright/ui-cart-mobile-light.png'});
  await page.setViewportSize({width:1440,height:1100});await page.emulateMedia({colorScheme:'light',reducedMotion:'no-preference'});
  await page.evaluate(()=>window.__fvTestControl={delay:1200});await card.getByRole('button',{name:'刷新购物进度'}).click();await card.locator('button[aria-label="刷新购物进度"]:not(:disabled)').waitFor();
  await page.reload({waitUntil:'domcontentloaded'});await card.getByRole('status',{name:'读取购物进度'}).waitFor();
  check('loading renders skeleton with accessible status',await card.locator('[data-slot=skeleton]').count()>0);
  await card.getByText('还没有已提交的订单',{exact:true}).waitFor();
  check('empty order state gives a useful next step',await card.getByText('完成费用核对并确认购买后，订单会显示在这里。',{exact:true}).count()===1);
  await page.evaluate(()=>window.__fvTestControl={delay:0});await card.getByRole('button',{name:'刷新购物进度'}).click();await card.getByRole('tab',{name:'收货配送'}).click();
  return {status:'PASS',checks,successLabelContrast:contrast,geometry,light,dark};
}
