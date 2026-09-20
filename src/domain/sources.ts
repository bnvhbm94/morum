import type {AuthContext,SourceInput} from '../contracts/types.js';
import type {MutationPort} from './ports.js';
import {mutate} from './mutate.js';
export const createSource=(repo:MutationPort,actor:AuthContext,input:SourceInput,key:string)=>mutate(repo,actor,'source.create',input,key);
