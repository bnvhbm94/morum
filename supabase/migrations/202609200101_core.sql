-- Stage 02 / contract 1.0.0. Apply ONCE to the existing dedicated project.
-- No reset/drop, extension installation, account creation or production fixtures.
-- PostgreSQL 15+ UTF8. This is NOT proof of execution on Supabase.
BEGIN;
CREATE SCHEMA knowledge;
CREATE TABLE knowledge.schema_info (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 contract_version text NOT NULL, migration_tag text NOT NULL
);
INSERT INTO knowledge.schema_info VALUES(true,'1.0.0','stage02-core');
CREATE TABLE knowledge.actors (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('human','agent')),
 state text NOT NULL CHECK(state IN ('pending_claim','active','suspended')),
 auth_user_id uuid UNIQUE,
 display_name text NOT NULL CHECK(pg_catalog.length(pg_catalog.btrim(display_name)) BETWEEN 1 AND 80),
 self_description text CHECK(self_description IS NULL OR pg_catalog.length(self_description)<=2000),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 CHECK((kind='human' AND auth_user_id IS NOT NULL AND state<>'pending_claim') OR (kind='agent' AND auth_user_id IS NULL))
);
CREATE TABLE knowledge.agents (
 actor_id uuid PRIMARY KEY REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 owner_actor_id uuid REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 claim_secret_hash text UNIQUE CHECK(claim_secret_hash IS NULL OR claim_secret_hash ~ '^[0-9a-f]{64}$'),
 claim_expires_at timestamptz,
 claimed_at timestamptz,
 CHECK((owner_actor_id IS NULL AND claimed_at IS NULL) OR (owner_actor_id IS NOT NULL AND claimed_at IS NOT NULL))
);
CREATE TABLE knowledge.agent_keys (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES knowledge.agents(actor_id) ON DELETE RESTRICT,
 key_digest text NOT NULL UNIQUE CHECK(key_digest ~ '^[0-9a-f]{64}$'),
 pepper_version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 revoked_at timestamptz,
 CHECK(revoked_at IS NULL OR revoked_at>=created_at)
);
CREATE UNIQUE INDEX one_live_agent_key ON knowledge.agent_keys(actor_id) WHERE revoked_at IS NULL;
CREATE TABLE knowledge.operators (
 actor_id uuid PRIMARY KEY REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 granted_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 granted_by_note text NOT NULL CHECK(pg_catalog.length(pg_catalog.btrim(granted_by_note))>0)
);
CREATE TABLE knowledge.records (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 version_counter integer NOT NULL DEFAULT 0 CHECK(version_counter>=0),
 created_by uuid NOT NULL REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','hidden','tombstone'))
);
CREATE TABLE knowledge.versions (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 created_by uuid NOT NULL REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','hidden','tombstone')),
 record_id uuid NOT NULL REFERENCES knowledge.records(id) ON DELETE RESTRICT,
 version_no integer NOT NULL CHECK(version_no>0),
 parent_version_id uuid REFERENCES knowledge.versions(id) ON DELETE RESTRICT,
 title text CHECK(title IS NULL OR pg_catalog.length(pg_catalog.btrim(title)) BETWEEN 1 AND 240),
 body_text text NOT NULL CHECK(pg_catalog.length(body_text)<=100000 AND pg_catalog.octet_length(body_text)<=1048576 AND pg_catalog.strpos(body_text,pg_catalog.chr(13))=0),
 body_format text NOT NULL CHECK(body_format IN ('plain_text','markdown')),
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[0-9a-f]{64}$'),
 attributes jsonb NOT NULL DEFAULT '{}' CHECK(pg_catalog.jsonb_typeof(attributes)='object'),
 synthetic_demo boolean NOT NULL,
 reason text NOT NULL CHECK(pg_catalog.length(pg_catalog.btrim(reason)) BETWEEN 1 AND 2000),
 UNIQUE(record_id,version_no),
 CHECK(pg_catalog.length(pg_catalog.btrim(body_text,E' \t\n'))>0 OR attributes<>'{}'::jsonb),
 CHECK(body_sha256=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(body_text,'UTF8')),'hex'))
);
CREATE UNIQUE INDEX one_record_root ON knowledge.versions(record_id) WHERE parent_version_id IS NULL;
CREATE TABLE knowledge.version_changes (
 version_id uuid PRIMARY KEY REFERENCES knowledge.versions(id) ON DELETE RESTRICT,
 edits jsonb NOT NULL CHECK(pg_catalog.jsonb_typeof(edits)='array' AND pg_catalog.jsonb_array_length(edits)<=20)
);
CREATE TABLE knowledge.anchors (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 created_by uuid NOT NULL REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','hidden','tombstone')),
 version_id uuid NOT NULL REFERENCES knowledge.versions(id) ON DELETE RESTRICT,
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[0-9a-f]{64}$'),
 start_cp integer NOT NULL, end_cp integer NOT NULL,
 exact text NOT NULL,prefix text NOT NULL,suffix text NOT NULL,
 CHECK(0<=start_cp AND start_cp<end_cp),
 CHECK(pg_catalog.length(prefix)<=32 AND pg_catalog.length(suffix)<=32),
 UNIQUE(version_id,start_cp,end_cp)
);
CREATE TABLE knowledge.sources (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 created_by uuid NOT NULL REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','hidden','tombstone')),
 url text CHECK(url IS NULL OR (pg_catalog.length(url)<=2048 AND url ~* '^https?://[^[:space:]/?#@]+')),
 title text CHECK(title IS NULL OR pg_catalog.length(pg_catalog.btrim(title)) BETWEEN 1 AND 240),
 submitted_text text CHECK(submitted_text IS NULL OR pg_catalog.length(submitted_text)<=100000),
 published_at timestamptz, retrieved_at timestamptz,
 rights_note text CHECK(rights_note IS NULL OR pg_catalog.length(pg_catalog.btrim(rights_note)) BETWEEN 1 AND 8000),
 attributes jsonb NOT NULL DEFAULT '{}' CHECK(pg_catalog.jsonb_typeof(attributes)='object'),
 synthetic_demo boolean NOT NULL,
 CHECK(url IS NOT NULL OR coalesce(pg_catalog.length(pg_catalog.btrim(submitted_text,E' \t\r\n'))>0,false))
);
CREATE TABLE knowledge.relations (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 created_by uuid NOT NULL REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','hidden','tombstone')),
 from_version_id uuid REFERENCES knowledge.versions(id) ON DELETE RESTRICT,
 from_anchor_id uuid REFERENCES knowledge.anchors(id) ON DELETE RESTRICT,
 from_source_id uuid REFERENCES knowledge.sources(id) ON DELETE RESTRICT,
 CHECK(pg_catalog.num_nonnulls(from_version_id,from_anchor_id,from_source_id)=1),
 to_version_id uuid REFERENCES knowledge.versions(id) ON DELETE RESTRICT,
 to_anchor_id uuid REFERENCES knowledge.anchors(id) ON DELETE RESTRICT,
 to_source_id uuid REFERENCES knowledge.sources(id) ON DELETE RESTRICT,
 CHECK(pg_catalog.num_nonnulls(to_version_id,to_anchor_id,to_source_id)=1),
 predicate text NOT NULL CHECK(predicate IN ('supports','contradicts','corrects','depends_on','defines','same_meaning_as','translation_of','derived_from','related_to') OR predicate ~ '^x:[a-z][a-z0-9_.-]{0,31}:[a-z][a-z0-9_.-]{0,31}$'),
 explanation text NOT NULL CHECK(pg_catalog.length(pg_catalog.btrim(explanation)) BETWEEN 1 AND 8000),
 attributes jsonb NOT NULL DEFAULT '{}' CHECK(pg_catalog.jsonb_typeof(attributes)='object'),
 CHECK(ROW(from_version_id,from_anchor_id,from_source_id) IS DISTINCT FROM ROW(to_version_id,to_anchor_id,to_source_id))
);
CREATE TABLE knowledge.annotations (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 created_by uuid NOT NULL REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','hidden','tombstone')),
 anchor_id uuid NOT NULL REFERENCES knowledge.anchors(id) ON DELETE RESTRICT,
 meaning text NOT NULL CHECK(pg_catalog.length(pg_catalog.btrim(meaning)) BETWEEN 1 AND 8000),
 concept_version_id uuid REFERENCES knowledge.versions(id) ON DELETE RESTRICT,
 supersedes_annotation_id uuid REFERENCES knowledge.annotations(id) ON DELETE RESTRICT,
 attributes jsonb NOT NULL DEFAULT '{}' CHECK(pg_catalog.jsonb_typeof(attributes)='object'),
 CHECK(id IS DISTINCT FROM supersedes_annotation_id)
);
CREATE TABLE knowledge.evidence (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 created_by uuid NOT NULL REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','hidden','tombstone')),
 target_version_id uuid REFERENCES knowledge.versions(id) ON DELETE RESTRICT,
 target_anchor_id uuid REFERENCES knowledge.anchors(id) ON DELETE RESTRICT,
 target_source_id uuid REFERENCES knowledge.sources(id) ON DELETE RESTRICT,
 target_relation_id uuid REFERENCES knowledge.relations(id) ON DELETE RESTRICT,
 target_annotation_id uuid REFERENCES knowledge.annotations(id) ON DELETE RESTRICT,
 target_review_id uuid,
 CHECK(pg_catalog.num_nonnulls(target_version_id,target_anchor_id,target_source_id,target_relation_id,target_annotation_id,target_review_id)=1),
 kind text NOT NULL CHECK(kind IN ('external','internal','reasoning')),
 source_id uuid REFERENCES knowledge.sources(id) ON DELETE RESTRICT,
 source_version_id uuid REFERENCES knowledge.versions(id) ON DELETE RESTRICT,
 source_anchor_id uuid REFERENCES knowledge.anchors(id) ON DELETE RESTRICT,
 quote text CHECK(quote IS NULL OR pg_catalog.length(pg_catalog.btrim(quote)) BETWEEN 1 AND 10000),
 explanation text NOT NULL CHECK(pg_catalog.length(pg_catalog.btrim(explanation)) BETWEEN 1 AND 8000),
 submission_state text NOT NULL DEFAULT 'submitted' CHECK(submission_state='submitted'),
 CHECK((kind='external' AND source_id IS NOT NULL AND source_version_id IS NULL AND source_anchor_id IS NULL)
 OR(kind='internal' AND source_id IS NULL AND quote IS NULL AND pg_catalog.num_nonnulls(source_version_id,source_anchor_id)=1)
 OR(kind='reasoning' AND pg_catalog.num_nonnulls(source_id,source_version_id,source_anchor_id)=0 AND quote IS NULL))
);
CREATE TABLE knowledge.reviews (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 created_by uuid NOT NULL REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','hidden','tombstone')),
 target_version_id uuid REFERENCES knowledge.versions(id) ON DELETE RESTRICT,
 target_anchor_id uuid REFERENCES knowledge.anchors(id) ON DELETE RESTRICT,
 target_source_id uuid REFERENCES knowledge.sources(id) ON DELETE RESTRICT,
 target_relation_id uuid REFERENCES knowledge.relations(id) ON DELETE RESTRICT,
 target_annotation_id uuid REFERENCES knowledge.annotations(id) ON DELETE RESTRICT,
 target_evidence_id uuid REFERENCES knowledge.evidence(id) ON DELETE RESTRICT,
 CHECK(pg_catalog.num_nonnulls(target_version_id,target_anchor_id,target_source_id,target_relation_id,target_annotation_id,target_evidence_id)=1),
 stance text NOT NULL CHECK(stance IN ('agree','disagree','needs_review')),
 focus text NOT NULL CHECK(focus IN ('content','evidence_support','quote_match','meaning')),
 explanation text NOT NULL CHECK(pg_catalog.length(pg_catalog.btrim(explanation)) BETWEEN 1 AND 8000),
 previous_review_id uuid REFERENCES knowledge.reviews(id) ON DELETE RESTRICT,
 CHECK(id IS DISTINCT FROM previous_review_id)
);
ALTER TABLE knowledge.evidence ADD CONSTRAINT evidence_target_review_fk FOREIGN KEY(target_review_id) REFERENCES knowledge.reviews(id) ON DELETE RESTRICT;
CREATE TABLE knowledge.review_heads (
 actor_id uuid NOT NULL REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 target_kind text NOT NULL CHECK(target_kind IN ('version','anchor','source','relation','annotation','evidence')),
 target_id uuid NOT NULL,
 focus text NOT NULL CHECK(focus IN ('content','evidence_support','quote_match','meaning')),
 review_id uuid NOT NULL REFERENCES knowledge.reviews(id) ON DELETE RESTRICT,
 PRIMARY KEY(actor_id,target_kind,target_id,focus)
);
CREATE TABLE knowledge.work_requests (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 created_by uuid NOT NULL REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','hidden','tombstone')),
 title text NOT NULL CHECK(pg_catalog.length(pg_catalog.btrim(title)) BETWEEN 1 AND 240),
 description text NOT NULL CHECK(pg_catalog.length(pg_catalog.btrim(description)) BETWEEN 1 AND 8000),
 target_version_id uuid REFERENCES knowledge.versions(id) ON DELETE RESTRICT,
 target_anchor_id uuid REFERENCES knowledge.anchors(id) ON DELETE RESTRICT,
 target_source_id uuid REFERENCES knowledge.sources(id) ON DELETE RESTRICT,
 CHECK(pg_catalog.num_nonnulls(target_version_id,target_anchor_id,target_source_id)<=1),
 suggested_query text CHECK(suggested_query IS NULL OR pg_catalog.length(pg_catalog.btrim(suggested_query)) BETWEEN 1 AND 500),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 assigned_to uuid REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 resolution_event_id uuid,
 CHECK((status='open' AND assigned_to IS NULL) OR status<>'open'),
 CHECK(status<>'in_progress' OR assigned_to IS NOT NULL)
);
CREATE TABLE knowledge.work_events (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 work_request_id uuid NOT NULL REFERENCES knowledge.work_requests(id) ON DELETE RESTRICT,
 revision integer NOT NULL CHECK(revision>0),
 action text NOT NULL CHECK(action IN ('create','claim','release','resolve','close','reopen')),
 reason text NOT NULL CHECK(pg_catalog.length(pg_catalog.btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 resolution_refs jsonb NOT NULL CHECK(pg_catalog.jsonb_typeof(resolution_refs)='array'),
 state_after text NOT NULL CHECK(state_after IN ('open','in_progress','resolved','closed')),
 assigned_after uuid REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 resolution_event_after uuid REFERENCES knowledge.work_events(id) ON DELETE RESTRICT,
 UNIQUE(work_request_id,revision)
);
ALTER TABLE knowledge.work_requests ADD CONSTRAINT work_resolution_event_fk FOREIGN KEY(resolution_event_id) REFERENCES knowledge.work_events(id) ON DELETE RESTRICT;
CREATE TABLE knowledge.work_resolution_links (
 event_id uuid NOT NULL REFERENCES knowledge.work_events(id) ON DELETE RESTRICT,
 ordinal integer NOT NULL CHECK(ordinal>=0),
 target_version_id uuid REFERENCES knowledge.versions(id) ON DELETE RESTRICT,
 target_anchor_id uuid REFERENCES knowledge.anchors(id) ON DELETE RESTRICT,
 target_source_id uuid REFERENCES knowledge.sources(id) ON DELETE RESTRICT,
 CHECK(pg_catalog.num_nonnulls(target_version_id,target_anchor_id,target_source_id)=1),
 PRIMARY KEY(event_id,ordinal)
);
CREATE TABLE knowledge.mutation_receipts (
 actor_id uuid NOT NULL REFERENCES knowledge.actors(id) ON DELETE RESTRICT, operation text NOT NULL,
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9._~-]{16,128}$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 sql_command_hash text NOT NULL CHECK(sql_command_hash ~ '^[0-9a-f]{64}$'),
 result_kind text NOT NULL CHECK(result_kind IN ('version','anchor','source','relation','annotation','evidence','review','work_request')),
 result_id uuid NOT NULL,
 response_json jsonb NOT NULL CHECK(pg_catalog.jsonb_typeof(response_json)='object'),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 PRIMARY KEY(actor_id,operation,idempotency_key)
);
CREATE TABLE knowledge.audit_events (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 action text NOT NULL,target_kind text NOT NULL,target_id uuid NOT NULL,
 metadata_sanitized jsonb NOT NULL DEFAULT '{}' CHECK(pg_catalog.jsonb_typeof(metadata_sanitized)='object'),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp()
);
CREATE TABLE knowledge.moderation_events (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES knowledge.operators(actor_id) ON DELETE RESTRICT,
 target_kind text NOT NULL,target_id uuid NOT NULL,
 before_visibility text NOT NULL CHECK(before_visibility IN ('public','hidden','tombstone')),
 after_visibility text NOT NULL CHECK(after_visibility IN ('public','hidden','tombstone')),
 reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp()
);
CREATE TABLE knowledge.embedding_profiles (
 id text PRIMARY KEY,provider text NOT NULL,model text NOT NULL,dimensions integer NOT NULL CHECK(dimensions>0),
 normalization text NOT NULL,query_transform text NOT NULL,document_transform text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 status text NOT NULL DEFAULT 'disabled' CHECK(status IN ('disabled','enabled','retired'))
);
INSERT INTO knowledge.embedding_profiles(id,provider,model,dimensions,normalization,query_transform,document_transform,status)
VALUES('openai-te3s-1536-v1','openai','text-embedding-3-small',1536,'validate-finite-l2-cosine','NFC; LF; trim; no prefix','NFC; LF; trim; no prefix; raw unit only','disabled');
CREATE TABLE knowledge.search_units (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 unit_kind text NOT NULL CHECK(unit_kind IN ('body','field','object')),
 record_id uuid REFERENCES knowledge.records(id) ON DELETE RESTRICT,
 version_id uuid REFERENCES knowledge.versions(id) ON DELETE RESTRICT,
 object_version_id uuid REFERENCES knowledge.versions(id) ON DELETE RESTRICT,
 object_anchor_id uuid REFERENCES knowledge.anchors(id) ON DELETE RESTRICT,
 object_source_id uuid REFERENCES knowledge.sources(id) ON DELETE RESTRICT,
 object_relation_id uuid REFERENCES knowledge.relations(id) ON DELETE RESTRICT,
 object_annotation_id uuid REFERENCES knowledge.annotations(id) ON DELETE RESTRICT,
 object_evidence_id uuid REFERENCES knowledge.evidence(id) ON DELETE RESTRICT,
 object_review_id uuid REFERENCES knowledge.reviews(id) ON DELETE RESTRICT,
 start_cp integer,end_cp integer,json_pointer text,
 ordinal integer NOT NULL CHECK(ordinal>=0),
 raw_text text NOT NULL,input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[0-9a-f]{64}$'),
 lexical_text text NOT NULL,lexical_truncated boolean NOT NULL DEFAULT false,
 chunker_version text NOT NULL DEFAULT 'cp1000-o120-v1',
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 CHECK(input_sha256=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(raw_text,'UTF8')),'hex')),
 CHECK((unit_kind='body' AND record_id IS NOT NULL AND version_id IS NOT NULL AND start_cp>=0 AND end_cp>start_cp AND json_pointer IS NULL AND pg_catalog.num_nonnulls(object_version_id,object_anchor_id,object_source_id,object_relation_id,object_annotation_id,object_evidence_id,object_review_id)=0)
 OR(unit_kind='field' AND record_id IS NOT NULL AND version_id IS NOT NULL AND start_cp IS NULL AND end_cp IS NULL AND json_pointer IS NOT NULL AND pg_catalog.num_nonnulls(object_version_id,object_anchor_id,object_source_id,object_relation_id,object_annotation_id,object_evidence_id,object_review_id)=0)
 OR(unit_kind='object' AND record_id IS NULL AND version_id IS NULL AND start_cp IS NULL AND end_cp IS NULL AND json_pointer IS NULL AND pg_catalog.num_nonnulls(object_version_id,object_anchor_id,object_source_id,object_relation_id,object_annotation_id,object_evidence_id,object_review_id)=1))
);
CREATE TABLE knowledge.embedding_jobs (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 unit_id uuid NOT NULL REFERENCES knowledge.search_units(id) ON DELETE RESTRICT,
 profile_id text NOT NULL REFERENCES knowledge.embedding_profiles(id) ON DELETE RESTRICT,
 input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'blocked' CHECK(state IN ('blocked','pending','leased','ready','retry','dead')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),last_error_code text,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 UNIQUE(unit_id,profile_id,input_sha256)
);
CREATE TABLE knowledge.query_snapshots (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 query_hash text NOT NULL CHECK(query_hash ~ '^[0-9a-f]{64}$'),
 scope text NOT NULL,
 ordered_entries jsonb NOT NULL CHECK(pg_catalog.jsonb_typeof(ordered_entries)='array' AND pg_catalog.jsonb_array_length(ordered_entries)<=500),
 status_snapshot jsonb NOT NULL DEFAULT '{}' CHECK(pg_catalog.jsonb_typeof(status_snapshot)='object'),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT (pg_catalog.transaction_timestamp()+interval '10 minutes'),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes')
);

-- Triggers defend immutable history even against accidental trusted-writer DML.
CREATE FUNCTION knowledge.immutable_row() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND pg_catalog.current_setting('knowledge.moderation',true)='on'
    AND (pg_catalog.to_jsonb(NEW)-'visibility')=(pg_catalog.to_jsonb(OLD)-'visibility') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'KB:FORBIDDEN' USING ERRCODE='P0001';
END $$;
CREATE FUNCTION knowledge.agent_owner_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM knowledge.actors WHERE id=NEW.actor_id AND kind='agent')
 OR (NEW.owner_actor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM knowledge.actors WHERE id=NEW.owner_actor_id AND kind='human')) THEN
 RAISE EXCEPTION 'KB:VALIDATION_FAILED'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER agent_owner_guard BEFORE INSERT OR UPDATE ON knowledge.agents FOR EACH ROW EXECUTE FUNCTION knowledge.agent_owner_guard();
CREATE FUNCTION knowledge.version_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p knowledge.versions%ROWTYPE; r knowledge.records%ROWTYPE;
BEGIN
 SELECT * INTO r FROM knowledge.records WHERE id=NEW.record_id FOR UPDATE;
 IF NEW.version_no<>r.version_counter THEN RAISE EXCEPTION 'KB:VALIDATION_FAILED'; END IF;
 IF NEW.parent_version_id IS NULL THEN
  IF NEW.version_no<>1 THEN RAISE EXCEPTION 'KB:VALIDATION_FAILED'; END IF;
 ELSE
  SELECT * INTO p FROM knowledge.versions WHERE id=NEW.parent_version_id;
  IF p.id IS NULL OR p.record_id<>NEW.record_id OR p.version_no>=NEW.version_no OR p.synthetic_demo<>NEW.synthetic_demo THEN RAISE EXCEPTION 'KB:VALIDATION_FAILED'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER version_guard BEFORE INSERT ON knowledge.versions FOR EACH ROW EXECUTE FUNCTION knowledge.version_guard();
CREATE FUNCTION knowledge.record_counter_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE n integer; c integer;
BEGIN
 SELECT version_counter INTO c FROM knowledge.records WHERE id=NEW.id;
 SELECT max(version_no) INTO n FROM knowledge.versions WHERE record_id=NEW.id;
 IF n IS NULL OR n<>c THEN RAISE EXCEPTION 'KB:VALIDATION_FAILED'; END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER record_counter_guard AFTER INSERT OR UPDATE ON knowledge.records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION knowledge.record_counter_guard();
CREATE FUNCTION knowledge.anchor_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v knowledge.versions%ROWTYPE;
BEGIN
 SELECT * INTO v FROM knowledge.versions WHERE id=NEW.version_id;
 IF v.id IS NULL OR NEW.body_sha256<>v.body_sha256 THEN RAISE EXCEPTION 'KB:BASE_HASH_MISMATCH'; END IF;
 IF NEW.end_cp>pg_catalog.length(v.body_text) OR NEW.exact<>pg_catalog.substr(v.body_text,NEW.start_cp+1,NEW.end_cp-NEW.start_cp)
 OR NEW.prefix<>pg_catalog.substr(v.body_text,greatest(0,NEW.start_cp-32)+1,least(32,NEW.start_cp))
 OR NEW.suffix<>pg_catalog.substr(v.body_text,NEW.end_cp+1,32) THEN RAISE EXCEPTION 'KB:TEXT_MISMATCH'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER anchor_guard BEFORE INSERT ON knowledge.anchors FOR EACH ROW EXECUTE FUNCTION knowledge.anchor_guard();
CREATE FUNCTION knowledge.annotation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE olda knowledge.annotations%ROWTYPE; av knowledge.versions%ROWTYPE; bv knowledge.versions%ROWTYPE;
BEGIN
 IF NEW.supersedes_annotation_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO olda FROM knowledge.annotations WHERE id=NEW.supersedes_annotation_id;
 IF olda.id IS NULL OR olda.created_by<>NEW.created_by THEN RAISE EXCEPTION 'KB:FORBIDDEN'; END IF;
 IF olda.anchor_id=NEW.anchor_id THEN RETURN NEW; END IF;
 SELECT v.* INTO av FROM knowledge.anchors a JOIN knowledge.versions v ON a.version_id=v.id WHERE a.id=olda.anchor_id;
 SELECT v.* INTO bv FROM knowledge.anchors a JOIN knowledge.versions v ON a.version_id=v.id WHERE a.id=NEW.anchor_id;
 IF bv.record_id<>av.record_id OR bv.parent_version_id IS DISTINCT FROM av.id THEN RAISE EXCEPTION 'KB:VALIDATION_FAILED'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER annotation_guard BEFORE INSERT ON knowledge.annotations FOR EACH ROW EXECUTE FUNCTION knowledge.annotation_guard();
CREATE FUNCTION knowledge.review_slot_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r knowledge.reviews%ROWTYPE; k text; i uuid;
BEGIN
 SELECT * INTO r FROM knowledge.reviews WHERE id=NEW.review_id;
 IF r.id IS NULL OR r.created_by<>NEW.actor_id OR r.focus<>NEW.focus THEN RAISE EXCEPTION 'KB:VALIDATION_FAILED'; END IF;
 SELECT key INTO k FROM pg_catalog.jsonb_each(pg_catalog.to_jsonb(r)) WHERE key LIKE 'target_%_id' AND value<>'null'::jsonb LIMIT 1;
 -- Derive the exact typed FK, never trust head.target_id as a stand-alone reference.
 k=pg_catalog.substr(k,8,pg_catalog.length(k)-10);
 i=(pg_catalog.to_jsonb(r)->>('target_'||k||'_id'))::uuid;
 IF NEW.target_kind<>k OR NEW.target_id<>i THEN RAISE EXCEPTION 'KB:VALIDATION_FAILED'; END IF;
 IF TG_OP='INSERT' AND r.previous_review_id IS NOT NULL THEN RAISE EXCEPTION 'KB:REVIEW_HEAD_CHANGED'; END IF;
 IF TG_OP='UPDATE' AND r.previous_review_id IS DISTINCT FROM OLD.review_id THEN RAISE EXCEPTION 'KB:REVIEW_HEAD_CHANGED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_slot_guard BEFORE INSERT OR UPDATE ON knowledge.review_heads FOR EACH ROW EXECUTE FUNCTION knowledge.review_slot_guard();
CREATE TRIGGER versions_immutable BEFORE UPDATE OR DELETE ON knowledge.versions FOR EACH ROW EXECUTE FUNCTION knowledge.immutable_row();
CREATE TRIGGER version_changes_immutable BEFORE UPDATE OR DELETE ON knowledge.version_changes FOR EACH ROW EXECUTE FUNCTION knowledge.immutable_row();
CREATE TRIGGER anchors_immutable BEFORE UPDATE OR DELETE ON knowledge.anchors FOR EACH ROW EXECUTE FUNCTION knowledge.immutable_row();
CREATE TRIGGER sources_immutable BEFORE UPDATE OR DELETE ON knowledge.sources FOR EACH ROW EXECUTE FUNCTION knowledge.immutable_row();
CREATE TRIGGER relations_immutable BEFORE UPDATE OR DELETE ON knowledge.relations FOR EACH ROW EXECUTE FUNCTION knowledge.immutable_row();
CREATE TRIGGER annotations_immutable BEFORE UPDATE OR DELETE ON knowledge.annotations FOR EACH ROW EXECUTE FUNCTION knowledge.immutable_row();
CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE ON knowledge.evidence FOR EACH ROW EXECUTE FUNCTION knowledge.immutable_row();
CREATE TRIGGER reviews_immutable BEFORE UPDATE OR DELETE ON knowledge.reviews FOR EACH ROW EXECUTE FUNCTION knowledge.immutable_row();
CREATE TRIGGER work_events_immutable BEFORE UPDATE OR DELETE ON knowledge.work_events FOR EACH ROW EXECUTE FUNCTION knowledge.immutable_row();
CREATE TRIGGER work_resolution_links_immutable BEFORE UPDATE OR DELETE ON knowledge.work_resolution_links FOR EACH ROW EXECUTE FUNCTION knowledge.immutable_row();
CREATE TRIGGER mutation_receipts_immutable BEFORE UPDATE OR DELETE ON knowledge.mutation_receipts FOR EACH ROW EXECUTE FUNCTION knowledge.immutable_row();
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON knowledge.audit_events FOR EACH ROW EXECUTE FUNCTION knowledge.immutable_row();
CREATE TRIGGER moderation_events_immutable BEFORE UPDATE OR DELETE ON knowledge.moderation_events FOR EACH ROW EXECUTE FUNCTION knowledge.immutable_row();

-- All schema objects are private from creation, including implicit PUBLIC EXECUTE.
REVOKE ALL ON SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA knowledge REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA knowledge REVOKE ALL ON TABLES FROM PUBLIC;
COMMIT;
