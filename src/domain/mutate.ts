import type {AuthContext,DeclaredAgent,UUID} from '../contracts/types.js';
import type {CommandMap,MutationPort,MutationResult} from './ports.js';
import {validateCommand,normalizeRecordRequest,uuid} from './validation.js';
import {assertServerAuthContext} from './permissions.js';
import {mutationContext} from './idempotency.js';
import {ensure} from './errors.js';
export async function mutate<K extends keyof CommandMap>(repo:MutationPort,actor:AuthContext,name:K,input:CommandMap[K]['input'],key:string,pathId?:UUID,declared?:DeclaredAgent):Promise<MutationResult<CommandMap[K]['output']>> {
 assertServerAuthContext(actor);
 if(name==='record.create')input=normalizeRecordRequest(input) as CommandMap[K]['input'];
 validateCommand(name,input);
 if(actor.kind==='anonymous'){
  // Anonymous work_request.create is allowed; only update requires a keyed agent.
  ensure(name!=='work_request.update','FORBIDDEN');
  if(name==='review.create')ensure((input as CommandMap['review.create']['input']).previous_review_id===null);
 }
 if(name==='version.create'||name==='work_request.update'){uuid(pathId);}else ensure(pathId===undefined);
 const operation=pathId?`${name}:${pathId.toLowerCase()}`:name;
 return repo.execute(name,mutationContext(actor,operation,key,input,declared),input,pathId?.toLowerCase());
}
