import type {AuthContext,CreateRelationRequest} from '../contracts/types.js';
import type {MutationPort} from './ports.js';
import {mutate} from './mutate.js';
export const createRelation=(repo:MutationPort,actor:AuthContext,input:CreateRelationRequest,key:string)=>mutate(repo,actor,'relation.create',input,key);
