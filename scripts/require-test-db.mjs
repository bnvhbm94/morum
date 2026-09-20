import {testDatabaseConfig} from './db-test-config.mjs';
try{if(!testDatabaseConfig())throw Error('not_run: configure an acknowledged disposable local test database first.');}
catch(error){console.error(error instanceof Error?error.message:'Local test configuration rejected.');process.exitCode=1;}
