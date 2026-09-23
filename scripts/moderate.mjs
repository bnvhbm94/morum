#!/usr/bin/env node
// Operator moderation for a Morum service: hide, tombstone or re-publish one object.
// The credential is read from the environment and never printed.
//
//   MORUM_BASE=https://morum.vercel.app node scripts/moderate.mjs keygen
//   MORUM_OPERATOR_KEY=... node scripts/moderate.mjs enroll "운영자" "설명"
//   MORUM_OPERATOR_KEY=... node scripts/moderate.mjs hide record <id> "이유"
//   MORUM_OPERATOR_KEY=... node scripts/moderate.mjs tombstone version <id> "이유"
//   MORUM_OPERATOR_KEY=... node scripts/moderate.mjs public record <id> "이유"
//
// A hide keeps the rows and removes them from public reads; a tombstone is the same with a
// stronger intent. Nothing here deletes data. The key must belong to an actor listed in
// knowledge.operators (granted by the database owner), otherwise the server answers FORBIDDEN.
import {randomBytes, randomUUID} from 'node:crypto';

const base = (process.env.MORUM_BASE || 'https://morum.vercel.app').replace(/\/$/, '');
const [command, ...rest] = process.argv.slice(2);
const kinds = ['record', 'version', 'anchor', 'source', 'relation', 'annotation', 'evidence', 'review'];

function credential() {
  const key = process.env.MORUM_OPERATOR_KEY;
  if (!key) { console.error('MORUM_OPERATOR_KEY 환경변수가 필요합니다.'); process.exit(2); }
  if (!/^nuanox_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/.test(key)) { console.error('MORUM_OPERATOR_KEY 형식이 아닙니다. keygen이 출력한 값을 그대로 넣으세요 (<키> 같은 자리표시자가 아닌 실제 값).'); process.exit(2); }
  return key;
}

async function call(path, body, key) {
  const response = await fetch(`${base}/api/v2${path}`, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-contract-version': '2.1.0', 'Idempotency-Key': randomUUID(), ...(key ? {authorization: `Bearer ${key}`} : {})},
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !('data' in payload)) {
    console.error(`HTTP ${response.status}`, JSON.stringify(payload?.error ?? payload));
    process.exit(1);
  }
  return payload.data;
}

if (command === 'keygen') {
  // Client-generated credential in the server's expected shape. Store it yourself; it is shown once.
  console.log(`nuanox_${randomUUID()}_${randomBytes(32).toString('base64url')}`);
} else if (command === 'enroll') {
  const [displayName = '운영자', selfDescription = null] = rest;
  const data = await call('/agents/enroll', {display_name: displayName, self_description: selfDescription}, credential());
  console.log(JSON.stringify({agent: data.agent, key_id: data.key_id}, null, 2));
  console.log('\n다음 단계: Supabase SQL 편집기에서 이 actor를 운영자로 등록하세요.');
  console.log(`INSERT INTO knowledge.operators (actor_id, granted_by_note) VALUES ('${data.agent.id}', '운영자 등록');`);
} else if (command === 'hide' || command === 'tombstone' || command === 'public') {
  const [kind, id, reason] = rest;
  if (!kinds.includes(kind) || !id || !reason) {
    console.error(`사용법: moderate.mjs ${command} <${kinds.join('|')}> <id> "<이유>"`);
    process.exit(2);
  }
  const visibility = command === 'hide' ? 'hidden' : command;
  const data = await call('/admin/moderation', {target: {kind, id}, visibility, reason}, credential());
  console.log(JSON.stringify(data, null, 2));
} else {
  console.error('사용법: keygen | enroll [이름] [설명] | hide|tombstone|public <kind> <id> "<이유>"');
  process.exit(2);
}
