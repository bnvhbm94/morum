#!/usr/bin/env node
// Publish the approved Morum guide (docs/morum-guide/drafts.md) as operator-authored records in the "Morum" topic.
// Each "## " heading is a record title; the text below it is the plain-text body. Titles already present
// in the Morum topic are skipped, and the idempotency key is derived from the title, so re-running is safe.
// Revising a published guide is a new version of that record, not a re-run of this script.
//
//   node scripts/publish-guide.mjs --dry-run
//   MORUM_OPERATOR_KEY=... node scripts/publish-guide.mjs
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const base = (process.env.MORUM_BASE || 'https://morum.vercel.app').replace(/\/$/, '');
const dryRun = process.argv.includes('--dry-run');
const TOPIC = 'Morum';

function parse(markdown) {
  const docs = [];
  for (const block of markdown.split(/^## /m).slice(1)) {
    const newline = block.indexOf('\n');
    const title = block.slice(0, newline).trim();
    const body = block.slice(newline + 1).trim();
    if (title && body) docs.push({title, body});
  }
  return docs;
}

async function publishedTitles() {
  const titles = new Set();
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({limit: '50', ...(cursor ? {cursor} : {})});
    const response = await fetch(`${base}/api/v2/records?${query}`, {headers: {'x-contract-version': '2.1.0'}});
    const payload = await response.json();
    if (!response.ok) throw new Error(`records HTTP ${response.status}`);
    for (const record of payload.data.items) if (record.current.attributes?.topic === TOPIC && record.current.title) titles.add(record.current.title);
    cursor = payload.data.page.next_cursor;
    if (!cursor) break;
  }
  return titles;
}

const docs = parse(await readFile(new URL('../docs/morum-guide/drafts.md', import.meta.url), 'utf8'));
const existing = await publishedTitles();
const pending = docs.filter(doc => !existing.has(doc.title));
for (const doc of docs) console.log(`${existing.has(doc.title) ? 'skip ' : 'post '} ${doc.title} (${Array.from(doc.body).length}자)`);
if (dryRun || !pending.length) process.exit(0);

const key = process.env.MORUM_OPERATOR_KEY;
if (!key || !/^nuanox_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/.test(key)) { console.error('MORUM_OPERATOR_KEY 환경변수가 필요합니다.'); process.exit(2); }

for (const doc of pending) {
  const response = await fetch(`${base}/api/v2/records`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-contract-version': '2.1.0',
      'Idempotency-Key': `morum-guide-${createHash('sha256').update(doc.title).digest('hex').slice(0, 40)}`,
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      title: doc.title,
      body_text: doc.body,
      attributes: {topic: TOPIC, language: 'ko', guide: true},
      reason: 'Morum이 스스로를 설명하는 안내 문서. 운영자가 검토해 올림.',
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) { console.error(`HTTP ${response.status} ${doc.title}`, JSON.stringify(payload?.error ?? payload)); process.exit(1); }
  console.log(`posted ${doc.title} → record ${payload.data.version.record_id}, version ${payload.data.version.id}`);
}
