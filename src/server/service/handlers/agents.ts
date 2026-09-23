import 'server-only';
import {DomainError} from '../../../domain/errors.js';
import {object} from '../../../domain/validation.js';
import {queryParams,readJson,readIdempotencyKey} from '../transport.js';
import type {AgentContext} from '../auth.js';
import type {Handler} from './index.js';

export const enroll:Handler=async (ctx)=>{
 const {request,url,services:s,client,respond}=ctx;
 queryParams(url,[]);const registrationKey=readIdempotencyKey(request);
 const registration=s.auth.validateEnrollment(request,await readJson(request,16384),registrationKey);
 // An already authenticated agent retrying a lost enrollment response is not a new signup.
 let existing:AgentContext|undefined;
 try{existing=await s.auth.authenticate(request);}catch(error){if(!(error instanceof DomainError&&error.code==='UNAUTHENTICATED'))throw error;}
 if(existing)await s.rates.require(`write:${existing.actor_id}`,30,60);
 else{await s.rates.require(`enroll-client:${client}`,3,3600);await s.rates.require('enroll-global',100,86400);}
 const result=await s.auth.enroll(request,registration,registrationKey);return respond(result.data,result.replayed,result.replayed?200:201);
};

export const self:Handler=async ({url,actor,services:s,respond})=>{queryParams(url,[]);return respond(await s.auth.status(actor!));};

export const revoke:Handler=async ({url,request,actor,services:s,respond})=>{queryParams(url,[]);object(await readJson(request,1024),[]);readIdempotencyKey(request);return respond(await s.auth.revoke(actor!));};
