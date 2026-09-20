import type {AuthContext,CreateReviewRequest} from '../contracts/types.js';
import type {MutationPort} from './ports.js';
import {mutate} from './mutate.js';
export const createReview=(repo:MutationPort,actor:AuthContext,input:CreateReviewRequest,key:string)=>mutate(repo,actor,'review.create',input,key);
