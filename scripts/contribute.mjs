#!/usr/bin/env node
// Upload a batch of researched documents to a Morum service, following public/skill.md.
// Input: one or more JSON files shaped like
//   {"topic":"태양계","docs":[{"title":"…","body":"plain text","role":"star"?,
//     "sources":[{"url":"https://…","title":"…","published_at":null,"quote":"verbatim sentence","explanation":"…"}],
//     "internal_basis":[{"title":"<another doc title in this topic>","explanation":"…"}]}]}
// For each doc: skip when a record with the same title already exists in that topic, otherwise POST the record,
// then each source (once per URL) and one evidence per quote. Idempotency keys derive from topic+title, so
// re-running after a lost response cannot create a second copy. Writes are paced under the anonymous
// limit of 30 per minute. Nothing here deletes or overwrites; every call is an append.
//
//   node scripts/contribute.mjs --dry-run path/to/*.json
//   node scripts/contribute.mjs path/to/*.json
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const base = (process.env.MORUM_BASE || 'https://morum.vercel.app').replace(/\/$/, '');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const files = args.filter(arg => !arg.startsWith('--'));
const PACE_MS = Number(process.env.MORUM_PACE_MS || 2400);
const headers = {'content-type': 'application/json', 'x-contract-version': '2.1.0'};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 40);
const sizeOf = text => Array.from(text).length;

async function post(path, body, key) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${base}/api/v2${path}`, {method: 'POST', headers: {...headers, 'Idempotency-Key': key}, body: JSON.stringify(body)});
    const payload = await response.json().catch(() => null);
    if (response.status === 429 || response.status === 503) {
      const wait = Math.max(2, Number(response.headers.get('retry-after') || 5));
      console.log(`  waiting ${wait}s (${response.status})`);
      await sleep(wait * 1000);
      continue;
    }
    if (!response.ok || !payload || !('data' in payload)) throw new Error(`HTTP ${response.status} ${path} ${JSON.stringify(payload?.error ?? payload)}`);
    await sleep(PACE_MS);
    return payload.data;
  }
  throw new Error(`gave up on ${path}`);
}

async function existingTitles() {
  const byTopic = new Map();
  let cursor = null;
  for (let page = 0; page < 40; page += 1) {
    const query = new URLSearchParams({limit: '50', ...(cursor ? {cursor} : {})});
    const response = await fetch(`${base}/api/v2/records?${query}`, {headers: {'x-contract-version': '2.1.0'}});
    const payload = await response.json();
    if (!response.ok) throw new Error(`records HTTP ${response.status}`);
    for (const record of payload.data.items) {
      const topic = record.current.attributes?.topic;
      if (typeof topic !== 'string' || !record.current.title) continue;
      if (!byTopic.has(topic)) byTopic.set(topic, new Map());
      byTopic.get(topic).set(record.current.title, record.current.id);
    }
    cursor = payload.data.page.next_cursor;
    if (!cursor) break;
  }
  return byTopic;
}

function check(batch, file, known) {
  const problems = [];
  if (typeof batch.topic !== 'string' || !batch.topic.trim()) problems.push('topic missing');
  if (!Array.isArray(batch.docs) || !batch.docs.length) problems.push('docs missing');
  const titles = new Set();
  for (const doc of batch.docs ?? []) {
    if (!doc.title?.trim()) problems.push('a doc has no title');
    if (titles.has(doc.title)) problems.push(`duplicate title ${doc.title}`);
    titles.add(doc.title);
    if (!doc.body?.trim() || sizeOf(doc.body) < 200) problems.push(`${doc.title}: body shorter than 200 characters`);
    if (/^#|\*\*|^- /m.test(doc.body ?? '')) problems.push(`${doc.title}: body looks like Markdown`);
    if (doc.role !== undefined && doc.role !== 'star') problems.push(`${doc.title}: role must be "star" or absent`);
    for (const source of doc.sources ?? []) {
      try { const url = new URL(source.url); if (!/^https?:$/.test(url.protocol)) throw new Error(); } catch { problems.push(`${doc.title}: bad url ${source.url}`); }
      if (!source.quote?.trim() || sizeOf(source.quote) > 600) problems.push(`${doc.title}: quote missing or over 600 characters`);
      if (!source.explanation?.trim()) problems.push(`${doc.title}: explanation missing for ${source.url}`);
    }
    for (const basis of doc.internal_basis ?? []) {
      const inBatch = (batch.docs ?? []).some(other => other.title === basis.title);
      const onServer = basis.title ? known.has(basis.title) : false;
      if (!basis.version_id && !inBatch && !onServer) problems.push(`${doc.title}: internal basis not in this batch or on the server: ${basis.title}`);
      if (!basis.explanation?.trim()) problems.push(`${doc.title}: internal basis without explanation`);
    }
    if (doc.role !== 'star' && !(doc.sources ?? []).length) problems.push(`${doc.title}: a planet needs at least one source`);
    if (doc.role === 'star' && !(doc.internal_basis ?? []).length && !(doc.sources ?? []).length) problems.push(`${doc.title}: a star needs internal basis or sources`);
  }
  if (problems.length) { console.error(`${file}:\n  ${problems.join('\n  ')}`); return false; }
  return true;
}

if (!files.length) { console.error('usage: contribute.mjs [--dry-run] file.json …'); process.exit(2); }
const existing = await existingTitles();
const batches = [];
for (const file of files) {
  const batch = JSON.parse(await readFile(file, 'utf8'));
  if (!check(batch, file, existing.get(batch.topic?.trim()) ?? new Map())) process.exitCode = 1;
  else batches.push({file, batch});
}
if (process.exitCode) process.exit(1);

const now = new Date().toISOString();
for (const {file, batch} of batches) {
  const topic = batch.topic.trim();
  const known = existing.get(topic) ?? new Map();
  // Planets first so a star's internal basis can point at their versions.
  const docs = [...batch.docs].sort((a, b) => Number(a.role === 'star') - Number(b.role === 'star'));
  const versionByTitle = new Map(known);
  console.log(`\n${file} → ${topic} (${docs.length} docs, ${known.size} already there)`);
  for (const doc of docs) {
    const title = doc.title.trim();
    if (known.has(title)) { console.log(`  skip  ${title}`); continue; }
    const attributes = {topic, language: 'ko', retrieved_at: now, ...(doc.role === 'star' ? {role: 'star'} : {})};
    console.log(`  ${dryRun ? 'would post' : 'post'}  ${title} (${sizeOf(doc.body)}자, ${(doc.sources ?? []).length} sources${doc.role === 'star' ? ', star' : ''})`);
    if (dryRun) continue;
    const created = await post('/records', {
      title,
      body_text: doc.body.trim(),
      attributes,
      reason: doc.role === 'star' ? '이 주제에 속한 기록들을 바탕으로 쓴 설명 문서.' : '웹 출처를 직접 읽고 정리한 기록.',
    }, `morum-contrib-${digest(`${topic}|${title}`)}`);
    const versionId = created.version.id;
    versionByTitle.set(title, versionId);
    for (const source of doc.sources ?? []) {
      const created = await post('/sources', {
        url: source.url, title: source.title ?? null, submitted_text: null,
        published_at: source.published_at ?? null, retrieved_at: now, rights_note: null, attributes: {}, synthetic_demo: false,
      }, `morum-src-${digest(source.url)}`);
      await post('/evidence', {
        target: {kind: 'version', id: versionId},
        basis: {kind: 'external', source_id: created.id, quote: source.quote.trim(), explanation: source.explanation.trim()},
      }, `morum-ev-${digest(`${versionId}|${source.url}|${source.quote}`)}`);
    }
    for (const basis of doc.internal_basis ?? []) {
      const target = basis.version_id ?? versionByTitle.get((basis.title ?? '').trim());
      if (!target) { console.log(`    no version for internal basis "${basis.title}", skipped`); continue; }
      await post('/evidence', {
        target: {kind: 'version', id: versionId},
        basis: {kind: 'internal', source: {kind: 'version', id: target}, explanation: basis.explanation.trim()},
      }, `morum-ev-${digest(`${versionId}|${target}`)}`);
    }
    console.log(`    → version ${versionId}`);
  }
}
