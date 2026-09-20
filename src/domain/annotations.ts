import type {AuthContext,CreateAnnotationRequest} from '../contracts/types.js';
import type {MutationPort} from './ports.js';
import {mutate} from './mutate.js';
export const createAnnotation=(repo:MutationPort,actor:AuthContext,input:CreateAnnotationRequest,key:string)=>mutate(repo,actor,'annotation.create',input,key);
