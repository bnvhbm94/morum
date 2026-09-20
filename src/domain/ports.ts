import type * as T from '../contracts/types.js';
export interface CommandMap {
 'record.create':{input:T.CreateRecordRequest;output:T.VersionCreated};
 'version.create':{input:T.CreateVersionRequest;output:T.VersionCreated};
 'anchor.create':{input:T.AnchorInput;output:T.Anchor};
 'source.create':{input:T.SourceInput;output:T.Source};
 'relation.create':{input:T.CreateRelationRequest;output:T.Relation};
 'annotation.create':{input:T.CreateAnnotationRequest;output:T.Annotation};
 'evidence.create':{input:T.CreateEvidenceRequest;output:T.Evidence};
 'review.create':{input:T.CreateReviewRequest;output:T.Review};
 'work_request.create':{input:T.CreateWorkRequest;output:T.WorkRequest};
 'work_request.update':{input:T.UpdateWorkRequest;output:T.WorkRequest};
}
export interface MutationResult<T>{data:T;replayed:boolean;}
export interface MutationPort {
 execute<K extends keyof CommandMap>(name:K,context:T.MutationContext,input:CommandMap[K]['input'],pathId?:T.UUID):Promise<MutationResult<CommandMap[K]['output']>>;
}
/** Server read port, DTO-identical to the public gateway. No implicit test data. */
export interface CoreReadPort {
 getRecord(id:T.UUID):Promise<T.VersionView>;
 getVersion(id:T.UUID):Promise<T.VersionView>;
 getRaw(id:T.UUID):Promise<string>;
 getPart(id:T.UUID,query:T.PartQuery):Promise<T.PartView>;
 getSource(id:T.UUID):Promise<T.Source>;
 getObject(target:T.ContentRef):Promise<T.ObjectView>;
 listVersions(id:T.UUID,query?:T.VersionListQuery):Promise<T.Paged<T.Version>>;
 listRecords(query?:T.ListQuery):Promise<T.Paged<T.RecordSummary>>;
 listRelations(query:T.LocationTargetListQuery):Promise<T.Paged<T.Relation>>;
 listAnnotations(query:T.AnnotationListQuery):Promise<T.Paged<T.Annotation>>;
 listEvidence(query:T.EvidenceTargetListQuery):Promise<T.Paged<T.Evidence>>;
 listReviews(query:T.ReviewTargetListQuery):Promise<T.Paged<T.Review>>;
 listWorkRequests(query?:T.WorkListQuery):Promise<T.Paged<T.WorkRequest>>;
}
/** Stage 5 owns this unimplemented port; consumers must expose NOT_CONFIGURED, not empty success. */
export interface SearchReadPort {search(input:T.SearchRequest):Promise<T.SearchResponse>;getContext(target:T.ContentRef,depth?:1|2,cursor?:string):Promise<T.ContextBundle>;}
export interface RpcClient {call<T>(name:string,args:Record<string,unknown>):Promise<T>;}
