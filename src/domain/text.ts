import type { AnchorProjection, TextEdit, TextSelector } from '../contracts/types.js';
import { ensure, fail } from './errors.js';
import { sha256 } from './hash.js';
export {sha256} from './hash.js';
export const cpLength=(text:string)=>Array.from(text).length;
export function validateScalar(value:unknown):string {
 ensure(typeof value==='string','INVALID_TEXT');
 for(const ch of value){const n=ch.codePointAt(0)!;if(n===0||(n>=0xd800&&n<=0xdfff))fail('INVALID_TEXT');}
 return value;
}
export function validateBody(value:unknown):string {
 // Preserve CR/LF, BOM, combining sequences and whitespace exactly; never normalize storage.
 const text=validateScalar(value);
 if(cpLength(text)>100000||new TextEncoder().encode(text).byteLength>1048576)fail('PAYLOAD_TOO_LARGE');
 return text;
}
export function codePointSlice(text:string,start:number,end:number):string {
 validateBody(text);const a=Array.from(text);
 ensure(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>=start&&end<=a.length);
 return a.slice(start,end).join('');
}
export function utf16ToCodePoint(text:string,offset:number):number {
 validateBody(text);ensure(Number.isSafeInteger(offset)&&offset>=0&&offset<=text.length);
 if(offset>0&&offset<text.length&&/[\uD800-\uDBFF]/.test(text[offset-1])&&/[\uDC00-\uDFFF]/.test(text[offset]))fail('INVALID_TEXT');
 return cpLength(text.slice(0,offset));
}
export function codePointToUtf16(text:string,offset:number):number {
 return codePointSlice(text,0,offset).length;
}
// These low-level functions operate only on fully-resolved (positional) edits/selectors;
// quote-based resolution (start/end absent) happens server-side in SQL, never here.
type ResolvedTextEdit = TextEdit & {start:number;end:number};
export function editsConflict(a:TextEdit,b:TextEdit):boolean {
 ensure(a.start!==undefined&&a.end!==undefined&&b.start!==undefined&&b.end!==undefined);
 const az=a.start===a.end,bz=b.start===b.end;
 if(az&&bz)return a.start===b.start;
 if(az)return b.start<=a.start&&a.start<=b.end;
 if(bz)return a.start<=b.start&&b.start<=a.end;
 return Math.max(a.start,b.start)<Math.min(a.end,b.end);
}
export function validateEdits(body:string,edits:TextEdit[]):asserts edits is ResolvedTextEdit[] {
 validateBody(body);ensure(Array.isArray(edits)&&edits.length<=20);
 for(const e of edits){
  ensure(e&&typeof e==='object'&&e.start!==undefined&&e.end!==undefined);validateBody(e.exact);validateBody(e.replacement);
  if(codePointSlice(body,e.start,e.end)!==e.exact)fail('TEXT_MISMATCH');
 }
 for(let i=0;i<edits.length;i++)for(let j=i+1;j<edits.length;j++)if(editsConflict(edits[i],edits[j]))fail('OVERLAPPING_EDITS');
}
export function applyEdits(body:string,edits:TextEdit[]):string {
 validateEdits(body,edits);let a=Array.from(body);
 for(const e of [...edits].sort((a,b)=>b.start-a.start||b.end-a.end)) a=[...a.slice(0,e.start),...Array.from(e.replacement),...a.slice(e.end)];
 return validateBody(a.join(''));
}
export function planBodyChange(body:string,baseHash:string,edits:TextEdit[],metadataChanged=false){
 validateBody(body);if(sha256(body)!==baseHash)fail('BASE_HASH_MISMATCH');
 const next=applyEdits(body,edits);if(next===body&&!metadataChanged)fail('NO_CHANGE');
 return {body_text:next,body_sha256:sha256(next)};
}
export function canonicalSelector(body:string,start:number,end:number):TextSelector {
 ensure(start<end);const exact=codePointSlice(body,start,end),a=Array.from(body);
 return {unit:'unicode_code_point',start,end,exact,prefix:a.slice(Math.max(0,start-32),start).join(''),suffix:a.slice(end,end+32).join('')};
}
export function projectAnchor(body:string,anchor:Pick<TextSelector,'start'|'end'|'exact'>,edits:TextEdit[],directParent=true):AnchorProjection {
 if(!directParent)return {state:'not_projected',reason:'not_direct_parent'};
 validateEdits(body,edits);
 if(anchor.start>=anchor.end||codePointSlice(body,anchor.start,anchor.end)!==anchor.exact)fail('TEXT_MISMATCH');
 let delta=0;
 for(const e of edits){
  if((e.start===e.end&&e.start>=anchor.start&&e.start<=anchor.end)||(e.start<anchor.end&&e.end>anchor.start))
   return {state:'needs_reanchor',reason:'edited_or_boundary'};
  if(e.end<=anchor.start)delta+=cpLength(e.replacement)-(e.end-e.start);
 }
 const next=applyEdits(body,edits),start=anchor.start+delta,end=anchor.end+delta;
 if(codePointSlice(next,start,end)!==anchor.exact)return {state:'needs_reanchor',reason:'edited_or_boundary'};
 return {state:'candidate',requires_confirmation:true,selector:canonicalSelector(next,start,end)};
}
export function chunkBody(body:string):{start:number;end:number;text:string}[]{
 validateBody(body);const a=Array.from(body),chunks=[];
 for(let start=0;start<a.length;start+=880){const end=Math.min(start+1000,a.length);chunks.push({start,end,text:a.slice(start,end).join('')});if(end===a.length)break;}
 return chunks;
}
