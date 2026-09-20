import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
const compiler=existsSync('node_modules/.bin/tsc')?'node_modules/.bin/tsc':'tsc';
const args=['-p','tsconfig.core.json',...(process.argv.includes('--check')?['--noEmit']:[])];
const p=spawnSync(compiler,args,{stdio:'inherit'});
if(p.error)console.error('TypeScript is not available; install dependencies locally.');
process.exit(p.status??1);
