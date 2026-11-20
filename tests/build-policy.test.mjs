import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {assertFreeConfig,validateAssets,parsePublicCatalog,MAX_BYTES} from '../scripts/build-policy.mjs';
const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
test('ALL requests run the worker; preview alternatives and paid bindings are disabled',()=>{
  assert.doesNotThrow(()=>assertFreeConfig(config));
  for(const c of [{...config,assets:{...config.assets,run_worker_first:false}},{...config,assets:{...config.assets,run_worker_first:['/hicheel/private/*']}},{...config,workers_dev:true},{...config,preview_urls:true},{...config,r2_buckets:[{binding:'R2'}]}])assert.throws(()=>assertFreeConfig(c));
});
test('public catalog accepts only the short outline schema, never narration or quizzes',async()=>{
  const source=await readFile(new URL('../hicheel/catalog.js',import.meta.url),'utf8'),data=parsePublicCatalog(source);
  assert.equal(data.lessons.length,19);
  const wrap=value=>'export const plannedCatalog = Object.freeze('+JSON.stringify(value)+');';
  const full=structuredClone(data);full.lessons[0].narration='Private script';assert.throws(()=>parsePublicCatalog(wrap(full)),/keys/);
  const quiz=structuredClone(data);quiz.lessons[0].quiz=[];assert.throws(()=>parsePublicCatalog(wrap(quiz)),/keys/);
  const long=structuredClone(data);long.lessons[0].objective='x'.repeat(401);assert.throws(()=>parsePublicCatalog(wrap(long)),/short outline/);
  assert.throws(()=>parsePublicCatalog(source+'\nconsole.log("extra");'),/JSON outline/);
});
test('public output rejects paid exports, duplicate media, oversized files and backend source',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'tbplan-build-'));
  try{await mkdir(join(dir,'hicheel/private'),{recursive:true});const bytes=Buffer.from('private-test-fixture');await writeFile(join(dir,'hicheel/private/lesson.mp4'),bytes);await writeFile(join(dir,'index.html'),'Public company page');const hashes=new Set([createHash('sha256').update(bytes).digest('hex')]);
    assert.equal(await validateAssets(dir,hashes),2);
    await writeFile(join(dir,'hicheel/course.json'),JSON.stringify({narration:'Private lesson script',quiz:[]}));await assert.rejects(validateAssets(dir,hashes),/Unapproved course file/);await rm(join(dir,'hicheel/course.json'));
    await writeFile(join(dir,'public-copy.mp4'),bytes);await assert.rejects(validateAssets(dir,hashes),/duplicated at a public path/);await rm(join(dir,'public-copy.mp4'));
    await writeFile(join(dir,'too-large.mp4'),'');await truncate(join(dir,'too-large.mp4'),MAX_BYTES+1);await assert.rejects(validateAssets(dir,hashes),/25 MiB/);await rm(join(dir,'too-large.mp4'));
    await mkdir(join(dir,'cloudflare'));await assert.rejects(validateAssets(dir,hashes),/Non-public source/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
