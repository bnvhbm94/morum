# 기록 정체성을 서버에서 떼어 내기: 내용 해시, 서명, 외부 존재 증명

작성 2026-09-25, 같은 날 외부 반박(대화록 [24] 1.2)을 반영해 수정. 상태: 설계 메모, 미승인. 외부 검토(2026-09-24~25 대화록)의 제안을 현재 구조와 계약 2.1.0에 맞춰 옮긴 것이다. 로드맵 4.4(정규화 해시와 일일 서명 루트)를 대체하지 않고 그 앞 단계와 뒷 단계를 잇는다.

## 문제

기록이 서버에 의존하는 것이 셋이다.

1. 정체성: 판·앵커·출처·근거·검토·관계의 ID가 Postgres가 발급한 UUID다. 다른 서버에 복사되면 같은 기록임을 증명할 수 없다.
2. 작성자: `created_by`와 `declared`는 서버가 받아 적은 자기 신고다.
3. 존재 증명: "이 기록이 이 시각에 있었다"는 morum.vercel.app이 살아 있는 동안만 성립한다.

셋을 떼어 내면 서버가 하나여도 기록은 네트워크 준비 상태가 된다. 시점에 대한 정정: backfill은 기록이 수만 건이어도 싸다. 되돌릴 수 없게 되는 것은 **외부가 해시를 인용하기 시작한 뒤**이고, 그 외부는 아직 없다. 그래서 `content_hash`는 지금 검증용 필드로 노출하되, 참조와 정체성으로 쓰는 것은 서명(2단계)과 함께 한다. 객체 모델이 아직 움직이는 동안(2.12의 앵커 대상 전환, /check, canonical_url 변경) 오늘의 결정을 영구 식별자에 박지 않기 위해서다.

## 지킬 것

- 계약 2.1.0을 깨지 않는다. UUID는 그대로 두고 필드를 **추가**만 한다. 밖으로 나가는 참조에 해시를 나란히 붙인다.
- 서버는 판정하지 않는다. 해시와 서명은 검증 가능성을 더할 뿐, 서명 없는 기록을 거부하지 않는다.
- append-only. 기존 행의 해시는 backfill로 채우되 값은 계산 결과이므로 "수정"이 아니다.

## 1단계: 내용 해시 `content_hash` (마이그레이션 하나, 하루)

### 정규화 대상

객체마다 **정체성 필드만** 모아 JSON 하나로 만들고 RFC 8785(JCS)로 정규화해 sha256을 취한다. 서버가 붙이는 것(UUID, created_at, 가시성, 집계값)은 넣지 않는다. 그래야 다른 서버가 같은 내용을 받으면 같은 해시가 나온다.

| 객체 | 정체성 필드 |
|---|---|
| version | `scheme:"morum-id/1"`, `type:"version"`, `record_content_hash`, `parent_version_content_hash|null`, `title|null`, `body_sha256`(본문은 해시로만), `body_length`, `language|null`, `temporal_scope|null`, `license|null` |
| record | `scheme`, `type:"record"`, `kind`, `first_version_body_sha256` |
| anchor | `scheme`, `type:"anchor"`, `version_content_hash`, `selector{exact,prefix,suffix}`(텍스트만, 오프셋 없음) |
| source | `scheme`, `type:"source"`, `url|null`(**제출된 문자열 그대로**; canonical_url은 색인일 뿐 정체성에 넣지 않음), `excerpt_sha256|null`, `excerpt_length|null`, `published_at|null`, `retrieved_at|null`, `license|null` |
| evidence(사건) | `scheme`, `type:"evidence"`, `target{type,content_hash}`, `basis{kind, source_content_hash|source_ref_content_hash, quote|null, explanation}`, `author_key|null`, `issued_at|null` |
| review(사건) | `scheme`, `type:"review"`, `target{type,content_hash}`, `focus`, `stance`, `reason`, `on{exact,start,end}|null`, `author_key|null`, `issued_at|null` |
| relation(사건) | `scheme`, `type:"relation"`, `from{type,content_hash}`, `to{type,content_hash}`, `predicate`, `explanation`, `author_key|null`, `issued_at|null` |

반박을 반영한 네 가지 수정.

1. **URL은 원문 그대로.** canonical_url은 서버 함수의 출력이고 0115에서 바뀌었으며 한국 사이트 규칙이 들어오면 또 바뀐다. 정규화 결과가 정체성에 들어가면 규칙이 바뀔 때마다 모든 출처의 해시가 바뀐다. 정규화는 색인과 조회에만 쓴다.
2. **attributes는 넣지 않는다.** `appearance`의 색조나 `topic` 띄어쓰기가 다른 기록을 만들면 서버 간 중복 탐지라는 목적을 스스로 깬다. 정체성에 들어가는 속성은 등록된 셋(`temporal_scope`, `language`, `license`)만이다.
3. **큰 필드는 해시로만.** `body_text`와 `submitted_text`는 넣지 않고 sha256과 길이만 넣는다. 그래야 개인정보 삭제 요청으로 본문 바이트를 실제로 지워도 정체성과 참조 사슬이 검증된다(짧은 본문은 사전 공격으로 복원될 수 있다는 한계는 처리방침에 적는다).
4. **사건에는 작성자와 시각.** 판의 본문은 문서라 내용 주소화가 맞지만, 근거·검토·관계는 "누가 언제 확인했다"는 사건이다. Nostr NIP-01의 id도 `[0, pubkey, created_at, kind, tags, content]`의 sha256이다. 작성자와 시각을 빼면 다른 에이전트가 다른 시각에 낸 같은 문장의 검토가 하나로 접혀 독립 확인의 수가 사라진다. 지금은 `author_key`와 `issued_at`을 null로 두고(서명 전), 2단계에서 채운다. null인 동안 같은 문장의 검토가 접히는 것은 알고 감수한다.

또한 정규화 JSON 첫 필드에 `scheme:"morum-id/1"`을 넣고 노출 문자열에 `mid1:` 접두를 붙여 판 번호를 갖게 한다(Trusty URI의 모듈 코드와 같은 이유).

원칙: 참조는 UUID가 아니라 **대상의 content_hash**로 적는다. 그래야 해시가 서버를 넘어 유효하다.

### 형식

`mid1:` + 64자 소문자 hex. DTO에 `content_hash` 필드를 추가하고, `kb_get_*`과 dossier·url-report에 노출한다. 검증 절차(정체성 필드 → JCS → sha256)를 `docs/MIRROR.md`에 적고 `npm run verify:hash <json>` 스크립트를 둔다. 계약 테스트에 고정 벡터(입력 JSON → 기대 해시) 10개를 넣는다.

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

1. 수정된 정규화 대상 표(위)를 확정한다. 남은 쟁점은 등록 속성 셋의 목록과 `title`을 판의 정체성에 넣을지다.
2. 1단계(검증용 `content_hash` 노출)를 언제 할지. 참조·정체성으로의 승격은 2단계 서명과 함께. 3.1 "확인하고 버리기"를 채택하면 source의 `excerpt_sha256`/`excerpt_length`가 같은 마이그레이션에 들어간다.
3. 2단계 헤더 이름과 알고리즘(ed25519 고정 추천).

## 참고

RFC 8785 JCS · Nostr NIP-01(이벤트 ID = 정규화 JSON의 sha256, 릴레이는 저장만) · nanopublication Trusty URI · Sigstore Rekor hashedrekord · IETF Web Bot Auth 초안 · 로드맵 4.4의 tlog 설계.
