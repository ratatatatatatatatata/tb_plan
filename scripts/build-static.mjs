import {cp,mkdir,readdir,readFile,rm,stat,writeFile,lstat} from 'node:fs/promises';
import {resolve,relative,basename,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {assertFreeConfig,validateAssets,PUBLIC_HICHEEL_FILES} from './build-policy.mjs';
import {privateContent} from '../cloudflare/content.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'dist'),maxBytes=25*1024*1024;
const config=JSON.parse(await readFile(resolve(root,'wrangler.jsonc'),'utf8'));
assertFreeConfig(config);
const tracked=execFileSync('git',['ls-tree','-r','--name-only','HEAD','images','videos'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const missing=[];for(const name of tracked){try{await stat(resolve(root,name));}catch{missing.push(name);}}
if(missing.length&&process.env.ALLOW_SPARSE_PREVIEW!=='1')throw new Error(`Missing ${missing.length} original company media files. Run git sparse-checkout disable before a real deployment. ALLOW_SPARSE_PREVIEW=1 is for local source preview only.`);
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
const rootFiles=['index.html','index.css','index.js','design.html','food.html','materials.html','media.html','uilchilgee.html','web.html','robots.txt','sitemap.xml','favicon.ico'];
for(const name of rootFiles){try{await cp(resolve(root,name),resolve(out,name));}catch(e){if(e.code!=='ENOENT')throw e;}}
// Explicit public course files only. A production course.json, narration text,
// quiz export or build script dropped into hicheel/ cannot become public.
for(const name of [...tracked,...PUBLIC_HICHEEL_FILES.map(name=>'hicheel/'+name)]){
  try{await mkdir(resolve(out,name,'..'),{recursive:true});await cp(resolve(root,name),resolve(out,name));}
  catch(e){if(e.code!=='ENOENT'||name.startsWith('hicheel/'))throw e;}
}
const mediaDir=process.env.TBPLAN_PRIVATE_MEDIA_DIR,privateHashes=new Set(),sql=[];let mediaCount=0,worksheetCount=0,quizCount=0;
if(mediaDir){
  const input=resolve(mediaDir),manifestPath=resolve(process.env.TBPLAN_MEDIA_MANIFEST||resolve(input,'manifest.json'));
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));if(!Array.isArray(manifest)||manifest.length!==19)throw new Error('Private manifest must contain all 19 lessons.');
  const expectedIds=new Set(JSON.parse(await readFile(resolve(root,'cloudflare/media_manifest.example.json'),'utf8')).map(x=>x.lesson_id));
  const ids=new Set(),names=new Set();await mkdir(resolve(out,'hicheel/private'),{recursive:true});
  const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
  for(const item of manifest){
    if(Object.keys(item).some(key=>!['lesson_id','file','captions_file','duration_seconds','worksheet_text','quiz'].includes(key)))throw new Error('Unsupported private manifest field. Use the lesson media/practice schema, not a full production export.');
    const content=privateContent({worksheet_text:item.worksheet_text,quiz:item.quiz});
    if(!expectedIds.has(item.lesson_id)||ids.has(item.lesson_id))throw new Error('Unique known lesson UUID required.');ids.add(item.lesson_id);
    if(!/^[A-Za-z0-9_-]+\.mp4$/.test(item.file)||names.has(item.file))throw new Error('Unique simple MP4 filename required.');names.add(item.file);
    const source=resolve(input,item.file),info=await lstat(source);if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>maxBytes)throw new Error(`${item.file} must be a regular MP4 of 1–25 MiB.`);
    const bytes=await readFile(source);privateHashes.add(createHash('sha256').update(bytes).digest('hex'));
    await cp(source,resolve(out,'hicheel/private',item.file));let captions=null;
    if(item.captions_file){if(!/^[A-Za-z0-9_-]+\.vtt$/.test(item.captions_file)||names.has(item.captions_file))throw new Error('Unique VTT filename required.');names.add(item.captions_file);
      const vttSource=resolve(input,item.captions_file),vttInfo=await lstat(vttSource);if(!vttInfo.isFile()||vttInfo.isSymbolicLink()||vttInfo.size>maxBytes)throw new Error('Invalid caption file.');
      const vtt=await readFile(vttSource);privateHashes.add(createHash('sha256').update(vtt).digest('hex'));await cp(vttSource,resolve(out,'hicheel/private',item.captions_file));captions='/hicheel/private/'+item.captions_file;}
    sql.push(`INSERT INTO lesson_assets(lesson_id,media_path,captions_path,media_bytes,worksheet_text,quiz_json) VALUES(${quote(item.lesson_id)},${quote('/hicheel/private/'+item.file)},${captions?quote(captions):'NULL'},${info.size},${quote(content.worksheet_text)},${quote(JSON.stringify(content.quiz))}) ON CONFLICT(lesson_id) DO UPDATE SET media_path=excluded.media_path,captions_path=excluded.captions_path,media_bytes=excluded.media_bytes,worksheet_text=excluded.worksheet_text,quiz_json=excluded.quiz_json;`);
    if(Number.isSafeInteger(item.duration_seconds)&&item.duration_seconds>0)sql.push(`UPDATE lessons SET duration_seconds=${item.duration_seconds} WHERE id=${quote(item.lesson_id)};`);
    mediaCount++;if(content.worksheet_text)worksheetCount++;quizCount+=content.quiz.length;
  }
  await mkdir(resolve(root,'build-private'),{recursive:true});await writeFile(resolve(root,'build-private/asset_mapping.sql'),sql.join('\n')+'\n');
}else if(process.env.REQUIRE_COURSE_MEDIA==='1')throw new Error('All 19 private lesson videos are required for this launch build.');
const fileCount=await validateAssets(out,privateHashes);
console.log(JSON.stringify({files:fileCount,private_lessons:mediaCount,private_worksheets:worksheetCount,private_quiz_questions:quizCount,sparse_preview:missing.length>0,protected_routing:true}));
if(!mediaCount)console.log('No private media staged. Enrollment must remain closed.');
