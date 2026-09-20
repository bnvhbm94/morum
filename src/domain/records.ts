import type {AuthContext,CreateRecordRequest} from '../contracts/types.js';
import type {MutationPort} from './ports.js';
import {mutate} from './mutate.js';
export const createRecord=(repo:MutationPort,actor:AuthContext,input:CreateRecordRequest,key:string)=>mutate(repo,actor,'record.create',input,key);
