import 'server-only';
import {SupabaseRpcClient,databaseConfig} from './client.js';
import {CursorCodec} from './cursor.js';
import {KnowledgeRepository} from './knowledge-repository.js';
import {fail} from '../../domain/errors.js';
/** Stage 4 calls on the server only; never executed at build/import time. */
export function createKnowledgeRepository():KnowledgeRepository{
 const secret=process.env.CURSOR_SIGNING_KEY;if(!secret)fail('NOT_CONFIGURED');
 return new KnowledgeRepository(new SupabaseRpcClient(databaseConfig()),new CursorCodec(secret));
}
