import {readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');let count=0;
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){
  if(['.git','.wrangler','node_modules','dist','private-media','build-private','images','videos'].includes(e.name))continue;
  const p=resolve(dir,e.name);if(e.isDirectory())await walk(p);else if(/\.(mjs|js)$/.test(p)){
    const r=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});if(r.status!==0){console.error(r.stderr);process.exitCode=1;}count++;
  }
}}
await walk(root);console.log(`Syntax checked ${count} source files.`);
