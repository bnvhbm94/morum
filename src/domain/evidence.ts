import type {AuthContext,CreateEvidenceRequest} from '../contracts/types.js';
import type {MutationPort} from './ports.js';
import {mutate} from './mutate.js';
export const createEvidence=(repo:MutationPort,actor:AuthContext,input:CreateEvidenceRequest,key:string)=>mutate(repo,actor,'evidence.create',input,key);
