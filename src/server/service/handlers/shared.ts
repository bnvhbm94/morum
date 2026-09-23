import 'server-only';
import type * as T from '../../../contracts/types.js';
import {ref} from '../../../domain/validation.js';
/** Shared by review-head, context and the read-only list endpoints that take a target_kind/target_id pair. */
export function targetQuery(q:Record<string,string>,kinds:readonly string[]):T.ContentRef{
 const target={kind:q.target_kind,id:q.target_id};ref(target,kinds);return target as T.ContentRef;
}
