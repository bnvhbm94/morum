# 기록 정체성을 서버에서 떼어 내기: 내용 해시, 서명, 외부 존재 증명

작성 2026-09-25. 상태: 설계 메모, 미승인. 외부 검토(2026-09-24~25 대화록)의 제안을 현재 구조와 계약 2.1.0에 맞춰 옮긴 것이다. 로드맵 4.4(정규화 해시와 일일 서명 루트)를 대체하지 않고 그 앞 단계와 뒷 단계를 잇는다.

## 문제

기록이 서버에 의존하는 것이 셋이다.

1. 정체성: 판·앵커·출처·근거·검토·관계의 ID가 Postgres가 발급한 UUID다. 다른 서버에 복사되면 같은 기록임을 증명할 수 없다.
2. 작성자: `created_by`와 `declared`는 서버가 받아 적은 자기 신고다.
3. 존재 증명: "이 기록이 이 시각에 있었다"는 morum.vercel.app이 살아 있는 동안만 성립한다.

셋을 떼어 내면 서버가 하나여도 기록은 네트워크 준비 상태가 된다. 지금 바꾸는 것이 마이그레이션 하나이고, 기록이 쌓인 뒤에는 사실상 못 바꾼다. 특히 정규화 규칙은 한 번 정하면 되돌릴 수 없다.

## 지킬 것

- 계약 2.1.0을 깨지 않는다. UUID는 그대로 두고 필드를 **추가**만 한다. 밖으로 나가는 참조에 해시를 나란히 붙인다.
- 서버는 판정하지 않는다. 해시와 서명은 검증 가능성을 더할 뿐, 서명 없는 기록을 거부하지 않는다.
- append-only. 기존 행의 해시는 backfill로 채우되 값은 계산 결과이므로 "수정"이 아니다.

## 1단계: 내용 해시 `content_hash` (마이그레이션 하나, 하루)

### 정규화 대상

객체마다 **정체성 필드만** 모아 JSON 하나로 만들고 RFC 8785(JCS)로 정규화해 sha256을 취한다. 서버가 붙이는 것(UUID, created_at, 가시성, 집계값)은 넣지 않는다. 그래야 다른 서버가 같은 내용을 받으면 같은 해시가 나온다.

| 객체 | 정체성 필드 |
|---|---|
| version | `type:"version"`, `record_content_hash`, `parent_version_content_hash|null`, `title`, `body_text`, `body_sha256`, `language|null`, `temporal_scope|null`, `attributes`(JCS) |
| record | `type:"record"`, `kind`, `attributes`, `first_version_body_sha256` |
| anchor | `type:"anchor"`, `version_content_hash`, `selector{exact,prefix,suffix}`(0112 선택자; 오프셋은 넣지 않음, 텍스트만) |
| source | `type:"source"`, `canonical_url|null`(0115 규칙 결과), `submitted_text_sha256|null`, `published_at|null`, `retrieved_at|null` |
| evidence | `type:"evidence"`, `target{type,content_hash}`, `basis{kind, source_content_hash|source_ref_content_hash, quote|null, explanation}` |
| review | `type:"review"`, `target{type,content_hash}`, `focus`, `stance`, `reason`, `on{exact,start,end}|null` |
| relation | `type:"relation"`, `from{type,content_hash}`, `to{type,content_hash}`, `predicate`, `explanation`, `attributes` |

원칙: 참조는 UUID가 아니라 **대상의 content_hash**로 적는다. 그래야 해시가 서버를 넘어 유효하다. 같은 내용을 같은 대상에 두 번 쓰면 같은 해시가 나오는데, 이것은 결함이 아니라 중복 탐지다(UUID는 여전히 다르다).

### 형식

`sha256:` 접두 없이 64자 소문자 hex. DTO에 `content_hash` 필드를 추가하고, `kb_get_*`과 dossier·url-report에 노출한다. 검증 절차(정체성 필드 → JCS → sha256)를 `docs/MIRROR.md`에 적고 `npm run verify:hash <json>` 스크립트를 둔다. 계약 테스트에 고정 벡터(입력 JSON → 기대 해시) 10개를 넣는다.

### 구현

- 마이그레이션 0117: 7개 테이블에 `content_hash text` 열(NULL 허용) + 부분 유니크 아님(중복 허용) 인덱스. JCS는 SQL로 안전하게 구현하기 어려우므로 **해시는 서버(TypeScript, npm `canonicalize`)가 계산해 RPC 인자로 넘기고**, DB는 저장만 한다. DB 테스트는 서버가 계산한 값과 고정 벡터가 일치하는지 확인한다.
- backfill: `scripts/backfill-content-hash.mjs`가 기존 행을 읽어 계산·저장(운영자 키, 배치 500). 결과 수를 로드맵 change-log에 적는다.
- 순서 의존: 참조가 content_hash라서 부모(record, version, source)부터 채운다.

## 2단계: 작성자 서명 (필드만 먼저, 검증은 나중)

- 모든 쓰기에 선택 헤더 `Morum-Signature: ed25519=<base64>; key=<url-or-fingerprint>` 를 받는다. 서명 대상은 1단계의 정규화 JSON(정체성 필드) 바이트다. 즉 서명은 `content_hash`가 가리키는 바로 그 내용에 붙는다.
- 저장: `signature`, `signer_key_ref` 두 열. 1단계 마이그레이션에 같이 넣어도 된다(비어 있어도 무해).
- 검증: 당장은 하지 않는다. 표시만 "서명 있음(미검증)". 키 체계는 IETF Web Bot Auth(RFC 9421 HTTP Message Signatures + `/.well-known/http-message-signatures-directory`)가 굳는 것을 보고 정한다. 그 전까지 자체 `nuanox_` 키는 그대로 두되 새 기능을 얹지 않는다.
- 결과: 익명 기록은 "이 서버가 받았다"만 증명하고, 서명 기록은 어느 복제본에서든 작성자가 증명되는 두 등급이 된다. 어느 등급도 거부되지 않는다.

## 3단계: 외부 존재 증명 (스크립트 하나, 운영 비용 0)

- 하루 한 번 그날 생성된 객체의 `content_hash`를 정렬해 머클 루트를 만들고, 루트를 (a) 저장소의 `public/log/YYYY-MM-DD.json`에 서명과 함께 발행하고 (b) Sigstore Rekor 공개 로그에 올린다(hashedrekord). Rekor는 운영이 아니라 이용이라 인프라가 없다.
- 로드맵 4.4의 타일 기반 투명성 로그는 이것의 상위 형태다. 3단계는 4.4 전에 두는 값싼 다리이고, 4.4가 되면 Rekor 항목은 보조 증거로 남는다.
- 검증: `docs/MIRROR.md`에 "덤프의 한 줄 → content_hash 재계산 → 그날 루트 포함 증명 → Rekor 항목" 4단계를 적는다.

## 하지 않을 것

토큰, 블록체인 운영, DHT, 연합 프로토콜. 두 번째 운영자가 나타나기 전에는 노드가 하나다. 위 세 단계는 노드가 하나여도 기록을 네트워크 준비 상태로 두는 최소 작업이다.

## 결정 요청

1. 정규화 대상 표(위)를 확정한다. 특히 `attributes`를 정체성에 넣을지(넣으면 꾸밈 변경도 다른 기록이 된다; 판은 불변이므로 문제 없음).
2. 1단계를 이번 주에 할지. 기록 수백 건인 지금이 backfill이 가장 싸다.
3. 2단계 헤더 이름과 알고리즘(ed25519 고정 추천).

## 참고

RFC 8785 JCS · Nostr NIP-01(이벤트 ID = 정규화 JSON의 sha256, 릴레이는 저장만) · nanopublication Trusty URI · Sigstore Rekor hashedrekord · IETF Web Bot Auth 초안 · 로드맵 4.4의 tlog 설계.
