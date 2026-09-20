import type {AuthContext,AnchorInput} from '../contracts/types.js';
import type {MutationPort} from './ports.js';
import {mutate} from './mutate.js';
export const createAnchor=(repo:MutationPort,actor:AuthContext,input:AnchorInput,key:string)=>mutate(repo,actor,'anchor.create',input,key);
