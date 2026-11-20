import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../cloudflare/worker.mjs';
import {hash,nowSeconds,verifyGoogleToken} from '../cloudflare/security.mjs';
import {maintenance} from '../cloudflare/maintenance.mjs';
import {privateContent} from '../cloudflare/content.mjs';
import {LocalD1} from './d1-local.mjs';
const schema=await readFile(new URL('../cloudflare/schema/001_courses.sql',import.meta.url),'utf8');
const seed=await readFile(new URL('../cloudflare/schema/002_catalog.sql',import.meta.url),'utf8');
const origin='https://www.tbplan.mn',csrf='d'.repeat(64),tokens={learner:'a'.repeat(64),other:'b'.repeat(64),admin:'c'.repeat(64)};
const ids={learner:'11111111-1111-4111-8111-111111111111',other:'22222222-2222-4222-8222-222222222222',admin:'99999999-9999-4999-8999-999999999999'};
async function setup(){
  const db=new LocalD1();db.exec(schema);db.exec(seed);let assetCalls=0,lastAssetRequest=null;
  for(const [key,id]of Object.entries(ids)){await db.prepare('INSERT INTO users(id,google_sub,email) VALUES(?,?,?)').bind(id,key==='admin'?'999000111':key==='learner'?'111000111':'222000111',key+'@example.test').run();await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await hash(tokens[key]),id,nowSeconds()+86400).run();}
  const course=await db.prepare('SELECT * FROM courses').first(),lesson=await db.prepare('SELECT * FROM lessons ORDER BY sort_order LIMIT 1').first();
  await db.prepare('UPDATE courses SET price_mnt=100,access_days=30,enrollment_open=1').run();
  await db.prepare('INSERT INTO lesson_assets(lesson_id,media_path,captions_path,media_bytes) VALUES(?,?,?,?)').bind(lesson.id,'/hicheel/private/lesson_01_mn.mp4','/hicheel/private/lesson_01_mn.vtt',10).run();
  const env={DB:db,FREE_MODE:'1',SITE_ORIGIN:origin,GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com',ADMIN_GOOGLE_SUB:'999000111',ENROLLMENT_ENABLED:'1',BANK_NAME:'Test bank',BANK_ACCOUNT:'Test account',BANK_HOLDER:'Test merchant',
    ASSETS:{fetch:async request=>{assetCalls++;lastAssetRequest=request;return new Response(request.method==='HEAD'?null:'0123456789',{headers:{'Content-Length':'10','Content-Type':'video/mp4'}});}}};
  function req(path,{user,body,method=body===undefined?'GET':'POST',headers={}}={}){return new Request(origin+path,{method,headers:{...(user?{Cookie:`__Host-tbplan_session=${tokens[user]}; __Host-tbplan_csrf=${csrf}`}:{Cookie:`__Host-tbplan_csrf=${csrf}`}),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
  async function call(path,options){return worker.fetch(req(path,options),env);}
  async function order(user='learner'){const response=await call('/hicheel/api/orders',{user,body:{course_id:course.id,amount_mnt:1,user_id:ids.other}});assert.equal(response.status,200);return (await response.json()).order;}
  async function approve(o,reference='BANK-0001'){return call('/hicheel/api/admin/approve',{user:'admin',body:{order_id:o.id,amount_mnt:100,bank_reference:reference,confirmed_in_bank:true}});}
  return {db,env,course,lesson,req,call,order,approve,get assetCalls(){return assetCalls;},get lastAssetRequest(){return lastAssetRequest;}};
}
test('public catalog contains 19 outlines and no private paths or paid worksheets',async()=>{const f=await setup();try{const r=await f.call('/hicheel/api/catalog');assert.equal(r.status,200);const data=await r.json();assert.equal(data.lessons.length,19);assert.equal(data.modules.length,5);assert.equal(JSON.stringify(data).includes('/private/'),false);assert.equal(JSON.stringify(data).includes('worksheet'),false);}finally{f.db.close();}});
test('private worksheets and two-question quizzes require entitlement and never enter the public catalog',async()=>{
  const f=await setup();try{
    const content=privateContent({worksheet_text:'PRIVATE-WORKSHEET-ONLY',quiz:[{question:'Private question one',options:['First choice','Second choice'],answer_index:1,explanation:'PRIVATE-EXPLANATION-ONLY'},{question:'Private question two',options:['A','B'],answer_index:0,explanation:'Private second explanation'}]});
    await f.db.prepare('UPDATE lesson_assets SET worksheet_text=?,quiz_json=? WHERE lesson_id=?').bind(content.worksheet_text,JSON.stringify(content.quiz),f.lesson.id).run();
    for(const user of [undefined,'learner','other'])assert.equal((await f.call('/hicheel/api/playback',{user,body:{lesson_id:f.lesson.id}})).status,user?403:401);
    const publicResponse=await (await f.call('/hicheel/api/catalog')).text();assert.equal(publicResponse.includes('PRIVATE-'),false);assert.equal(publicResponse.includes('quiz'),false);
    await f.approve(await f.order());const response=await f.call('/hicheel/api/playback',{user:'learner',body:{lesson_id:f.lesson.id}});assert.equal(response.status,200);const body=await response.json();assert.equal(body.worksheet_text,content.worksheet_text);assert.deepEqual(body.quiz,content.quiz);assert.match(response.headers.get('Cache-Control'),/private.*no-store/);
    assert.equal((await f.call('/hicheel/api/playback',{user:'other',body:{lesson_id:f.lesson.id}})).status,403);
    const bad=structuredClone(content);bad.quiz[0].answer_index=9;assert.throws(()=>privateContent(bad),/choices\/answer/);
    const exportData=structuredClone(content);exportData.quiz[0].narration='Do not import a production export';assert.throws(()=>privateContent(exportData),/unsupported fields/);
  }finally{f.db.close();}
});
test('server price/ownership and admin identity control manual payment; duplicate grants are stable',async()=>{
  const f=await setup();try{const order=await f.order();assert.equal(order.amount_mnt,100);assert.equal((await f.db.prepare('SELECT user_id FROM orders').first()).user_id,ids.learner);
    assert.equal((await f.call('/hicheel/api/orders/'+order.id,{user:'other'})).status,404);
    const body={order_id:order.id,amount_mnt:100,bank_reference:'BANK-1',confirmed_in_bank:true};
    assert.equal((await f.call('/hicheel/api/admin/approve',{user:'learner',body})).status,403);
    assert.equal((await f.call('/hicheel/api/admin/approve',{user:'admin',body:{...body,amount_mnt:1}})).status,409);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM entitlements').first()).n,0);
    assert.equal((await f.approve(order)).status,200);const first=await f.db.prepare('SELECT * FROM entitlements').first();assert.equal(first.active,1);
    assert.equal((await f.approve(order)).status,200);assert.deepEqual(await f.db.prepare('SELECT * FROM entitlements').first(),first);
    const other=await f.order('other');assert.equal((await f.approve(other)).status,409);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM entitlements').first()).n,1);
  }finally{f.db.close();}
});
test('CSRF and foreign-origin requests cannot create orders',async()=>{const f=await setup();try{
  for(const headers of [{'X-CSRF-Token':'wrong'},{Origin:'https://attacker.example'}])assert.equal((await f.call('/hicheel/api/orders',{user:'learner',body:{course_id:f.course.id},headers})).status,403);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM orders').first()).n,0);
}finally{f.db.close();}});
test('private GET, HEAD, Range and encoded paths authorize before opening assets',async()=>{const f=await setup();try{
  for(const method of ['GET','HEAD'])for(const path of ['/hicheel/private/lesson_01_mn.mp4','/hicheel/%70rivate/lesson_01_mn.mp4','/hicheel/private%2Flesson_01_mn.mp4']){
    const r=await f.call(path,{method,headers:{Range:'bytes=0-1'}});assert.equal(r.status,401);if(method==='HEAD')assert.equal(await r.text(),'');}
  assert.equal((await f.call('/hicheel/private/lesson_01_mn.mp4',{user:'learner'})).status,403);assert.equal(f.assetCalls,0);
}finally{f.db.close();}});
test('authorized ranges/HEAD return exact bytes and private headers; wrong encoding fails closed',async()=>{const f=await setup();try{
  await f.approve(await f.order());const path='/hicheel/private/lesson_01_mn.mp4';
  for(const [range,expected,contentRange]of [['bytes=2-5','2345','bytes 2-5/10'],['bytes=-3','789','bytes 7-9/10'],['bytes=8-','89','bytes 8-9/10']]){
    const r=await f.call(path,{user:'learner',headers:{Range:range}});assert.equal(r.status,206);assert.equal(await r.text(),expected);assert.equal(r.headers.get('Content-Range'),contentRange);assert.equal(r.headers.get('Content-Length'),String(expected.length));assert.match(r.headers.get('Cache-Control'),/private.*no-store/);assert.equal(r.headers.get('Content-Encoding'),null);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);assert.equal(f.lastAssetRequest.headers.get('Accept-Encoding'),'identity');}
  const head=await f.call(path,{user:'learner',method:'HEAD',headers:{Range:'bytes=0-1'}});assert.equal(head.status,200);assert.equal(head.headers.get('Content-Length'),'10');assert.equal(head.headers.get('Content-Range'),null);assert.equal(await head.text(),'');
  const changed=await f.call(path,{user:'learner',headers:{Range:'bytes=0-1','If-Range':'"unknown-version"'}});assert.equal(changed.status,200);assert.equal(await changed.text(),'0123456789');assert.equal(changed.headers.get('Content-Range'),null);
  const invalid=await f.call(path,{user:'learner',headers:{Range:'bytes=99-100'}});assert.equal(invalid.status,416);assert.equal(invalid.headers.get('Content-Range'),'bytes */10');
  f.env.ASSETS.fetch=async()=>new Response('compressed',{headers:{'Content-Encoding':'br','Content-Length':'10'}});
  assert.equal((await f.call(path,{user:'learner',headers:{Range:'bytes=0-1'}})).status,503);
}finally{f.db.close();}});
test('revoked/expired entitlement denies the next media request and progress update',async()=>{const f=await setup();try{
  const o=await f.order();await f.approve(o);assert.equal((await f.call('/hicheel/api/progress',{user:'learner',body:{lesson_id:f.lesson.id,position_seconds:5,completed:false,user_id:ids.other}})).status,200);
  assert.equal((await f.db.prepare('SELECT user_id FROM progress').first()).user_id,ids.learner);
  assert.equal((await f.call('/hicheel/api/admin/revoke',{user:'admin',body:{order_id:o.id,reason:'Requested by learner'}})).status,200);
  assert.equal((await f.call('/hicheel/private/lesson_01_mn.mp4',{user:'learner',method:'HEAD'})).status,403);
  assert.equal((await f.call('/hicheel/api/progress',{user:'learner',body:{lesson_id:f.lesson.id,position_seconds:9,completed:true}})).status,403);
  await f.db.prepare('UPDATE entitlements SET active=1,expires_at=?').bind(nowSeconds()-1).run();
  assert.equal((await f.call('/hicheel/private/lesson_01_mn.mp4',{user:'learner'})).status,403);assert.equal(f.assetCalls,0);
}finally{f.db.close();}});
test('D1 quota exhaustion never falls through to the private static asset',async()=>{const f=await setup();try{
  f.env.DB={prepare(){throw new Error('D1 daily quota exceeded');}};
  for(const method of ['GET','HEAD']){const r=await f.call('/hicheel/private/lesson_01_mn.mp4',{user:'learner',method,headers:{Range:'bytes=0-1'}});assert.equal(r.status,503);}
  assert.equal(f.assetCalls,0);
}finally{f.db.close();}});
test('bounded maintenance removes only stale rate rows and expired sessions',async()=>{const f=await setup();try{
  f.db.exec('BEGIN');for(let i=0;i<601;i++){f.db.sqlite.prepare('INSERT INTO rate_limits(key,minute,count) VALUES(?,?,1)').run('old-'+i,1);f.db.sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,1)').run('expired-'+i,ids.learner);}f.db.exec('COMMIT');
  await f.db.prepare('INSERT INTO rate_limits(key,minute,count) VALUES(?,?,1)').bind('current',Math.floor(nowSeconds()/60)).run();await maintenance(f.env);
  assert.equal((await f.db.prepare("SELECT count(*) AS n FROM rate_limits WHERE key LIKE 'old-%'").first()).n,101);
  assert.equal((await f.db.prepare("SELECT count(*) AS n FROM sessions WHERE token_hash LIKE 'expired-%'").first()).n,101);
  assert.equal((await f.db.prepare("SELECT count(*) AS n FROM sessions WHERE expires_at>?").bind(nowSeconds()).first()).n,3);
  assert.ok(await f.db.prepare("SELECT * FROM rate_limits WHERE key='current'").first());
}finally{f.db.close();}});
test('Google token must have a valid signature, audience, issuer, expiry and login nonce',async()=>{
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key',alg:'RS256',use:'sig'};const previous=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({keys:[jwk]}),{headers:{'Content-Type':'application/json','Cache-Control':'max-age=300'}});
  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const claims={iss:'https://accounts.google.com',aud:'test.apps.googleusercontent.com',sub:'1234567890',email:'test@example.test',email_verified:true,nonce:csrf,iat:nowSeconds(),exp:nowSeconds()+3600};
  async function token(data){const input=encode({alg:'RS256',kid:'test-key'})+'.'+encode(data);const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(input));return input+'.'+Buffer.from(signature).toString('base64url');}
  try{const valid=await token(claims);assert.equal((await verifyGoogleToken(valid,claims.aud,csrf)).sub,claims.sub);
    for(const data of [{...claims,aud:'other.apps.googleusercontent.com'},{...claims,iss:'https://attacker.example'},{...claims,exp:nowSeconds()-1},{...claims,nonce:'wrong'},{...claims,email_verified:false}])await assert.rejects(verifyGoogleToken(await token(data),claims.aud,csrf),{code:'INVALID_GOOGLE_TOKEN'});
    const parts=valid.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);await assert.rejects(verifyGoogleToken(parts.join('.'),claims.aud,csrf),{code:'INVALID_GOOGLE_TOKEN'});
    const f=await setup();try{
      const login=await f.call('/hicheel/api/auth/google',{body:{credential:valid}});assert.equal(login.status,200);
      const cookie=login.headers.get('Set-Cookie');assert.match(cookie,/Secure; HttpOnly; SameSite=Strict/);
      const raw=/__Host-tbplan_session=([a-f0-9]{64})/.exec(cookie)[1];
      const stored=await f.db.prepare('SELECT s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.google_sub=?').bind(claims.sub).first();assert.equal(stored.token_hash,await hash(raw));assert.notEqual(stored.token_hash,raw);
      const headers={Cookie:`__Host-tbplan_session=${raw}; __Host-tbplan_csrf=${csrf}`};
      assert.equal((await (await f.call('/hicheel/api/me',{headers})).json()).user.google_sub,claims.sub);
      assert.equal((await f.call('/hicheel/api/logout',{body:{},headers})).status,200);
      assert.equal((await (await f.call('/hicheel/api/me',{headers})).json()).user,null);
    }finally{f.db.close();}
  }finally{globalThis.fetch=previous;}
});
