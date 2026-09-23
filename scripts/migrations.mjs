/** Derives migration lists/counts/tags from files under supabase/migrations instead of hardcoding them. */
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const migrationsDir=fileURLToPath(new URL('../supabase/migrations/',import.meta.url));
const PROBE_FILE='20260919153000_setup_connectivity.sql';
const PRODUCT_RE=/^\d{12}_.*\.sql$/;

/** Product migrations: 12-digit-prefixed files under supabase/migrations, sorted; excludes the connectivity probe. */
export async function listMigrations(){
 const files=await readdir(migrationsDir);
 return files.filter(f=>PRODUCT_RE.test(f)&&f!==PROBE_FILE).sort();
}

/** All committed migration files, including the probe (which has a different, 14-digit, timestamp prefix). */
export async function listAllMigrationFiles(){
 const files=await readdir(migrationsDir);
 return files.filter(f=>f.endsWith('.sql')&&(f===PROBE_FILE||PRODUCT_RE.test(f))).sort();
}

/** Parses `SET migration_tag='...'` from the last product migration file. */
export async function latestMigrationTag(){
 const files=await listMigrations();
 if(!files.length)throw Error('No product migrations found under supabase/migrations.');
 const last=files[files.length-1];
 const sql=await readFile(migrationsDir+last,'utf8');
 const match=sql.match(/migration_tag\s*=\s*'([^']+)'/);
 if(!match)throw Error(`No migration_tag assignment found in ${last}.`);
 return match[1];
}

/** Sorted unique set of public.kb_* RPC function names defined across all product migrations. */
export async function publicRpcNames(){
 const files=await listMigrations();
 const sql=(await Promise.all(files.map(f=>readFile(migrationsDir+f,'utf8')))).join('\n');
 return [...new Set([...sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION public\.(kb_\w+)\(/g)].map(m=>m[1]))].sort();
}

/** sha256 hex digest per committed migration file (including the probe), keyed by filename. */
export async function migrationHashes(){
 const files=await listAllMigrationFiles();
 const out={};
 for(const file of files)out[file]=createHash('sha256').update(await readFile(migrationsDir+file)).digest('hex');
 return out;
}

export {PROBE_FILE};
