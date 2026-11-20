export class HttpError extends Error {
  constructor(status,code){super(code);this.status=status;this.code=code;}
}
export const nowSeconds=()=>Math.floor(Date.now()/1000);
export const randomToken=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
export function uuid(value){if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))throw new HttpError(400,'INVALID_ID');return value;}
export function cookies(request){
  const out={};for(const item of (request.headers.get('Cookie')||'').split(';')){
    const i=item.indexOf('=');if(i<0)continue;const key=item.slice(0,i).trim(),value=item.slice(i+1).trim();
    // Reject duplicate authentication cookies instead of accepting an ambiguous value.
    if(key in out)out[key]='';else out[key]=value;
  }return out;
}
export const sessionCookie=(token,age=86400)=>`__Host-tbplan_session=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
export const csrfCookie=token=>`__Host-tbplan_csrf=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400`;
export function checkMutation(request,env){
  if(request.headers.get('Origin')!==env.SITE_ORIGIN)throw new HttpError(403,'ORIGIN_DENIED');
  const expected=cookies(request)['__Host-tbplan_csrf'];
  if(!/^[a-f0-9]{64}$/.test(expected||'')||!equal(expected,request.headers.get('X-CSRF-Token')))throw new HttpError(403,'CSRF_DENIED');
  return expected;
}
export async function readJson(request){
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new HttpError(415,'JSON_REQUIRED');
  if(Number(request.headers.get('Content-Length')||0)>16384)throw new HttpError(413,'BODY_TOO_LARGE');
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'INVALID_JSON');let n=0;const chunks=[];
  while(true){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>16384){await reader.cancel();throw new HttpError(413,'BODY_TOO_LARGE');}chunks.push(p.value);}
  const raw=new Uint8Array(n);let pos=0;for(const chunk of chunks){raw.set(chunk,pos);pos+=chunk.length;}
  try{const data=JSON.parse(new TextDecoder().decode(raw));if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();return data;}catch{throw new HttpError(400,'INVALID_JSON');}
}
export function canonicalPath(path){
  let decoded;try{decoded=decodeURIComponent(path);}catch{throw new HttpError(400,'INVALID_PATH');}
  if(decoded.includes('%')||decoded.includes('\\')||decoded.includes('//')||/[\x00-\x1f\x7f]/.test(decoded)||decoded.split('/').some(x=>x==='.'||x==='..'))throw new HttpError(400,'INVALID_PATH');
  return decoded;
}
export async function limit(db,key,max=60){
  const minute=Math.floor(nowSeconds()/60);
  const row=await db.prepare(`INSERT INTO rate_limits(key,minute,count) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.minute=excluded.minute THEN rate_limits.count+1 ELSE 1 END,
    minute=excluded.minute RETURNING count`).bind(key,minute).first();
  if(!row||row.count>max)throw new HttpError(429,'RATE_LIMITED');
}
export async function requireUser(request,env){
  if(!env.DB)throw new HttpError(503,'DATABASE_NOT_CONFIGURED');
  const token=cookies(request)['__Host-tbplan_session'];if(!/^[a-f0-9]{64}$/.test(token||''))throw new HttpError(401,'SIGN_IN_REQUIRED');
  const user=await env.DB.prepare(`SELECT u.id,u.google_sub,u.email,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).bind(await hash(token),nowSeconds()).first();
  if(!user)throw new HttpError(401,'SIGN_IN_REQUIRED');
  return user;
}
export function isAdmin(user,env){return /^[0-9]{1,255}$/.test(env.ADMIN_GOOGLE_SUB||'')&&equal(user.google_sub,env.ADMIN_GOOGLE_SUB);}
export async function access(db,userId,courseId){return !!await db.prepare('SELECT 1 FROM entitlements WHERE user_id=? AND course_id=? AND active=1 AND (expires_at IS NULL OR expires_at>?)').bind(userId,courseId,nowSeconds()).first();}

let googleCache=null;
function decode64(s){if(typeof s!=='string'||!/^[A-Za-z0-9_-]+$/.test(s))throw new HttpError(401,'INVALID_GOOGLE_TOKEN');const b=atob(s.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(s.length/4)*4,'='));return Uint8Array.from(b,c=>c.charCodeAt(0));}
export async function verifyGoogleToken(token,clientId,nonce){
  if(typeof clientId!=='string'||!clientId.endsWith('.apps.googleusercontent.com'))throw new HttpError(503,'GOOGLE_NOT_CONFIGURED');
  if(typeof token!=='string'||token.length>8192)throw new HttpError(401,'INVALID_GOOGLE_TOKEN');
  const parts=token.split('.');if(parts.length!==3)throw new HttpError(401,'INVALID_GOOGLE_TOKEN');
  let header,payload;try{header=JSON.parse(new TextDecoder().decode(decode64(parts[0])));payload=JSON.parse(new TextDecoder().decode(decode64(parts[1])));}catch{throw new HttpError(401,'INVALID_GOOGLE_TOKEN');}
  const now=nowSeconds();
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.crit!==undefined
    ||!['accounts.google.com','https://accounts.google.com'].includes(payload.iss)||payload.aud!==clientId
    ||(payload.azp!==undefined&&payload.azp!==clientId)||!Number.isInteger(payload.exp)||payload.exp<=now
    ||!Number.isInteger(payload.iat)||payload.iat>now+60||payload.exp-payload.iat>7200
    ||(payload.nbf!==undefined&&payload.nbf>now+60)||!equal(payload.nonce,nonce)
    ||typeof payload.sub!=='string'||!/^[0-9]{1,255}$/.test(payload.sub)
    ||payload.email_verified!==true||typeof payload.email!=='string'||payload.email.length>320)
    throw new HttpError(401,'INVALID_GOOGLE_TOKEN');
  if(!googleCache||googleCache.expires<=now||!googleCache.keys.some(k=>k.kid===header.kid)){
    let response,data;try{response=await fetch('https://www.googleapis.com/oauth2/v3/certs',{signal:AbortSignal.timeout(8000)});data=await response.json();}catch{throw new HttpError(503,'GOOGLE_KEYS_UNAVAILABLE');}
    if(!response.ok||!Array.isArray(data.keys))throw new HttpError(503,'GOOGLE_KEYS_UNAVAILABLE');
    const seconds=Number(/max-age=(\d+)/i.exec(response.headers.get('Cache-Control')||'')?.[1]||300);
    googleCache={keys:data.keys,expires:now+Math.max(0,Math.min(seconds,3600))};
  }
  const jwk=googleCache.keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.alg==='RS256'&&k.use==='sig');
  if(!jwk)throw new HttpError(401,'INVALID_GOOGLE_TOKEN');
  try{const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode64(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`)))throw new Error();
  }catch{throw new HttpError(401,'INVALID_GOOGLE_TOKEN');}
  return {sub:payload.sub,email:payload.email,name:typeof payload.name==='string'?payload.name.slice(0,120):''};
}
