/** Optional localhost-only prefix adapter for VANILLA PostgREST, not a fake database/gateway. */
import {createServer,request} from 'node:http';
if(process.env.ACK_LOCAL_HTTP_STACK!=='1')throw Error('Explicit local disposable-stack acknowledgement is required.');
const upstream=Number(process.env.LOCAL_POSTGREST_PORT),port=Number(process.env.LOCAL_PREFIX_PORT);
if(![upstream,port].every(n=>Number.isSafeInteger(n)&&n>1024&&n<65536)||upstream===port)throw Error('Use distinct high-numbered local ports.');
createServer((req,res)=>{
 if(!req.url?.startsWith('/rest/v1/')){res.writeHead(404);res.end();return;}
 const forward=request({hostname:'127.0.0.1',port:upstream,path:req.url.slice('/rest/v1'.length),method:req.method,headers:{...req.headers,host:`127.0.0.1:${upstream}`},timeout:15000},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res);});
 forward.on('timeout',()=>forward.destroy());forward.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.on('aborted',()=>forward.destroy());req.pipe(forward);
}).listen(port,'127.0.0.1',()=>console.log('Local PostgREST prefix adapter listening; payloads/credentials are never logged.'));
