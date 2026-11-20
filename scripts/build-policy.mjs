import {readdir,readFile,lstat,stat} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
export const MAX_BYTES=25*1024*1024;
export const PUBLIC_HICHEEL_FILES=Object.freeze(['index.html','app.js','catalog.js','styles.css','fonts.css','admin.html','admin.js','privacy.html']);
export function parsePublicCatalog(source){
  const match=/^(?:\/\/[^\n]*\n)*export const plannedCatalog = Object\.freeze\((\{[\s\S]*\})\);\s*$/.exec(source);
  if(!match)throw new Error('Public catalog must contain only the JSON outline export.');
  const data=JSON.parse(match[1]);
  const keys=(value,expected)=>{if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).sort().join('|')!==expected.split(' ').sort().join('|'))throw new Error('Unapproved public catalog keys.');};
  const text=(value,max)=>{if(typeof value!=='string'||value.length<1||value.length>max)throw new Error('Public catalog text must be a short outline.');};
  const integer=value=>Number.isSafeInteger(value)&&value>0;
  keys(data,'slug title subtitle price_mnt access_days published modules lessons');
  text(data.slug,100);text(data.title,160);text(data.subtitle,300);
  if((data.price_mnt!==null&&!integer(data.price_mnt))||(data.access_days!==null&&!integer(data.access_days))||typeof data.published!=='boolean'||!Array.isArray(data.modules)||data.modules.length!==5||!Array.isArray(data.lessons)||data.lessons.length!==19)throw new Error('Invalid public course outline.');
  const modules=new Set(),lessons=new Set();
  for(const row of data.modules){keys(row,'id title sort_order');text(row.id,100);text(row.title,160);if(modules.has(row.id)||!integer(row.sort_order))throw new Error('Invalid public module.');modules.add(row.id);}
  for(const row of data.lessons){keys(row,'id slug title objective module_id sort_order duration_seconds is_preview published');text(row.id,100);text(row.slug,100);text(row.title,160);text(row.objective,400);if(lessons.has(row.id)||!modules.has(row.module_id)||!integer(row.sort_order)||(row.duration_seconds!==null&&!integer(row.duration_seconds))||typeof row.is_preview!=='boolean'||typeof row.published!=='boolean')throw new Error('Invalid public lesson outline.');lessons.add(row.id);}
  return data;
}
export function assertFreeConfig(config){
  if(config.assets?.run_worker_first!==true||config.workers_dev!==false||config.preview_urls!==false||config.assets?.html_handling!=='none'||config.assets?.binding!=='ASSETS')throw new Error('Private asset routing guard must remain enabled.');
  if(config.r2_buckets?.length||config.kv_namespaces?.length||config.durable_objects||config.ai)throw new Error('Only Free Workers Static Assets + D1 bindings are permitted in this variant.');
}
export async function validateAssets(out,privateHashes=new Set()){
  let count=0;
  async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
    const file=resolve(dir,entry.name),info=await lstat(file);if(info.isSymbolicLink())throw new Error('Symlink in static assets');
    if(entry.isDirectory()){await walk(file);continue;}if(!info.isFile()||info.size>MAX_BYTES)throw new Error('Static asset exceeds the 25 MiB limit: '+relative(out,file));count++;
    const path=relative(out,file);
    if(path.startsWith('hicheel/')&&!PUBLIC_HICHEEL_FILES.some(name=>path==='hicheel/'+name)&&!/^hicheel\/private\/[A-Za-z0-9_-]+\.(?:mp4|vtt)$/.test(path))throw new Error('Unapproved course file in public output: '+path);
    if(path==='hicheel/catalog.js')parsePublicCatalog(await readFile(file,'utf8'));
    if(privateHashes.size&&!relative(out,file).startsWith('hicheel/private/')&&privateHashes.has(createHash('sha256').update(await readFile(file)).digest('hex')))throw new Error('Paid media duplicated at a public path: '+relative(out,file));
  }}
  await walk(out);if(count>20000)throw new Error('Free static asset file-count limit exceeded.');
  for(const bad of ['cloudflare','tests','scripts','private-media','build-private','package.json','wrangler.jsonc','.env','.git']){try{await stat(resolve(out,bad));throw new Error('Non-public source in asset output: '+bad);}catch(error){if(error.code!=='ENOENT')throw error;}}
  return count;
}
