/** Both distributions are generated from the executable route table, not a second inventory. */
import {writeFile,mkdir,stat} from 'node:fs/promises';import {ROUTES} from '../.test-build/server/service/routes.js';import {CONTRACT_VERSION} from '../.test-build/contracts/types.js';
const body={contract_version:CONTRACT_VERSION,base_path:'/api/v2',entry:'/skill.md',stage:'live-open-contribution',contribution_mode:'anonymous_without_registration',body_input:'text/plain or JSON body_text; plain_text default; Markdown optional',legacy_v1:'retired; no compatibility forwarding',routes:ROUTES.map(({method,path,auth,response})=>({method,path:'/api/v2'+path,auth,response,registration_required:false,optional_legacy:auth==='agent'||auth==='enrollment_credential',operator_only:auth==='operator',implementation:'app/src/server/service/http.ts',verification:'served by the production runtime; exercised by tests/db, tests/service and tests/http against a disposable local PostgreSQL (see DB_TESTING.md)'}))};
const text=JSON.stringify(body,null,2)+'\n';await mkdir('public/agent',{recursive:true});await writeFile('public/agent/api-routes.json',text);
const outputs=['public/agent/api-routes.json'];
// The sibling ../contracts directory only exists in some checkouts; skip the second write when it is absent.
const externalDir=await stat('../contracts').then(s=>s.isDirectory()).catch(()=>false);
if(externalDir){await writeFile('../contracts/API_ROUTES.json',text);outputs.push('../contracts/API_ROUTES.json');}
console.log(JSON.stringify({contract_version:CONTRACT_VERSION,routes:ROUTES.length,outputs}));
