-- Stage 03 bounded read responses; full source text is never silently overwritten.
BEGIN;

CREATE OR REPLACE FUNCTION knowledge.evidence_for(kind text,object_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(pg_catalog.jsonb_agg(knowledge.dto('evidence',e.id) ORDER BY e.created_at,e.id),'[]'::jsonb)
 FROM(SELECT ev.* FROM knowledge.evidence ev WHERE knowledge.row_ref(pg_catalog.to_jsonb(ev),'target')=pg_catalog.jsonb_build_object('kind',$1,'id',$2) AND knowledge.is_public('evidence',ev.id) ORDER BY ev.created_at,ev.id LIMIT 10) e
$$;
CREATE FUNCTION knowledge.evidence_count(kind text,object_id uuid) RETURNS bigint LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT count(*) FROM knowledge.evidence e WHERE knowledge.row_ref(pg_catalog.to_jsonb(e),'target')=pg_catalog.jsonb_build_object('kind',$1,'id',$2) AND knowledge.is_public('evidence',e.id)
$$;

CREATE OR REPLACE FUNCTION knowledge.version_view(version uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE v knowledge.versions%ROWTYPE;a jsonb;c uuid;corrections jsonb;ac bigint;rc bigint;vc bigint;cut boolean=false; BEGIN
 PERFORM knowledge.require_public('version',version);SELECT * INTO v FROM knowledge.versions WHERE id=version;c=knowledge.current_version(v.record_id);
 SELECT pg_catalog.jsonb_build_object('id',id,'kind',kind,'display_name',display_name,'self_description',self_description,'state',state) INTO a FROM knowledge.actors WHERE id=v.created_by;
 SELECT coalesce(pg_catalog.jsonb_agg(knowledge.row_ref(pg_catalog.to_jsonb(r),'from') ORDER BY created_at,id),'[]'::jsonb) INTO corrections FROM (SELECT r.* FROM knowledge.relations r
 WHERE predicate='corrects' AND (to_version_id=version OR to_anchor_id IN(SELECT id FROM knowledge.anchors WHERE version_id=version)) AND knowledge.is_public('relation',id) ORDER BY created_at,id LIMIT 51) r;
 cut=pg_catalog.jsonb_array_length(corrections)>50;IF cut THEN corrections=corrections-50;END IF;
 SELECT count(*) INTO ac FROM knowledge.annotations an JOIN knowledge.anchors aa ON an.anchor_id=aa.id WHERE aa.version_id=version AND knowledge.is_public('annotation',an.id);
 SELECT count(*) INTO rc FROM knowledge.relations r WHERE (r.from_version_id=version OR r.to_version_id=version OR r.from_anchor_id IN(SELECT id FROM knowledge.anchors WHERE version_id=version) OR r.to_anchor_id IN(SELECT id FROM knowledge.anchors WHERE version_id=version)) AND knowledge.is_public('relation',r.id);
 SELECT count(*) INTO vc FROM knowledge.reviews r WHERE target_version_id=version AND knowledge.is_public('review',id);
 RETURN pg_catalog.jsonb_build_object('version',knowledge.dto('version',version),'author',a,'is_current',c=version,'current_version_id',c,'basis',knowledge.evidence_for('version',version),'basis_truncated',knowledge.evidence_count('version',version)>10,'corrections_truncated',cut,'review_summary',knowledge.review_summary('version',version),'correction_refs',corrections,'related_counts',pg_catalog.jsonb_build_object('annotations',ac,'relations',rc,'reviews',vc),'links',pg_catalog.jsonb_build_object('record','/api/v2/records/'||v.record_id,'version','/api/v2/versions/'||v.id,'history','/api/v2/records/'||v.record_id||'/versions','raw','/api/v2/versions/'||v.id||'/raw'));
END $$;


CREATE OR REPLACE FUNCTION knowledge.object_view(q jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE k text;i uuid;j jsonb;owner uuid;BEGIN
 PERFORM knowledge.jobject(q,ARRAY['kind','id'],ARRAY['kind','id']);PERFORM knowledge.validate_ref(q,ARRAY['version','anchor','source','relation','annotation','evidence','review']);
 k=q->>'kind';i=(q->>'id')::uuid;PERFORM knowledge.require_public(k,i);j=knowledge.raw_object(k,i);
 owner=knowledge.owner_version(k,i);
 RETURN pg_catalog.jsonb_build_object('target',pg_catalog.jsonb_build_object('kind',k,'id',i),'value',knowledge.dto(k,i),'owner_version_id',owner,'basis_truncated',CASE WHEN k='evidence' THEN false ELSE knowledge.evidence_count(k,i)>10 END,'basis',CASE WHEN k='evidence' THEN '[]'::jsonb ELSE knowledge.evidence_for(k,i) END);
END $$;

CREATE OR REPLACE FUNCTION knowledge.snapshot_page(scope_name text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE snap knowledge.query_snapshots%ROWTYPE;qh text;entries jsonb;counted integer;pos integer;stop integer;lim integer;entry jsonb;items jsonb='[]';val jsonb;item jsonb;budget integer;limited boolean=false;BEGIN
 budget=CASE WHEN scope_name='part' THEN 150000 ELSE 800000 END;
 lim=CASE WHEN q?'limit' THEN knowledge.jint(q->'limit',1,50) ELSE 20 END;
 qh=knowledge.hash(scope_name||':'||(q-ARRAY['_snapshot_id','_scan_index','limit'])::text);
 IF q?'_snapshot_id' THEN
  PERFORM knowledge.juuid(q->'_snapshot_id');pos=knowledge.jint(q->'_scan_index',0,500);
  SELECT * INTO snap FROM knowledge.query_snapshots WHERE id=(q->>'_snapshot_id')::uuid;
  PERFORM knowledge.require(snap.id IS NOT NULL,'CURSOR_INVALID');PERFORM knowledge.require(snap.expires_at>pg_catalog.clock_timestamp(),'CURSOR_EXPIRED');
  PERFORM knowledge.require(snap.scope=scope_name AND snap.query_hash=qh AND pos<=pg_catalog.jsonb_array_length(snap.ordered_entries),'CURSOR_INVALID');
 ELSE
  PERFORM knowledge.require(NOT q?'_scan_index','CURSOR_INVALID');pos=0;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind',c.object_kind,'id',c.object_id) ORDER BY c.object_created_at DESC,c.object_id),'[]'::jsonb),count(*) INTO entries,counted
   FROM(SELECT * FROM knowledge.list_candidates(scope_name,q) ORDER BY object_created_at DESC,object_id LIMIT 501)c;
  IF counted>500 THEN entries=entries-500;END IF;
  INSERT INTO knowledge.query_snapshots(query_hash,scope,ordered_entries,status_snapshot) VALUES(qh,scope_name,entries,pg_catalog.jsonb_build_object('truncated',counted>500)) RETURNING * INTO snap;
 END IF;
 stop=least(pos+lim,pg_catalog.jsonb_array_length(snap.ordered_entries));
 WHILE pos<stop LOOP
  entry=snap.ordered_entries->pos;
  IF knowledge.is_public(entry->>'kind',(entry->>'id')::uuid) THEN
   IF entry->>'kind'='record' THEN
    IF knowledge.current_version((entry->>'id')::uuid) IS NULL THEN pos=pos+1;CONTINUE;END IF;
    val=knowledge.record_summary((entry->>'id')::uuid);
   ELSE val=knowledge.dto(entry->>'kind',(entry->>'id')::uuid);END IF;
   item=pg_catalog.jsonb_build_object('kind',entry->>'kind','value',val);
   IF pg_catalog.octet_length((items||pg_catalog.jsonb_build_array(item))::text)>budget THEN PERFORM knowledge.require(pg_catalog.jsonb_array_length(items)>0,'PAYLOAD_TOO_LARGE');limited=true;EXIT;END IF;
   items=items||pg_catalog.jsonb_build_array(item);
  END IF;pos=pos+1;
 END LOOP;
 RETURN pg_catalog.jsonb_build_object('items',items,'snapshot_id',snap.id,'scan_index',pos,'has_more',pos<pg_catalog.jsonb_array_length(snap.ordered_entries),'snapshot_at',knowledge.utc(snap.created_at),'snapshot_expires_at',knowledge.utc(snap.expires_at),'truncated',limited OR (snap.status_snapshot->>'truncated')::boolean);
END $$;

CREATE OR REPLACE FUNCTION knowledge.version_history(q jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE rid uuid;upper_no integer;last_no integer;lim integer;items jsonb;n integer;last_item jsonb;snapshot_at text;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);
 PERFORM knowledge.jobject(q,ARRAY['record_id','limit','upper_version_no','last_version_no','snapshot_at'],ARRAY['record_id']);
 rid=knowledge.juuid(q->'record_id');PERFORM knowledge.require_public('record',rid);
 lim=CASE WHEN q?'limit' THEN knowledge.jint(q->'limit',1,50) ELSE 20 END;
 IF q?'upper_version_no' THEN
  upper_no=knowledge.jint(q->'upper_version_no',0,2147483647);last_no=knowledge.jint(q->'last_version_no',1,2147483647);PERFORM knowledge.require(last_no<=upper_no,'CURSOR_INVALID');
  PERFORM knowledge.validate_date(q->'snapshot_at');snapshot_at=q->>'snapshot_at';
  PERFORM knowledge.require(snapshot_at IS NOT NULL AND snapshot_at::timestamptz<=pg_catalog.clock_timestamp(),'CURSOR_INVALID');
  PERFORM knowledge.require(snapshot_at::timestamptz+interval '10 minutes'>pg_catalog.clock_timestamp(),'CURSOR_EXPIRED');
 ELSE
  PERFORM knowledge.require(NOT q?'last_version_no' AND NOT q?'snapshot_at','CURSOR_INVALID');
  SELECT coalesce(max(version_no),0) INTO upper_no FROM knowledge.versions WHERE record_id=rid AND visibility='public';last_no=NULL;snapshot_at=knowledge.utc(pg_catalog.transaction_timestamp());
 END IF;
 SELECT coalesce(pg_catalog.jsonb_agg(knowledge.dto('version',v.id) ORDER BY v.version_no DESC),'[]'::jsonb),count(*) INTO items,n
 FROM(SELECT id,version_no FROM knowledge.versions WHERE record_id=rid AND visibility='public' AND version_no<=upper_no AND (last_no IS NULL OR version_no<last_no) ORDER BY version_no DESC LIMIT lim+1)v;
 IF n>lim THEN items=items-lim;END IF;
 WHILE pg_catalog.octet_length(items::text)>800000 AND pg_catalog.jsonb_array_length(items)>1 LOOP items=items-(pg_catalog.jsonb_array_length(items)-1);END LOOP;
 last_item=items->(pg_catalog.jsonb_array_length(items)-1);
 RETURN pg_catalog.jsonb_build_object('items',items,'upper_version_no',upper_no,'last_version_no',last_item->'version_no','has_more',n>pg_catalog.jsonb_array_length(items),'snapshot_at',snapshot_at,'truncated',false);
END $$;

CREATE OR REPLACE FUNCTION knowledge.part_read(q jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v knowledge.versions%ROWTYPE;s integer;e integer;cb integer;ca integer;cs integer;ce integer;pg jsonb;anns jsonb;rels jsonb;anchor_id uuid;summary jsonb;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);
 PERFORM knowledge.jobject(q,ARRAY['version_id','start','end','context_before','context_after','_snapshot_id','_scan_index'],ARRAY['version_id','start','end','context_before','context_after']);
 PERFORM knowledge.juuid(q->'version_id');PERFORM knowledge.require_public('version',(q->>'version_id')::uuid);SELECT * INTO v FROM knowledge.versions WHERE id=(q->>'version_id')::uuid;
 s=knowledge.jint(q->'start',0,pg_catalog.length(v.body_text));e=knowledge.jint(q->'end',s,pg_catalog.length(v.body_text));
 PERFORM knowledge.require(e-s<=16000,'PAYLOAD_TOO_LARGE');
 cb=knowledge.jint(q->'context_before',0,1000);ca=knowledge.jint(q->'context_after',0,1000);cs=greatest(0,s-cb);ce=least(pg_catalog.length(v.body_text),e+ca);
 pg=knowledge.snapshot_page('part',q||'{"limit":50}'::jsonb);
 SELECT coalesce(pg_catalog.jsonb_agg(value->'value'),'[]'::jsonb) INTO anns FROM pg_catalog.jsonb_array_elements(pg->'items') WHERE value->>'kind'='annotation';
 SELECT coalesce(pg_catalog.jsonb_agg(value->'value'),'[]'::jsonb) INTO rels FROM pg_catalog.jsonb_array_elements(pg->'items') WHERE value->>'kind'='relation';
 SELECT id INTO anchor_id FROM knowledge.anchors WHERE version_id=v.id AND start_cp=s AND end_cp=e AND visibility='public';
 summary=knowledge.review_summary('anchor',anchor_id);
 RETURN pg_catalog.jsonb_build_object('version_id',v.id,'body_sha256',v.body_sha256,'start',s,'end',e,'exact',pg_catalog.substr(v.body_text,s+1,e-s),'context_start',cs,'context_end',ce,'context_text',pg_catalog.substr(v.body_text,cs+1,ce-cs),'annotations',anns,'relations',rels,'review_summary',summary,'truncated',(pg->>'truncated')::boolean OR (pg->>'has_more')::boolean,'pagination',pg-'items');
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
UPDATE knowledge.schema_info SET migration_tag='stage04-debug-bounds' WHERE singleton;
COMMIT;
