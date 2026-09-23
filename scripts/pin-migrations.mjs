/** Regenerates supabase/migrations/.hashes.json. Run only when adding a NEW migration file.
 * Refuses to change an existing pinned entry unless --allow-rewrite <filename> is passed. */
import {readFile,writeFile} from 'node:fs/promises';
import {migrationsDir,migrationHashes} from './migrations.mjs';

const hashesPath=migrationsDir+'.hashes.json';
const args=process.argv.slice(2);
const rewriteIdx=args.indexOf('--allow-rewrite');
const allowRewrite=rewriteIdx!==-1?args[rewriteIdx+1]:null;

let existing={};
try{existing=JSON.parse(await readFile(hashesPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}

const next=await migrationHashes();
const changed=[];
for(const [file,hash] of Object.entries(next)){
 if(Object.prototype.hasOwnProperty.call(existing,file)&&existing[file]!==hash){
  if(file!==allowRewrite)changed.push(file);
 }
}
if(changed.length){
 console.error(`Refusing to change pinned hash for: ${changed.join(', ')}. Committed migrations are immutable; add a new migration instead. Pass --allow-rewrite <filename> to explicitly override one file.`);
 process.exitCode=1;
}else{
 await writeFile(hashesPath,JSON.stringify(next,Object.keys(next).sort(),1)+'\n');
 console.log(JSON.stringify({status:'pinned',files:Object.keys(next).length},null,2));
}
