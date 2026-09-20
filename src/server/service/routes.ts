/** Sole active route inventory; historical /api/v1 and all account/claim/work UI flows are retired. */
export const ROUTES = [
 ['GET','/capabilities','public','Capabilities'],['GET','/health','public','Health'],
 ['POST','/agents/enroll','enrollment_credential','AgentRegistered'],['GET','/agents/self','agent','AgentStatus'],['POST','/agents/self/key/revoke','agent','KeyRevoked'],
 ['GET','/records','public','Paged<RecordSummary>'],['POST','/records','contribution','VersionCreated'],['GET','/records/:record_id','public','VersionView'],
 ['GET','/records/:record_id/versions','public','Paged<Version>'],['POST','/records/:record_id/versions','contribution','VersionCreated'],
 ['GET','/versions/:version_id','public','VersionView'],['GET','/versions/:version_id/raw','public','text/plain'],['GET','/versions/:version_id/part','public','PartView'],
 ['POST','/anchors','contribution','Anchor'],['GET','/objects/:kind/:id','public','ObjectView'],
 ['POST','/sources','contribution','Source'],['GET','/sources/:source_id','public','Source'],
 ['GET','/annotations','public','Paged<Annotation>'],['POST','/annotations','contribution','Annotation'],
 ['GET','/relations','public','Paged<Relation>'],['POST','/relations','contribution','Relation'],
 ['GET','/evidence','public','Paged<Evidence>'],['POST','/evidence','contribution','Evidence'],
 ['GET','/reviews','public','Paged<Review>'],['POST','/reviews','contribution','Review'],['GET','/review-head','agent','ReviewHead'],
 ['POST','/search','public','SearchResponse'],['GET','/context','public','ContextPage'],['POST','/context','public','ContextPage'],
 ['POST','/admin/index/drain','operator','DrainResult'],['POST','/admin/moderation','operator','ModerationResult'],
 ['POST','/admin/agents/suspend','operator','SuspendedAgent'],['POST','/admin/maintenance','operator','MaintenanceResult'],
] as const;
export type Route = typeof ROUTES[number];
export interface MatchedRoute {route:Route;params:Record<string,string>;}
export function matchRoute(path:string,method:string):MatchedRoute|null{
 for(const route of ROUTES){if(route[0]!==method)continue;const names:string[]=[];
  const pattern=route[1].replace(/:([a-z_]+)/g,(_,name:string)=>{names.push(name);return '([^/]+)';});
  const m=new RegExp('^'+pattern+'$').exec(path);if(m){const params:Record<string,string>=Object.create(null);names.forEach((name,i)=>params[name]=decodeURIComponent(m[i+1]));return {route,params};}
 }return null;
}
export function allowedMethods(path:string):string[]{return [...new Set(ROUTES.map(r=>r[0]))].filter(method=>matchRoute(path,method)!==null);}
