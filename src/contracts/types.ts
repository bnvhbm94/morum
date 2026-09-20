/**
 * Knowledge repository protocol 2.1.0.
 * Canonical shared types: every stage imports this file, never duplicates DTOs.
 * Stage 04 revision: open contributions, optional legacy keys, no signup prerequisite.
 * UUID/hash/ISO string aliases require runtime validation, not nominal guarantees.
 */
export const CONTRACT_VERSION = "2.1.0" as const;
export type UUID = string;
export type ISODateTime = string;
export type SHA256 = string;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Attributes = { [key: string]: JsonValue };
export type BodyFormat = "plain_text" | "markdown";
export type Visibility = "public" | "hidden" | "tombstone";
export type ActorKind = "human" | "agent";
export type ActorState = "pending_claim" | "active" | "suspended";
export interface ActorPublic {
  id: UUID; kind: ActorKind; display_name: string; state: ActorState;
  // Self-reported; never certified identity or vendor affiliation.
  self_description: string | null;
}
export type LocationRef =
  | { kind: "version"; id: UUID }
  | { kind: "anchor"; id: UUID }
  | { kind: "source"; id: UUID };
export type ReviewTargetRef = LocationRef
  | { kind: "relation"; id: UUID }
  | { kind: "annotation"; id: UUID }
  | { kind: "evidence"; id: UUID };
export type ContentRef = ReviewTargetRef | { kind: "review"; id: UUID };
export type EvidenceTargetRef = LocationRef
  | { kind: "relation"; id: UUID }
  | { kind: "annotation"; id: UUID }
  | { kind: "review"; id: UUID };
export interface TextSelector {
  unit: "unicode_code_point";
  start: number; end: number; exact: string;
  prefix: string; suffix: string;
}
export interface AnchorInput {
  version_id: UUID; body_sha256: SHA256; selector: TextSelector;
}
export interface Anchor extends AnchorInput {
  id: UUID; created_by: UUID | null; created_at: ISODateTime;
}
export type EvidenceBasis =
  | { kind: "external"; source_id: UUID; quote: string | null; explanation: string }
  | { kind: "internal"; source: Exclude<LocationRef, {kind: "source"}>; explanation: string }
  | { kind: "reasoning"; explanation: string };
export interface Evidence extends EvidenceCommon { basis: EvidenceBasis; }
export interface EvidenceCommon {
  id: UUID; target: EvidenceTargetRef; created_by: UUID | null; created_at: ISODateTime;
  submission_state: "submitted"; // Does not imply the citation was checked.
}
export interface SourceInput {
  url: string | null; title: string | null;
  submitted_text: string | null; // Supplied text; server does not fetch arbitrary URLs.
  published_at: ISODateTime | null; retrieved_at: ISODateTime | null;
  rights_note: string | null; attributes: Attributes; synthetic_demo: boolean;
}
export interface Source extends SourceInput {
  id: UUID; created_by: UUID | null; created_at: ISODateTime; visibility: Visibility;
}
export interface ReviewSummary {
  agree: number; disagree: number; needs_review: number;
  effective_reviewers: number; // Keyed identities only; not proof of distinct people/models.
  anonymous_reviews: number; // Number of submissions, NEVER number of independent reviewers.
  anonymous_stances: { agree: number; disagree: number; needs_review: number };
  review_state: "unreviewed" | "reviewed";
  approval_inherited: false;
}
export interface Version {
  id: UUID; record_id: UUID; version_no: number; parent_version_id: UUID | null;
  title: string | null; body_text: string; body_format: BodyFormat;
  body_sha256: SHA256; attributes: Attributes; synthetic_demo: boolean;
  reason: string; created_by: UUID | null; created_at: ISODateTime; visibility: Visibility;
}
export interface VersionView {
  version: Version;
  author: ActorPublic | null;
  is_current: boolean; current_version_id: UUID | null;
  basis: Evidence[]; basis_truncated?: boolean; corrections_truncated?: boolean; review_summary: ReviewSummary;
  correction_refs: LocationRef[];
  // Explicitly bounds potentially large annotation/edge collections.
  related_counts: { annotations: number; relations: number; reviews: number };
  links: { record: string; version: string; history: string; raw: string };
}
export interface RecordSummary {
  id: UUID; created_at: ISODateTime; current: Version;
  review_summary: ReviewSummary;
}
/** JSON transport: only body_text is required. text/plain POST is also accepted. */
export interface CreateRecordRequest {
  body_text: string; title?: string | null; body_format?: BodyFormat;
  attributes?: Attributes; synthetic_demo?: boolean;
  reason?: string; basis?: EvidenceBasis[];
}
export type NormalizedRecordRequest = Required<CreateRecordRequest>;
export interface TextEdit {
  start: number; end: number; exact: string; replacement: string;
}
export interface MetadataUpdate {
  title?: string | null;
  body_format?: BodyFormat;
  attributes_set?: Attributes;
  attributes_remove?: string[];
}
export interface CreateVersionRequest {
  base_version_id: UUID; base_body_sha256: SHA256;
  edits: TextEdit[]; metadata_update?: MetadataUpdate;
  reason: string; basis: EvidenceBasis[];
}
export interface VersionCreated {
  version: Version; previous_current_version_id: UUID | null;
  branched_from_noncurrent: boolean;
  indexing: { lexical: "ready"; semantic: "pending" | "disabled" };
}
export type KnownPredicate =
  "supports" | "contradicts" | "corrects" | "depends_on" |
  "defines" | "same_meaning_as" | "translation_of" | "derived_from" | "related_to";
export interface CreateRelationRequest {
  from: LocationRef; to: LocationRef;
  predicate: string; // KnownPredicate or x:<namespace>:<name>, validated at runtime.
  explanation: string; attributes: Attributes; basis: EvidenceBasis[];
}
export interface Relation extends Omit<CreateRelationRequest, "basis"> {
  id: UUID; created_by: UUID | null; created_at: ISODateTime;
}
export interface CreateAnnotationRequest {
  anchor_id: UUID; meaning: string; concept_version_id: UUID | null;
  attributes: Attributes; supersedes_annotation_id: UUID | null;
  basis: EvidenceBasis[];
}
export interface Annotation extends Omit<CreateAnnotationRequest, "basis"> {
  id: UUID; created_by: UUID | null; created_at: ISODateTime;
}
export type AnchorProjection =
  | { state: "candidate"; selector: TextSelector; requires_confirmation: true }
  | { state: "needs_reanchor"; reason: "edited_or_boundary" }
  | { state: "not_projected"; reason: "not_direct_parent" };
export type ReviewStance = "agree" | "disagree" | "needs_review";
export type ReviewFocus = "content" | "evidence_support" | "quote_match" | "meaning";
export interface CreateReviewRequest {
  target: ReviewTargetRef; stance: ReviewStance; focus: ReviewFocus;
  explanation: string; previous_review_id: UUID | null; basis: EvidenceBasis[];
}
export interface Review extends Omit<CreateReviewRequest, "basis"> {
  id: UUID; created_by: UUID | null; created_at: ISODateTime;
}
export type WorkStatus = "open" | "in_progress" | "resolved" | "closed";
export interface CreateWorkRequest {
  title: string; description: string; target: LocationRef | null;
  suggested_query: string | null;
}
export interface WorkRequest extends CreateWorkRequest {
  id: UUID; status: WorkStatus; revision: number;
  created_by: UUID; assigned_to: UUID | null;
  created_at: ISODateTime; updated_at: ISODateTime;
  resolution_refs: LocationRef[];
}
export interface UpdateWorkRequest {
  expected_revision: number;
  action: "claim" | "release" | "resolve" | "close" | "reopen";
  reason: string; resolution_refs: LocationRef[];
}
/** Credential is generated and saved by the client BEFORE registration, in the Authorization header. */
export interface AgentRegisterRequest { display_name: string; self_description: string | null; }
export interface AgentRegistered { agent: ActorPublic; key_id: UUID; credential_delivery: "client_generated"; }
export interface ReviewHead { actor_id: UUID; target: ReviewTargetRef; focus: ReviewFocus; review_id: UUID | null; }
export interface ObjectView {
  target: ContentRef; value: Version | Anchor | Source | Relation | Annotation | Evidence | Review;
  owner_version_id: UUID | null; basis: Evidence[]; basis_truncated?: boolean;
}
export interface CreateEvidenceRequest { target: EvidenceTargetRef; basis: EvidenceBasis; }
export interface KeyRevoked { agent_id: UUID; key_id: UUID; revoked_at: ISODateTime; }
export interface AgentStatus { active_key_id: UUID | null; agent: ActorPublic; }
export type SearchScope = "current" | "all_versions";
export interface SearchRequest {
  query: string; scope: SearchScope;
  limit?: number; cursor?: string | null;
  include_context?: boolean;
  filters?: { synthetic_demo?: boolean; record_id?: UUID };
}
export type SearchMode = "hybrid" | "hybrid_partial" | "keyword_only";
export type SemanticReason =
  "disabled" | "missing_configuration" | "budget_not_approved" | "budget_exhausted" |
  "provider_timeout" | "provider_error" | "index_pending" | "profile_mismatch" | "input_too_large" | "empty_input" | null;
export interface SearchStatus {
  mode: SearchMode;
  query_embedding: "ready" | "not_attempted" | "failed";
  reason: SemanticReason;
  profile_id: string | null;
  indexed_units: number; eligible_units: number; index_truncated?: boolean;
  quality_gate: "not_evaluated" | "passed" | "failed";
  result_state: "candidates" | "no_match" | "insufficient_index";
}
export type UnitLocator =
  | { kind: "body"; version_id: UUID; start: number; end: number; body_sha256: SHA256 }
  | { kind: "field"; version_id: UUID; json_pointer: string }
  | { kind: "object"; target: ContentRef };
export interface SearchHit {
  unit_id: UUID; record_id: UUID | null; version_id: UUID | null;
  locator: UnitLocator; snippet: string; snippet_truncated?: boolean; title: string | null;
  is_current: boolean | null; synthetic_demo: boolean;
  ranks: { lexical: number | null; semantic: number | null };
  rrf_score: number; // Ranking signal, never probability of truth.
  review_summary: ReviewSummary;
  links: { version: string | null; part: string; source: string | null };
}
export interface ContextItem {
  synthetic_demo: boolean;
  target: ContentRef;
  reason: "match" | "correction" | "counterargument" | "premise" | "evidence" |
          "meaning" | "surrounding_text" | "related";
  text: string; text_truncated?: boolean; is_current: boolean | null; original_url: string | null;
}
export interface ContextBundle {
  seeds?: ContentRef[];
  items: ContextItem[]; relations: Relation[];
  truncated: boolean; omitted_count: number | null; continuation: string | null;
}
export interface SearchContextCoverage {
  requested: boolean; unique_targets: number; expanded_targets: number; omitted_targets: ContentRef[];
}
export interface SearchResponse {
  context_coverage: SearchContextCoverage;
  hits: SearchHit[]; status: SearchStatus; context: ContextBundle | null;
  page: PageInfo;
  suggested_work_request: CreateWorkRequest | null;
}
export interface PageInfo {
  snapshot_at: ISODateTime | null;
  next_cursor: string | null; snapshot_expires_at: ISODateTime | null;
  truncated: boolean;
}
export interface Paged<T> { items: T[]; page: PageInfo; }
export interface PartView {
  version_id: UUID; body_sha256: SHA256;
  start: number; end: number; exact: string;
  context_start: number; context_end: number; context_text: string;
  annotations: Annotation[]; relations: Relation[]; review_summary: ReviewSummary;
  truncated: boolean; next_cursor: string | null;
}
export interface Capabilities {
  contract_version: typeof CONTRACT_VERSION;
  authentication: { mode: "open_contribution"; human_login: false; owner_claim: false; registration_required: false; credentials_required: false; agent_registration: boolean; anonymous_reviews: "append_only" };
  content: { default_format: "plain_text"; markdown_required: false; raw_text_post: true };
  search: { semantic_enabled: boolean; profile_id: string | null; quality_gate: SearchStatus["quality_gate"] };
  limits: { write_bytes: number; body_code_points: number; search_limit: number };
}
export type ErrorCode =
  "INVALID_JSON" | "VALIDATION_FAILED" | "INVALID_TEXT" | "INVALID_LINE_ENDINGS" |
  "UNAUTHENTICATED" | "AMBIGUOUS_AUTH" | "FORBIDDEN" | "AGENT_NOT_APPROVED" |
  "KEY_REVOKED" | "NOT_FOUND" | "RESOURCE_GONE" | "CLAIM_EXPIRED" | "CLAIM_TAKEN" |
  "BASE_HASH_MISMATCH" | "TEXT_MISMATCH" | "OVERLAPPING_EDITS" | "NO_CHANGE" |
  "IDEMPOTENCY_CONFLICT" | "REVIEW_HEAD_CHANGED" | "TASK_REVISION_CONFLICT" |
  "CURSOR_EXPIRED" | "CURSOR_INVALID" | "PAYLOAD_TOO_LARGE" | "RATE_LIMITED" |
  "NOT_CONFIGURED" | "DEPENDENCY_UNAVAILABLE" | "INTERNAL_ERROR";
export interface ApiMeta {
  contract_version: typeof CONTRACT_VERSION; request_id: UUID; replayed: boolean;
}
export interface ApiSuccess<T> { data: T; meta: ApiMeta; }
export interface ApiFailure {
  error: { code: ErrorCode; message: string; details: Attributes | null; retryable: boolean };
  meta: ApiMeta;
}
/** Server-only context; must never be accepted from request JSON. */
export type AuthContext =
  | { kind: "anonymous" }
  | { kind: "human"; actor_id: UUID; auth_user_id: UUID }
  | { kind: "agent"; actor_id: UUID; key_id: UUID };
export interface MutationContext {
  actor: AuthContext; operation: string; idempotency_key: string; request_hash: SHA256;
}
export interface KnowledgeGateway {
  capabilities(): Promise<Capabilities>;
  getRecord(id: UUID): Promise<VersionView>;
  getVersion(id: UUID): Promise<VersionView>;
  getPart(id: UUID, start: number, end: number, options?: Pick<PartQuery, "context_before" | "context_after" | "cursor">): Promise<PartView>;
  search(input: SearchRequest): Promise<SearchResponse>;
  createRecord(input: CreateRecordRequest, idempotencyKey: string): Promise<VersionCreated>;
  createVersion(recordId: UUID, input: CreateVersionRequest, idempotencyKey: string): Promise<VersionCreated>;
  createReview(input: CreateReviewRequest, idempotencyKey: string): Promise<Review>;
  createAnnotation(input: CreateAnnotationRequest, idempotencyKey: string): Promise<Annotation>;
  createRelation(input: CreateRelationRequest, idempotencyKey: string): Promise<Relation>;
  listRecords(cursor?: string): Promise<Paged<RecordSummary>>;
  listVersions(recordId: UUID, cursor?: string): Promise<Paged<Version>>;
  getSource(id: UUID): Promise<Source>;
  getObject(target: ContentRef): Promise<ObjectView>;
  getContext(target: ContentRef, depth?: 1 | 2, cursor?: string): Promise<ContextBundle>;
  listRelations(target: LocationRef, cursor?: string): Promise<Paged<Relation>>;
  listAnnotations(versionId: UUID, cursor?: string): Promise<Paged<Annotation>>;
  listReviews(target: ReviewTargetRef, cursor?: string): Promise<Paged<Review>>;
  listEvidence(target: EvidenceTargetRef, cursor?: string): Promise<Paged<Evidence>>;
  createSource(input: SourceInput, idempotencyKey: string): Promise<Source>;
  createAnchor(input: AnchorInput, idempotencyKey: string): Promise<Anchor>;
  createEvidence(input: CreateEvidenceRequest, idempotencyKey: string): Promise<Evidence>;
  registerAgent(input: AgentRegisterRequest, idempotencyKey: string): Promise<AgentRegistered>;
  agentStatus(): Promise<AgentStatus>;
  reviewHead(target: ReviewTargetRef, focus: ReviewFocus): Promise<ReviewHead>;
  revokeAgentKey(idempotencyKey: string): Promise<KeyRevoked>;
}

/** URL-query DTOs after strict parsing; numeric strings are not domain numbers. */
export interface ListQuery { limit?: number; cursor?: string | null; }
export interface VersionListQuery extends ListQuery {}
export interface AnnotationListQuery extends ListQuery { version_id: UUID; }
export interface LocationTargetListQuery extends ListQuery {
  target_kind: LocationRef["kind"]; target_id: UUID; direction?: "in" | "out" | "both";
}
export interface EvidenceTargetListQuery extends ListQuery {
  target_kind: EvidenceTargetRef["kind"]; target_id: UUID;
}
export interface ReviewTargetListQuery extends ListQuery {
  target_kind: ReviewTargetRef["kind"]; target_id: UUID;
}
export interface WorkListQuery extends ListQuery { status?: WorkStatus; }
export interface PartQuery {
  start: number; end: number; context_before?: number; context_after?: number;
  cursor?: string | null;
}
export interface ContextQuery {
  target_kind: ContentRef["kind"]; target_id: UUID; depth?: 1 | 2;
  cursor?: string | null;
}
export type ModerationTarget = ContentRef | { kind: "record"; id: UUID };
export interface ModerationRequest {
  target: ModerationTarget; visibility: Visibility; reason: string;
}
export interface ModerationResult {
  target: ModerationTarget; visibility: Visibility; changed_at: ISODateTime;
}
export interface Health {
  status: "ok" | "degraded";
  database: "reachable" | "unavailable" | "not_configured";
  contract_version: typeof CONTRACT_VERSION;
}
export interface DrainRequest { limit: number; }
export interface DrainResult {
  claimed: number; ready: number; retry: number; dead: number; remaining: number;
}

/** Context text can be bounded; use object/raw/part links for complete immutable content. */
export interface ContextPage extends ContextBundle { seeds: ContentRef[]; }
export interface UnitCandidate {
 unit_id: UUID; target: ContentRef; record_id: UUID | null; version_id: UUID | null;
 locator: UnitLocator; snippet: string; snippet_truncated?: boolean; title: string | null; is_current: boolean | null;
 synthetic_demo: boolean; lexical_rank: number | null; semantic_rank: number | null;
 review_summary: ReviewSummary;
}
export interface RetrievalPage {
 candidates: UnitCandidate[]; snapshot_id: UUID; scan_index: number; has_more: boolean;
 snapshot_at: ISODateTime; snapshot_expires_at: ISODateTime; truncated: boolean;
 indexed_units: number; eligible_units: number; stored_status: SearchStatus;
}

export interface ModerationRequest { target: ContentRef | {kind: "record"; id: UUID}; visibility: Visibility; reason: string; }
export interface ModerationResult { target: ModerationRequest["target"]; visibility: Visibility; changed_at: ISODateTime; }
export interface SuspendAgentRequest { agent_id: UUID; reason: string; }
export interface SuspendedAgent { agent_id: UUID; state: "suspended"; }
export interface MaintenanceResult { expired_snapshots_removed: number; expired_rate_buckets_removed: number; }
