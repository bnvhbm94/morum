import type {AuthContext,UUID} from '../contracts/types.js';
import type {CommandMap,MutationPort,MutationResult} from './ports.js';
import {validateCommand,normalizeRecordRequest,uuid} from './validation.js';
import {assertServerAuthContext} from './permissions.js';
import {mutationContext} from './idempotency.js';
import {ensure} from './errors.js';
export async function mutate<K extends keyof CommandMap>(repo:MutationPort,actor:AuthContext,name:K,input:CommandMap[K]['input'],key:string,pathId?:UUID):Promise<MutationResult<CommandMap[K]['output']>> {
 assertServerAuthContext(actor);
 if(name==='record.create')input=normalizeRecordRequest(input) as CommandMap[K]['input'];
 validateCommand(name,input);
 if(actor.kind==='anonymous'){
  ensure(!name.startsWith('work_request.'),'FORBIDDEN');
  if(name==='review.create')ensure((input as CommandMap['review.create']['input']).previous_review_id===null);
 }
 if(name==='version.create'||name==='work_request.update'){uuid(pathId);}else ensure(pathId===undefined);
 const operation=pathId?`${name}:${pathId.toLowerCase()}`:name;
 return repo.execute(name,mutationContext(actor,operation,key,input),input,pathId?.toLowerCase());
}
