// Synthetic PAP UI responses inside the real DSH host; no protocol or credential effects.
async (page) => {
  const state={configured:true,sites:[{id:'frontvia',label:'Frontvia Test Shop',domain:'frontvia.example.test'},{id:'second',label:'Northwind Store',domain:'northwind.example.test'}],connections:[],requests:[],delay:0,fail:'',failStatus:false,invalidUrl:false};
  const connection=(s)=>({connectionRef:`connection-${s.id}`,siteId:s.id,label:s.label,domain:s.domain,issuer:`https://${s.domain}/auth`,resource:`https://${s.domain}/commerce`,signedIn:false,connected:true,expiresAt:Math.floor(Date.now()/1000)+3600});
  state.connections=state.sites.map(connection);
  await page.unroute('**/api/frontvia-pap/*');
  await page.route('**/api/frontvia-pap/*',async route=>{
    const b=route.request().postDataJSON(),op=b.method.split('/').at(-1);
    Object.assign(state,await page.evaluate(()=>window.__papTestControl||{}));
    await page.evaluate(()=>window.__papTestControl={});
    const a=b.payload;let value,error;
    if(state.delay)await new Promise(r=>setTimeout(r,state.delay));
    state.requests.push({op,payload:a});
    if(op===state.fail || (op==='status'&&state.failStatus))error={code:op==='callback'?'CALLBACK_REJECTED':'PAP_REQUEST_FAILED',message:'fixture failure',details:{}};
    else if(op==='status')value={configured:state.configured,sites:state.sites,connections:state.connections};
    else if(op==='connect'){
      let c=state.connections.find(c=>c.siteId===a.siteId);
      if(!c){c=connection(state.sites.find(s=>s.id===a.siteId));state.connections.push(c);}
      c.connected=true;c.expiresAt=Math.floor(Date.now()/1000)+3600;value=c;
    }else if(op==='disconnect'){const c=state.connections.find(c=>c.connectionRef===a.connectionRef);c.connected=false;value=c;}
    else if(op==='authorize')value={url:state.invalidUrl?'http://unsafe.example.test/authorize':'https://frontvia.example.test/authorize?state=synthetic-not-a-secret'};
    else if(op==='callback'){const c=state.connections.find(c=>c.connectionRef===a.connectionRef);c.connected=true;c.signedIn=true;value=c;}
    await page.evaluate(s=>window.__papTestState=s,state);
    await route.fulfill({json:{type:'server-response',rpcId:b.rpcId,result:error?{ok:false,error}:{ok:true,value}}});
  });
  await page.reload();await page.getByRole('button',{name:'Frontvia PAP 连接',exact:true}).click();
  await page.getByRole('region',{name:'PAP 连接管理'}).getByRole('heading',{name:'Frontvia Test Shop'}).waitFor();
  return {synthetic:true,merchants:state.sites.length};
}
