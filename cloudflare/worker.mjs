import {HttpError,access,canonicalPath,checkMutation,cookies,csrfCookie,hash,isAdmin,limit,nowSeconds,randomToken,readJson,requireUser,sessionCookie,uuid,verifyGoogleToken} from './security.mjs';
import {servePrivate} from './media.mjs';
import {maintenance} from './maintenance.mjs';
import {privateContent} from './content.mjs';
const API='/hicheel/api';
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff',...extra}});
const bankReady=env=>!!(env.BANK_NAME&&env.BANK_ACCOUNT&&env.BANK_HOLDER);
const bank=env=>({name:env.BANK_NAME,account:env.BANK_ACCOUNT,holder:env.BANK_HOLDER});
const orderView=o=>({id:o.id,course_id:o.course_id,reference:o.reference,amount_mnt:o.amount_mnt,access_days:o.access_days,status:o.status,created_at:o.created_at});
const courseBool=c=>({...c,published:!!c.published,enrollment_open:!!c.enrollment_open});

async function publicConfig(request,env){
  const previous=cookies(request)['__Host-tbplan_csrf'];
  const csrf=/^[a-f0-9]{64}$/.test(previous||'')?previous:randomToken();
  return json({ready:!!env.DB&&String(env.GOOGLE_CLIENT_ID||'').endsWith('.apps.googleusercontent.com'),
    google_client_id:env.GOOGLE_CLIENT_ID||'',csrf,course_slug:'tbplan-action-foundations',payment_mode:'manual_bank'},200,{'Set-Cookie':csrfCookie(csrf)});
}
async function catalog(env){
  const course=await env.DB.prepare('SELECT id,slug,title,subtitle,price_mnt,access_days,published,enrollment_open FROM courses WHERE slug=? AND published=1').bind('tbplan-action-foundations').first();
  if(!course)throw new HttpError(404,'COURSE_NOT_FOUND');
  const result=await env.DB.batch([
    env.DB.prepare('SELECT id,course_id,title,sort_order FROM modules WHERE course_id=? ORDER BY sort_order').bind(course.id),
    env.DB.prepare('SELECT id,course_id,module_id,slug,title,objective,duration_seconds,sort_order,is_preview,published FROM lessons WHERE course_id=? AND published=1 ORDER BY sort_order').bind(course.id)
  ]);
  course.enrollment_open=course.enrollment_open&&env.ENROLLMENT_ENABLED==='1'&&bankReady(env)?1:0;
  return json({course:courseBool(course),modules:result[0].results,lessons:result[1].results.map(x=>({...x,is_preview:!!x.is_preview,published:!!x.published}))});
}
async function login(request,env,csrf){
  await limit(env.DB,'login:'+await hash(request.headers.get('CF-Connecting-IP')||'unknown'),10);
  const body=await readJson(request);const google=await verifyGoogleToken(body.credential,env.GOOGLE_CLIENT_ID,csrf);
  const user=await env.DB.prepare(`INSERT INTO users(id,google_sub,email,display_name) VALUES(?,?,?,?)
    ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email,display_name=excluded.display_name RETURNING id`).bind(crypto.randomUUID(),google.sub,google.email,google.name).first();
  const token=randomToken();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await hash(token),user.id,nowSeconds()+86400),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN(SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC,expires_at DESC LIMIT 5)').bind(user.id,user.id)
  ]);
  return json({ok:true},200,{'Set-Cookie':sessionCookie(token)});
}
async function me(request,env){
  let user;try{user=await requireUser(request,env);}catch(error){if(error.status===401)return json({user:null,entitlements:[],progress:[]});throw error;}
  const rows=await env.DB.batch([
    env.DB.prepare('SELECT course_id,active,expires_at FROM entitlements WHERE user_id=?').bind(user.id),
    env.DB.prepare('SELECT lesson_id,course_id,position_seconds,completed,updated_at FROM progress WHERE user_id=?').bind(user.id)
  ]);
  return json({user:{...user,is_admin:isAdmin(user,env)},
    entitlements:rows[0].results.map(x=>({...x,active:!!x.active,expires_at:x.expires_at===null?null:new Date(x.expires_at*1000).toISOString()})),
    progress:rows[1].results.map(x=>({...x,completed:!!x.completed}))});
}
async function createOrder(request,env,user){
  if(env.ENROLLMENT_ENABLED!=='1'||!bankReady(env))throw new HttpError(409,'COURSE_CLOSED');
  const body=await readJson(request);const course=await env.DB.prepare('SELECT * FROM courses WHERE id=? AND published=1 AND enrollment_open=1').bind(uuid(body.course_id)).first();
  if(!course||!Number.isSafeInteger(course.price_mnt)||course.price_mnt<1)throw new HttpError(409,'COURSE_CLOSED');
  if(await access(env.DB,user.id,course.id))return json({status:'paid',access_granted:true});
  const id=crypto.randomUUID(),reference='TB-'+id.replaceAll('-','').slice(0,16).toUpperCase();
  await env.DB.prepare(`INSERT INTO orders(id,user_id,course_id,reference,amount_mnt,access_days) VALUES(?,?,?,?,?,?)
    ON CONFLICT(user_id,course_id) WHERE status='pending' DO NOTHING`).bind(id,user.id,course.id,reference,course.price_mnt,course.access_days).run();
  const order=await env.DB.prepare("SELECT * FROM orders WHERE user_id=? AND course_id=? AND status='pending'").bind(user.id,course.id).first();
  if(!order)throw new HttpError(503,'ORDER_UNAVAILABLE');
  return json({order:orderView(order),bank:bank(env),access_granted:false});
}
async function getOrder(env,user,id){
  const order=await env.DB.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').bind(uuid(id),user.id).first();
  if(!order)throw new HttpError(404,'ORDER_NOT_FOUND');
  return json({order:orderView(order),access_granted:await access(env.DB,user.id,order.course_id)});
}
async function lessonAccess(env,user,id){
  const lesson=await env.DB.prepare(`SELECT l.* FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=? AND l.published=1 AND c.published=1`).bind(uuid(id)).first();
  if(!lesson)throw new HttpError(404,'LESSON_NOT_FOUND');
  if(!lesson.is_preview&&!await access(env.DB,user.id,lesson.course_id))throw new HttpError(403,'COURSE_ACCESS_REQUIRED');
  return lesson;
}
async function playback(request,env,user){
  const body=await readJson(request),lesson=await lessonAccess(env,user,body.lesson_id);
  const asset=await env.DB.prepare('SELECT * FROM lesson_assets WHERE lesson_id=?').bind(lesson.id).first();
  if(!asset?.media_path||!asset.media_bytes)throw new HttpError(503,'LESSON_VIDEO_NOT_READY');
  const content=privateContent({worksheet_text:asset.worksheet_text,quiz:JSON.parse(asset.quiz_json)});
  return json({title:lesson.title,playback_url:asset.media_path,captions_url:asset.captions_path,...content});
}
async function saveProgress(request,env,user){
  const body=await readJson(request),lesson=await lessonAccess(env,user,body.lesson_id);
  if(typeof body.position_seconds!=='number'||!Number.isFinite(body.position_seconds)||body.position_seconds<0||body.position_seconds>=86400||typeof body.completed!=='boolean')throw new HttpError(400,'INVALID_PROGRESS');
  await env.DB.prepare(`INSERT INTO progress(user_id,lesson_id,course_id,position_seconds,completed) VALUES(?,?,?,?,?)
    ON CONFLICT(user_id,lesson_id) DO UPDATE SET position_seconds=excluded.position_seconds,completed=max(progress.completed,excluded.completed),updated_at=unixepoch()`)
    .bind(user.id,lesson.id,lesson.course_id,Math.min(body.position_seconds,lesson.duration_seconds||86399),body.completed?1:0).run();
  return json({ok:true});
}
async function adminOrders(env){
  return json({orders:(await env.DB.prepare(`SELECT o.*,u.email,u.display_name,p.bank_reference FROM orders o JOIN users u ON u.id=o.user_id
    LEFT JOIN manual_payments p ON p.order_id=o.id ORDER BY o.created_at DESC LIMIT 100`).all()).results});
}
async function approveOrder(request,env,user){
  const body=await readJson(request),id=uuid(body.order_id);
  const reference=typeof body.bank_reference==='string'?body.bank_reference.normalize('NFKC').trim().toUpperCase():'';
  if(body.confirmed_in_bank!==true||!Number.isSafeInteger(body.amount_mnt)||body.amount_mnt<1||!/^[A-Z0-9._:/ -]{3,120}$/.test(reference))throw new HttpError(400,'BANK_VERIFICATION_REQUIRED');
  const order=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
  if(!order)throw new HttpError(404,'ORDER_NOT_FOUND');
  const previous=await env.DB.prepare('SELECT * FROM manual_payments WHERE order_id=?').bind(id).first();
  if(order.status==='paid'&&previous?.bank_reference===reference&&previous.amount_mnt===body.amount_mnt)return json({status:'paid',unchanged:true});
  if(order.status!=='pending'||order.amount_mnt!==body.amount_mnt)throw new HttpError(409,'PAYMENT_AMOUNT_OR_STATUS_MISMATCH');
  const used=await env.DB.prepare('SELECT order_id FROM manual_payments WHERE bank_reference=?').bind(reference).first();
  if(used)throw new HttpError(409,'BANK_REFERENCE_ALREADY_USED');
  await env.DB.prepare('INSERT INTO manual_payments(order_id,bank_reference,amount_mnt,confirmed_by) VALUES(?,?,?,?)').bind(id,reference,body.amount_mnt,user.id).run();
  return json({status:'paid',unchanged:false});
}
async function revokeOrder(request,env,user){
  const body=await readJson(request),id=uuid(body.order_id);
  const note=typeof body.reason==='string'?body.reason.trim():'';if(note.length<3||note.length>500)throw new HttpError(400,'REASON_REQUIRED');
  const order=await env.DB.prepare('SELECT status FROM orders WHERE id=?').bind(id).first();
  if(!order||!['paid','revoked'].includes(order.status))throw new HttpError(409,'PAID_ORDER_REQUIRED');
  if(order.status==='revoked')return json({status:'revoked',unchanged:true});
  await env.DB.batch([
    env.DB.prepare("UPDATE orders SET status='revoked' WHERE id=? AND status='paid'").bind(id),
    env.DB.prepare("INSERT INTO audit_events(id,order_id,actor_id,event_type,note) VALUES(?,?,?,'access_revoked',?) ON CONFLICT(order_id,event_type) DO NOTHING").bind(crypto.randomUUID(),id,user.id,note)
  ]);
  return json({status:'revoked',money_refund_performed:false});
}
async function api(request,env,path){
  if(request.method==='GET'&&path===API+'/config')return publicConfig(request,env);
  if(!env.DB)throw new HttpError(503,'DATABASE_NOT_CONFIGURED');
  if(request.method==='GET'&&path===API+'/catalog')return catalog(env);
  if(request.method==='GET'&&path===API+'/me')return me(request,env);
  let csrf;if(request.method==='POST')csrf=checkMutation(request,env);
  if(request.method==='POST'&&path===API+'/auth/google')return login(request,env,csrf);
  const user=await requireUser(request,env);
  if(request.method==='POST')await limit(env.DB,'user:'+user.id,120);
  if(request.method==='POST'&&path===API+'/logout'){
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(cookies(request)['__Host-tbplan_session'])).run();
    return json({ok:true},200,{'Set-Cookie':sessionCookie('',0)});
  }
  if(request.method==='POST'&&path===API+'/orders')return createOrder(request,env,user);
  if(request.method==='GET'&&path.startsWith(API+'/orders/'))return getOrder(env,user,path.slice((API+'/orders/').length));
  if(request.method==='POST'&&path===API+'/playback')return playback(request,env,user);
  if(request.method==='POST'&&path===API+'/progress')return saveProgress(request,env,user);
  if(path.startsWith(API+'/admin/')){
    if(!isAdmin(user,env))throw new HttpError(403,'ADMIN_REQUIRED');
    if(request.method==='GET'&&path===API+'/admin/orders')return adminOrders(env);
    if(request.method==='POST'&&path===API+'/admin/approve')return approveOrder(request,env,user);
    if(request.method==='POST'&&path===API+'/admin/revoke')return revokeOrder(request,env,user);
  }
  throw new HttpError(404,'NOT_FOUND');
}
export default {
  async fetch(request,env){
    try{
      const url=new URL(request.url),path=canonicalPath(url.pathname);
      const sensitive=path.toLowerCase().startsWith('/hicheel/private')||path.startsWith(API);
      if(sensitive&&env.FREE_MODE!=='1')throw new HttpError(503,'FREE_DEPLOYMENT_NOT_CONFIGURED');
      if(path.toLowerCase().startsWith('/hicheel/private'))return await servePrivate(request,env,path);
      if(path.startsWith(API))return await api(request,env,path);
      if(!['GET','HEAD'].includes(request.method))throw new HttpError(405,'METHOD_NOT_ALLOWED');
      if(path==='/hicheel')return Response.redirect(url.origin+'/hicheel/',308);
      url.pathname=path==='/'?'/index.html':path==='/hicheel/'?'/hicheel/index.html':path;
      const result=await env.ASSETS.fetch(new Request(url,request));
      const headers=new Headers(result.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','strict-origin-when-cross-origin');
      if(path.startsWith('/hicheel')){headers.set('Cross-Origin-Opener-Policy','same-origin-allow-popups');headers.set('X-Frame-Options','DENY');}
      return new Response(result.body,{status:result.status,headers});
    }catch(error){
      // Database quota exhaustion, missing bindings, auth failures and any other
      // error NEVER fall back to ASSETS. No payment or media secrets are logged.
      const known=error instanceof HttpError,status=known?error.status:503;
      const response=json({error:{code:known?error.code:'SERVICE_UNAVAILABLE',message:'Үйлчилгээг одоогоор гүйцэтгэх боломжгүй байна. Дахин оролдоно уу.'}},status);
      return request.method==='HEAD'?new Response(null,{status,headers:response.headers}):response;
    }
  },
  async scheduled(_controller,env,ctx){ctx.waitUntil(maintenance(env));}
};
