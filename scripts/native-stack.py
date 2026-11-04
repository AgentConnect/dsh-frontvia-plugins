#!/usr/bin/env python3
"""Owned native Frontvia/PAP test stack. Never reuses a business identity or stops shared services."""
import re, os, sys, json, secrets, signal, time, subprocess, threading, importlib.util, hashlib, hmac, base64, socket, shutil, traceback
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
FRONT=Path(os.environ.get('FRONTVIA_SOURCE','/Users/howard/workspace/frontvia-core')).resolve()
PERSONAL=os.environ.get('FRONTVIA_NATIVE_PERSONAL')=='1'
OUT=Path(os.environ.get('FRONTVIA_NATIVE_OUT',ROOT/'.local/native')).resolve();OUT.mkdir(parents=True,exist_ok=True,mode=0o700)
if (OUT/'owner.json').exists():
 prior=json.loads((OUT/'owner.json').read_text()).get('pid')
 if prior:
  try:os.kill(prior,0)
  except ProcessLookupError:pass
  else:raise RuntimeError('An owned native stack is already running; preserve it')
(OUT/'stop').unlink(missing_ok=True)
os.umask(0o077)
os.environ.setdefault('FRONTVIA_PG_OWNER_CONFIG',str(ROOT/'.local/postgres/postgres-owner.json'))
os.environ.setdefault('FRONTVIA_B1_BUILD_DIR',str(FRONT/'ecommerce/medusa-app/.local/dsh-plugin-build'))
FIX=OUT/'fixtures';FIX.mkdir(mode=0o700,exist_ok=True)
os.environ['FRONTVIA_TEST_FIXTURES_DIRECTORY']=str(FIX)
for name in ['ca.pem','server.pem','server-key.pem','c2-key.pem','c2-agent.json','c2-jwks.json']:
 shutil.copyfile(FRONT/'platform/.local/fixtures'/name,FIX/name)
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
key=ec.generate_private_key(ec.SECP256R1());numbers=key.public_key().public_numbers()
b64=lambda v:base64.urlsafe_b64encode(v).decode().rstrip('=')
(FIX/'c1-key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
(FIX/'c1-jwks.json').write_text(json.dumps({'keys':[{'kty':'EC','crv':'P-256','kid':'c1','use':'sig','alg':'ES256','x':b64(numbers.x.to_bytes(32,'big')),'y':b64(numbers.y.to_bytes(32,'big'))}]}))
with socket.socket() as s:s.bind(('127.0.0.1',0));client_port=s.getsockname()[1]
client_id=f'https://agent.test:{client_port}/c1/agent.json';callback=f'https://agent.test:{client_port}/c1/callback'
metadata=json.loads((FRONT/'platform/.local/fixtures/c1-agent.json').read_text());metadata['client_id']=client_id;metadata['client_name']='DSH PAP isolated client';metadata['jwks_uri']=f'https://agent.test:{client_port}/c1/jwks.json';metadata['redirect_uris']=[callback]
(FIX/'c1-agent.json').write_text(json.dumps(metadata))
sys.path.insert(0,str(FRONT/'web/scripts'))
spec=importlib.util.spec_from_file_location('dsh_subject',FRONT/'web/scripts/test-subject-buyer.py');subject=importlib.util.module_from_spec(spec);spec.loader.exec_module(subject);subject.CLIENT_ID=client_id
class PersonalEnvironment(subject.SubjectEnvironment):
 def cli(self,*args,**kwargs):
  if args==('db','migrate'):
   origin=f'https://company-a.test:{self.port}'
   content=self.config.read_text()
   content+='\n[personal]\nallowed_origins = ['+json.dumps(origin)+']\nrate_key_version = "v1"\noperator_credential_hash = '+json.dumps(b64(hashlib.sha256(secrets.token_bytes(32)).digest()))+'\n'
   content+='\n[personal.test_otp]\nphones=["+12025550101","+12025550102"]\nemails=["a@example.test","b@example.test"]\ncode="246810"\n'
   content+='\n[personal.sending.smtp]\nhost="smtp.example.test"\nport=465\nusername="fixture"\npassword="fixture"\nfrom_email="fixture@example.test"\nfrom_name="Fixture"\n'
   content+='\n[personal.sending.sms]\naccess_key_id="fixture"\naccess_key_secret="fixture"\ndomestic_endpoint="dysmsapi.aliyuncs.com"\ninternational_endpoint="dysmsapi.ap-southeast-1.aliyuncs.com"\nsign_name="fixture"\ntemplate_code="fixture"\nsender_id="fixture"\nmessage_template="{{code}}"\n'
   self.config.write_text(content)
  result=super().cli(*args,**kwargs)
  if args==('seed-fixtures',):
   # Personal access must work with no legacy client policy or HMAC key at all.
   self.config.write_text(re.sub(r'^subject_purchase = .*\n','',self.config.read_text(),flags=re.M))
  return result
stop=threading.Event();run=None;e=None
for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,lambda *_:stop.set())
def protected(path,value):
 path.write_text(json.dumps(value,indent=2)+'\n');path.chmod(0o600)
try:
 run=subject.b1.Run();run.target['company_id']='a';run.config['target']=run.target
 run.config['credentials'][0]['actions']+=['buyer.catalog','buyer.cart','products.list','products.get','orders.get']
 for k in ['buyer_signing_key','management_signing_key']:run.config[k]=b64(secrets.token_bytes(32))
 run.tokens['observer']=secrets.token_urlsafe(32);run.config['credentials'].append(dict(service_id='buyer-observer',token_sha256=subject.b1.sha(run.tokens['observer']),expires_at=int(time.time())+7200,enabled=True,actions=['buyer.observe','buyer.admin.observe']))
 run.private_values=[run.config['buyer_signing_key'],run.config['management_signing_key']];run.write_config()
 print(json.dumps({'stage':'native-start','evidence':str(run.dir)}),flush=True);run.setup(seed_fixtures=False)
 run.run_cli(['exec','./src/scripts/init-buyer-store.js'],'dsh-store-init')
 native=json.loads(run.sql('SELECT configuration::text FROM frontvia_buyer_store;'));public_key=run.sql("SELECT token FROM api_key WHERE id='"+native['publishable_key_id']+"';")
 def managed(method,operation,payload):
  permit=dict(version='management.v1',actor_id='isolated-fixture-owner',client_id='frontvia-merchant-v1',epoch=1,request_digest=b64(hashlib.sha256(operation.encode()).digest()),dispatch_expires_at=int(time.time())+120,lease_generation=1,dispatch_generation=1,claim_expires_at=int(time.time())+120)
  body=json.dumps(['frontvia.management.v1',run.target,method,operation,'one',permit,payload],sort_keys=True,separators=(',',':'),ensure_ascii=False)
  signature=b64(hmac.new(base64.urlsafe_b64decode(run.config['management_signing_key']+'='),body.encode(),hashlib.sha256).digest())
  return run.request(method,dict(operation_id=operation,item_id='one',payload=payload,permit=permit,signature=signature))
 products=[]
 for index,(title,price) in enumerate([('Travel Mug',1234),('Canvas Bag',1990)]):
  result=managed('products.create','dsh-create-'+str(index),dict(title=title,handle='dsh-'+run.id+'-'+str(index),sku='DSH-'+run.id+'-'+str(index),price_minor=price,stock_quantity=10));assert result['status']=='succeeded'
  pid=result['result']['product_id'];assert managed('products.publish','dsh-publish-'+str(index),{'product_id':pid})['status']=='succeeded';products.append({'title':title,'price_minor':price,'native_id':pid})
 e=(PersonalEnvironment if PERSONAL else subject.SubjectEnvironment)(run,public_key);e.fixture_host='127.0.0.1';e.fixture_port=client_port;e.identity_client_port=None
 print(json.dumps({'stage':'platform-start','evidence':str(e.directory)}),flush=True);e.setup();e.activate_store()
 if not PERSONAL:e.policy(True)
 origin=f'https://company-a.test:{e.port}'
 refs={name:'DSH_'+name+'_'+run.id.upper() for name in ['PAP_SIGNING','PAP_STORAGE','CUSTOMER_STORAGE','CUSTOMER_CONFIRM']}
 pap=dict(clientId=client_id,callback=callback,signingKeyRef=refs['PAP_SIGNING'],keyId='c1',storageKeyRef=refs['PAP_STORAGE'],dataDir=str(OUT/('pap-data-'+run.id)),caFile=str(FIX/'ca.pem'),targets=[dict(origin=origin,address='127.0.0.1',port=e.port)],sites=[dict(id='test-shop',label='Frontvia Test Shop',domain=f'company-a.test:{e.port}',issuer=origin+'/companies/a',resource=e.resource)])
 customer=dict(dataDir=str(OUT/('customer-data-'+run.id)),storageKeyRef=refs['CUSTOMER_STORAGE'],sites=[dict(siteId='test-shop',storeId=run.target['store_id'],confirmationKeyRef=refs['CUSTOMER_CONFIRM'],confirmationKid=e.confirmation_kid)])
 if PERSONAL:
  pap['personal']=dict(origin=origin,requestOrigin=origin,tokenOrigins=[origin])
  customer['sites'][0].pop('confirmationKeyRef');customer['sites'][0].pop('confirmationKid')
 customer['sites'][0]['mockPayment']=True
 protected(OUT/'pap.json',pap);protected(OUT/'customer.json',customer)
 protected(OUT/'secrets.json',{refs['PAP_SIGNING']:(FIX/'c1-key.pem').read_text(),refs['PAP_STORAGE']:b64(secrets.token_bytes(32)),refs['CUSTOMER_STORAGE']:b64(secrets.token_bytes(32)),refs['CUSTOMER_CONFIRM']:e.confirmation_key})
 protected(OUT/'owner.json',dict(pid=os.getpid(),platform_evidence=str(e.directory),native_evidence=str(run.dir),database=run.database,platform_database=e.database))
 protected(OUT/'status.json',dict(status='READY',pid=os.getpid(),payment='native Mock',products=products));print(json.dumps({'status':'READY','config':str(OUT/'pap.json')}),flush=True)
 deadline=time.time()+7200
 while not stop.wait(.5) and time.time()<deadline and not (OUT/'stop').exists():
  if (OUT/'audit-request').exists():
   facts=dict(orders=int(run.sql('SELECT count(*) FROM "order";')),captures=int(run.sql("SELECT count(*) FROM frontvia_mock_effect WHERE action='capture';")),merchant_orders=run.request('orders.list',dict(limit=10)))
   protected(OUT/'facts.json',facts);(OUT/'audit-request').unlink()
except Exception:
 text=traceback.format_exc()
 if run:text=run.redact(text)
 (OUT/'failure.log').write_text(text);print(json.dumps({'status':'FAILED','details':str(OUT/'failure.log')}),flush=True)
finally:
 errors=[]
 for label,resource in [('platform',e),('native',run)]:
  if resource:
   try:resource.cleanup()
   except Exception:errors.append(label)
 protected(OUT/'cleanup.json',dict(status='PASS' if not errors else 'FAILED',errors=errors));protected(OUT/'status.json',dict(status='STOPPED',pid=os.getpid()))
