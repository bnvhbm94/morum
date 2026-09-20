import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
import {spawnSync} from 'node:child_process';import {existsSync} from 'node:fs';
const compiler=existsSync('node_modules/.bin/tsc')?'node_modules/.bin/tsc':'tsc';
const args=['-p','tsconfig.server.json',...(process.argv.includes('--check')?['--noEmit']:[])];
// Optional type-only fallback for an offline runner; does not install dependencies or prove a Next build.
if(process.env.TEST_NODE_TYPE_ROOT)args.push('--typeRoots',process.env.TEST_NODE_TYPE_ROOT);
const p=spawnSync(compiler,args,{stdio:'inherit'});if(p.error)console.error('TypeScript unavailable');process.exit(p.status??1);
