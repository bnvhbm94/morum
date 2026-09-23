import {publicOrigin} from '../../../server/service/claimreview';

/**
 * GET/HEAD /.well-known/api-catalog — RFC 9727 API catalog (roadmap 1.6; the OpenAPI half of
 * 1.6 waits on owner decision D10 and is not part of this route).
 * https://www.rfc-editor.org/rfc/rfc9727.html
 *
 * One linkset entry anchored at the API root (RFC 9727 section 2's `application/linkset+json`
 * format). The payload is built from the fixed path constants below — never from ROUTES and
 * never by reading a file at request time — so the only per-request work is resolving which
 * origin to print. `publicOrigin` (shared with the ClaimReview JSON-LD in claimreview.ts)
 * collapses any `*.vercel.app` preview host to the canonical production origin and otherwise
 * passes the request's own origin through unchanged, which is what keeps `localhost` working
 * in local development.
 */

interface LinksetLink { href: string; type?: string; }
interface LinksetEntry {
 anchor: string;
 'service-desc': LinksetLink[];
 'service-doc': LinksetLink[];
 status: LinksetLink[];
 'service-meta': LinksetLink[];
}
interface LinksetDocument { linkset: LinksetEntry[]; }

const CONTENT_TYPE='application/linkset+json';
const CACHE_CONTROL='public, max-age=3600';

function buildCatalog(origin:string):LinksetDocument{
 return {
  linkset:[
   {
    anchor:`${origin}/api/v2/`,
    'service-desc':[
     // openapi.json is added here once roadmap 1.6's OpenAPI half lands (owner decision D10).
     {href:`${origin}/agent/api-routes.json`,type:'application/json'},
    ],
    'service-doc':[
     {href:`${origin}/skill.md`,type:'text/markdown'},
     {href:`${origin}/llms.txt`,type:'text/plain'},
    ],
    status:[
     {href:`${origin}/api/v2/health`},
    ],
    'service-meta':[
     {href:`${origin}/api/v2/capabilities`},
    ],
   },
  ],
 };
}

function catalogResponse(request:Request,includeBody:boolean):Response{
 const origin=publicOrigin(new URL(request.url).origin);
 const body=JSON.stringify(buildCatalog(origin));
 return new Response(includeBody?body:null,{
  status:200,
  headers:{
   'content-type':CONTENT_TYPE,
   'cache-control':CACHE_CONTROL,
   'x-content-type-options':'nosniff',
  },
 });
}

export async function GET(request:Request):Promise<Response>{
 return catalogResponse(request,true);
}
export async function HEAD(request:Request):Promise<Response>{
 return catalogResponse(request,false);
}
