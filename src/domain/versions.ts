import type {AuthContext,CreateVersionRequest,MetadataUpdate,UUID,Version} from '../contracts/types.js';
import type {MutationPort} from './ports.js';
import {fail} from './errors.js';
import {mutate} from './mutate.js';
import {canonicalJSON} from './idempotency.js';
import {validateCommand,attributes,meaningful} from './validation.js';
import {planBodyChange} from './text.js';
export const createVersion=(repo:MutationPort,actor:AuthContext,id:UUID,input:CreateVersionRequest,key:string)=>mutate(repo,actor,'version.create',input,key,id);
export function previewVersion(base:Version,input:CreateVersionRequest){
 validateCommand('version.create',input);
 if(input.base_version_id.toLowerCase()!==base.id.toLowerCase())fail('VALIDATION_FAILED');
 const m:MetadataUpdate=input.metadata_update??{},nextAttributes={...base.attributes,...(m.attributes_set??{})};
 for(const key of m.attributes_remove??[])delete nextAttributes[key];attributes(nextAttributes);
 const next={title:m.title===undefined?base.title:m.title,body_format:m.body_format??base.body_format,attributes:nextAttributes};
 const changed=next.title!==base.title||next.body_format!==base.body_format||canonicalJSON(next.attributes)!==canonicalJSON(base.attributes);
 const body=planBodyChange(base.body_text,input.base_body_sha256,input.edits,changed);meaningful(body.body_text,next.attributes);
 return {...next,...body,synthetic_demo:base.synthetic_demo}; // Never creates/persists a Version ID.
}
