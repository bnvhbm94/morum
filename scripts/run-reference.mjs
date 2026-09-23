// Runs the external contract reference suite when it is checked out next to this repository.
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const suite = new URL('../../tests/contract-reference.test.mjs', import.meta.url);
if (!existsSync(suite)) {
  console.log('SKIP test:reference — external ../tests/contract-reference.test.mjs not present');
  process.exit(0);
}
const run = spawnSync(process.execPath, ['--test', suite.pathname], {stdio: 'inherit'});
process.exit(run.status ?? 1);
