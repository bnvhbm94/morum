import type {AuthContext,CreateWorkRequest} from '../contracts/types.js';
import type {MutationPort} from './ports.js';
import {mutate} from './mutate.js';
export const createWorkRequest=(repo:MutationPort,actor:AuthContext,input:CreateWorkRequest,key:string)=>mutate(repo,actor,'work_request.create',input,key);

import type {UUID,UpdateWorkRequest} from '../contracts/types.js';
export const updateWorkRequest=(repo:MutationPort,actor:AuthContext,id:UUID,input:UpdateWorkRequest,key:string)=>mutate(repo,actor,'work_request.update',input,key,id);
