import {HttpError,access,requireUser} from './security.mjs';
export const MAX_ASSET_BYTES=25*1024*1024;
export function byteRange(value,size){
  if(!value)return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(value);
  if(!match||(!match[1]&&!match[2]))throw new HttpError(416,'INVALID_RANGE');
  let start,end;
  if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<1)throw new HttpError(416,'INVALID_RANGE');start=Math.max(0,size-suffix);end=size-1;}
  else{start=Number(match[1]);end=match[2]?Number(match[2]):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)throw new HttpError(416,'INVALID_RANGE');
  return {start,end:Math.min(end,size-1)};
}
function sliceStream(body,start,end){
  const reader=body.getReader();let offset=0,done=false;
  return new ReadableStream({
    async pull(controller){
      try{while(!done){const part=await reader.read();if(part.done){done=true;controller.close();return;}
        const left=Math.max(0,start-offset),right=Math.min(part.value.length,end+1-offset);offset+=part.value.length;
        if(right>left)controller.enqueue(part.value.subarray(left,right));
        if(offset>end){done=true;await reader.cancel();controller.close();return;}
        if(right>left)return;
      }}catch{done=true;controller.error(new Error('Media stream interrupted'));}
    },async cancel(reason){done=true;await reader.cancel(reason);}
  });
}
export async function servePrivate(request,env,path){
  if(!['GET','HEAD'].includes(request.method))throw new HttpError(405,'METHOD_NOT_ALLOWED');
  const user=await requireUser(request,env);
  const asset=await env.DB.prepare(`SELECT l.id,l.course_id,l.is_preview,a.media_path,a.captions_path,a.media_bytes
    FROM lesson_assets a JOIN lessons l ON l.id=a.lesson_id JOIN courses c ON c.id=l.course_id
    WHERE (a.media_path=? OR a.captions_path=?) AND l.published=1 AND c.published=1`).bind(path,path).first();
  if(!asset)throw new HttpError(404,'MEDIA_NOT_FOUND');
  if(!asset.is_preview&&!await access(env.DB,user.id,asset.course_id))throw new HttpError(403,'COURSE_ACCESS_REQUIRED');
  // The binding is reached only after authentication + authorization on EVERY
  // GET, HEAD and Range request. No public URL or alternate origin is returned.
  const url=new URL(request.url);url.pathname=path;url.search='';
  const upstreamHeaders=new Headers({'Accept-Encoding':'identity'});
  const result=await env.ASSETS.fetch(new Request(url,{method:request.method,headers:upstreamHeaders}));
  if(!result.ok)throw new HttpError(503,'MEDIA_NOT_READY');
  if(result.headers.get('Content-Encoding')&&!/^identity$/i.test(result.headers.get('Content-Encoding'))){await result.body?.cancel();throw new HttpError(503,'MEDIA_ENCODING_UNSUPPORTED');}
  const size=Number(result.headers.get('Content-Length'));
  if(!Number.isSafeInteger(size)||size<1||size>MAX_ASSET_BYTES)throw new HttpError(503,'MEDIA_SIZE_INVALID');
  if(path===asset.media_path&&asset.media_bytes!==size)throw new HttpError(503,'MEDIA_VERSION_MISMATCH');
  const headers=new Headers({
    'Content-Type':path.endsWith('.mp4')?'video/mp4':'text/vtt; charset=utf-8',
    'Content-Length':String(size),'Accept-Ranges':'bytes','Cache-Control':'private, no-store, max-age=0',
    Pragma:'no-cache',Vary:'Cookie','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin',
    'Content-Security-Policy':"frame-ancestors 'self'",'Referrer-Policy':'no-referrer'
  });
  // RFC 9110: Range applies only to GET. We expose no validators, so an
  // If-Range value cannot match and safely falls back to the full response.
  let range;
  try{range=request.method==='GET'&&!request.headers.has('If-Range')?byteRange(request.headers.get('Range'),size):null;}catch(error){
    await result.body?.cancel();headers.set('Content-Range',`bytes */${size}`);headers.delete('Content-Length');
    return new Response(null,{status:416,headers});
  }
  if(range){headers.set('Content-Range',`bytes ${range.start}-${range.end}/${size}`);headers.set('Content-Length',String(range.end-range.start+1));}
  if(request.method==='HEAD'){await result.body?.cancel();return new Response(null,{status:200,headers});}
  if(!result.body)throw new HttpError(503,'MEDIA_NOT_READY');
  return new Response(range?sliceStream(result.body,range.start,range.end):result.body,{status:range?206:200,headers});
}
