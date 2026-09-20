import {localHttpConfig} from '../tests/http/local-config.mjs';
try{if(!localHttpConfig())throw Error('not_run: acknowledged disposable local PostgreSQL and actual local Next + PostgREST stack are required.');}
catch{console.error('not_run: configure TEST_DATABASE_URL, both DB acknowledgements, TEST_BASE_URL and ACK_LOCAL_HTTP_STACK=1. No remote targets.');process.exitCode=1;}
