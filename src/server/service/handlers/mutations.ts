import 'server-only';
import {randomUUID} from 'node:crypto';
import type {CommandMap} from '../../../domain/ports.js';
import {ensure} from '../../../domain/errors.js';
import {validateCommand,normalizeRecordRequest} from '../../../domain/validation.js';
import {mutate} from '../../../domain/mutate.js';
import {readJson,readRecordBody,queryParams,readIdempotencyKey,parseDeclaredAgent} from '../transport.js';
import type {Handler} from './index.js';

/** One generic handler for every ROUTES entry that carries a `command` (the ten contribution/agent mutate POSTs). */
export const mutationHandler:Handler=async (ctx)=>{
 const {request,url,route,params:p,services:s,contributor,actor,respond,setWriteKey}=ctx;
 queryParams(url,[]);
 const op=route.command;ensure(op,'NOT_FOUND');
 const requestKey:string=request.headers.has('idempotency-key')?readIdempotencyKey(request):randomUUID();setWriteKey(requestKey);
 const body=op==='record.create'?normalizeRecordRequest(await readRecordBody(request)):await readJson(request);validateCommand(op,body);
 const declared=parseDeclaredAgent(request.headers.get('morum-agent'));
 const pathId=p.record_id??p.work_request_id;
 const result=await mutate(s.repo,contributor??actor!,op,body as CommandMap[typeof op]['input'],requestKey,pathId,declared);
 return respond(result.data,result.replayed,result.replayed?200:201);
};
