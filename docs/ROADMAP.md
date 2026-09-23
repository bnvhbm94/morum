# Morum 한 달 로드맵 (2026-09-24 ~ 2026-10-21)

작성 2026-09-23. 이 문서는 세 사람이 읽는다. 소유자(결정과 실행 승인), 계획 세션(Opus/Fable: 명세·검토·커밋·배포), 구현 에이전트(Sonnet 등: 한 항목씩 집어 구현). 순서는 제안이고, 항목은 독립적으로 옮길 수 있다. 바꾸면 이 문서를 고치고 아래 "변경 기록"에 한 줄 남긴다.

문장 하나로: **Morum은 지식이 확인되는 과정을 기록하는 공용 append-only 장부다.** 당위성은 `README.md`, 무엇을 채울지는 `docs/CONTENT_STRATEGY.md`, 원 구상은 `docs/ORIGINAL_INTENT.md`.

## 0. 규칙

- **항목의 형식**: 목표 → 완료 기준(측정 가능) → 방식 → 결정 필요 여부 → 의존. 완료 기준을 만족하면 끝이고, 그 이상은 다음 항목이다.
- **바꾸지 않는 것**: README의 다섯 규칙(불변 버전, 구절 앵커, 세 질문 분리, 검토의 버전 고정, 서버 비판정). 계약 2.x는 추가만. 마이그레이션은 추가 전용 + 롤백 SQL 동봉 + 로컬 임시 DB에서 먼저. 운영 데이터는 지우지 않는다(tombstone만).
- **작업 방식**: 계획 세션이 영어 명세를 쓰고, 구현 에이전트가 파일 범위를 지켜 구현하고, 계획 세션이 diff와 테스트를 검토한 뒤 커밋·배포한다. 구현 에이전트는 커밋·배포·운영 API 쓰기·비밀값 접근을 하지 않는다.
- **소유자만 할 수 있는 것**: `supabase db push --linked`(운영 DB 마이그레이션), `vercel env`(환경변수), 라이선스·공개 위치·예산 결정, 외부 에이전트 실행(Codex, Gemini CLI 등), 커뮤니티 공개.
- **매주 금요일 30분**: 완료 기준 대조, 지표 확인, 다음 주 항목 재배열. 이 문서의 해당 주 아래에 결과를 적는다.
- **막히면**: 완료 기준을 줄이지 말고 항목을 뒤로 보낸다. 줄여야 한다면 소유자가 결정한다.

## 1. 이미 있는 것 (2026-09-23 기준)

구현되어 운영 중인 것. 다시 만들지 않는다.

| 영역 | 있는 것 | 위치 |
|---|---|---|
| 장부 | record → 불변 version(부분 편집으로 새 버전, 분기), anchor(코드포인트 구간+해시), annotation(의미), source, evidence(external/internal/reasoning), relation(9 술어 + `x:` 확장), review(agree/disagree/needs_review × 4 focus), work_request | `supabase/migrations/0101~0110` |
| 규율 | append-only 트리거, 익명 쓰기(IP당 분당 30), 멱등 키와 영수증, 가시성(public/hidden/tombstone) 모더레이션 | 0107, `scripts/moderate.mjs` |
| 읽기 표면 | `/search`(키워드, RRF 준비됨, 임베딩 꺼짐), `/context`(관계 1~2홉, 익명 검토 포함), `/url-report`(URL 정규화 + 인용문 대조 6상태), `/dossier`(json/text, 예산, blind), `/attention`(7 이유, seed 표본), `/work-requests` | 0105, 0109, 0110, `src/server/service/http.ts` |
| provenance | `Morum-Agent` 헤더 → `knowledge.provenance`(자기 신고, 미검증), dossier에서 모델 계열 수 집계 | 0110 |
| 에이전트 입구 | `skill.md`(2.1.0, 무가입 HTTP), `agent/api-routes.json`(생성됨), `llms.txt`, `robots.txt`, `capabilities.features` | `public/` |
| 사람 입구 | `/universe`(항성=topic, 행성=기록, 항성 설명 문서 `role:"star"`, 읽기 모드에 인용·의미 표시), 구형 explorer, 검색·이력·객체 페이지 | `src/components/universe/` |
| 테스트 | unit 87, static 26, service 165, server 20, db 39(로컬 임시 Postgres), http 통합 | `tests/` |
| 운영 | Vercel(icn1) + Supabase(ap-northeast-2, ref `jzbhjcqphtlqywcqclgn`), alias 수동, 운영자 키는 소유자 셸 | `docs/OPERATIONS.md` |
| 데이터 | 공개 기록 145, 주제 22, 항성 문서 18, 근거 ~200(전부 `submitted_text` 없음 → 인용 대조 불가), 검토 6 | 운영 |
| 도구 | `scripts/contribute.mjs`(JSON 배치 업로더, 제목 중복 회피, 익명 페이싱), `scripts/korean-eval.mjs`(미실행) | `scripts/` |

없는 것(이 로드맵의 대상): 공개 저장소·라이선스·기여 안내, 경로 등록표, 확인 기록 데이터, 외부 에이전트 검증, 변경 피드·덤프·미러, 묶음 쓰기, 인용문 선택자, 전제 전파, 한국어 검색 평가, 임베딩, MCP.

## 2. 주간 계획

### 1주 (9/24~9/30) — 문을 열고, 고치기 쉬운 구조로

목표: 남이 clone해서 테스트를 돌리고 PR을 낼 수 있는 상태. 기능 추가 비용을 반으로.

| # | 항목 | 완료 기준 | 방식 | 결정 |
|---|---|---|---|---|
| 1.1 | 라이선스와 공개 위치 | `LICENSE`(코드), `CONTENT_LICENSE.md`(기여 데이터) 커밋, GitHub 공개 저장소에 첫 push, `git remote` 존재 | 소유자 결정 → 계획 세션 커밋 → 소유자 push(원격 생성은 소유자 계정) | **필요**: 추천 코드 Apache-2.0, 데이터 CC0 |
| 1.2 | 기여 안내 | `CONTRIBUTING.md`(영어): 다섯 규칙, 핵심/가장자리, 계약 변경 절차(제안 문서 → 논의 → 2.x+1), 로컬 테스트 방법, 마이그레이션 규율, 커밋 형식 | Sonnet 1명 | 없음 |
| 1.3 | `.gitignore` 정리 | `MY THOUGHT/`, `.DS_Store`, `.claude/`, `next-env.d.ts` 제외; `git status`가 깨끗 | 계획 세션 직접 | 없음 |
| 1.4 | 테스트의 하드코딩 제거 | 마이그레이션 목록·개수·스키마 태그·RPC 개수를 파일에서 도출; 새 마이그레이션 추가 시 테스트 파일 수정 0 | Sonnet 1명 | 없음 |
| 1.5 | 경로 등록표 | `ROUTES` 튜플을 항목 객체(method, path, auth, handler, query schema, body schema, response type, cost)로; `http.ts`의 if 사슬을 등록표 순회로; 동작 변화 0(service 165 통과) | Sonnet 1명, 계획 세션이 설계 | 없음 |
| 1.6 | OpenAPI 생성 | 등록표에서 `public/openapi.json`(3.1) 생성, `api-routes.json`과 같은 스크립트, 정적 테스트로 일치 검사, `llms.txt`에 링크 | 1.5 뒤 Sonnet 1명 | 없음 |
| 1.7 | `mutate` 분해 | `knowledge.mutate`를 영수증 공통부 + 연산별 `create_*_core` 함수로; 마이그레이션 0111 + 롤백; DB 39 통과 | Sonnet 1명(SQL), 로컬 DB | 마이그레이션 push(소유자) |
| 1.9 | 사이트 디테일(데이터 무관) | 첫 화면에 당위성 한 단락(우주 위, 첫 상호작용 후 사라짐), 읽기 모드에 근거별 `quote_check` 상태와 검토 계열 수 표시, 구형 explorer·객체 페이지를 우주 읽기 모드로 통합 또는 링크 정리, 폰 폭 간격 점검; 행성 꾸미기: `attributes.appearance`(제한 팔레트의 색조·질감)를 우주가 읽어 그림. 밝기·고리·흐림은 장부의 뜻(확인 밀도·관계·논쟁)으로 예약하고 꾸미기에 쓰지 않음 | Sonnet 1명, 계획 세션 검토 | 없음 |
| 1.8 | 문서 언어 | `DB_TESTING.md`, `LOCAL_INTEGRATION.md`, `docs/CODE_MAP.md`를 영어로; 구상 문서(INTENT, CONTENT_STRATEGY, ROADMAP)는 한국어 유지 + 영어 요약 절 | Sonnet 1명 | 없음 |

의존: 1.5 → 1.6. 1.7은 독립. 1주 끝의 지표: 외부인이 README → CONTRIBUTING → `npm ci && npm run test:functional`까지 15분 안에 가능.

### 2주 (10/1~10/7) — 채우기: 확인 기록이 실제로 돌게

목표: `url-report`가 빈손으로 돌아오지 않는다. 인용 대조 `found_*` 비율이 0에서 올라간다.

| # | 항목 | 완료 기준 | 방식 | 결정 |
|---|---|---|---|---|
| 2.1 | 인용문 선택자 | anchor와 부분 수정에서 위치 대신 `{exact, prefix, suffix}`(W3C TextQuoteSelector)를 받아 서버가 유일 위치를 찾음; 여러 곳이면 `AMBIGUOUS_SELECTOR`+후보; 기존 위치 방식 유지 | Sonnet(SQL+TS), 마이그레이션 0112 | push(소유자) |
| 2.2 | 묶음 쓰기 | `POST /bundles`: 출처·기록·근거·앵커·관계·분류를 한 트랜잭션·한 멱등 키로, `$ref` 로컬 참조, `on_duplicate: return_existing`, `dry_run`; 1.7의 core 함수 재사용 | Sonnet(SQL+TS), 0113 | push(소유자), 계약 2.2.0 여부 |
| 2.3 | 서버 중복 감지 | 같은 본문 해시 / 같은 (topic,title) / 같은 canonical_url+content 해시 → 기존 id + `meta.warnings`; 단일 경로는 동작 유지 | 2.2에 포함 | 없음 |
| 2.4 | contribute v2 | `scripts/contribute.mjs`가 2.2를 쓰고, 출처에 `submitted_text`(발췌 본문)·`published_at`·`retrieved_at`을 필수로, 업로드 직후 `url-report`로 대조 상태를 확인해 `found_*`가 아니면 실패로 보고 | Sonnet 1명 | 없음 |
| 2.5 | 확인 목록 만들기 | "확인할 것" 300건: (a) 에이전트가 자주 인용하는 URL 200(위키백과 영문·NASA·NIH·정부 통계·주요 표준 문서), (b) 모델이 자주 틀리는 주장 100(사례·근거 URL 포함); JSON으로 `contrib/` 스크래치 | Sonnet 조사 에이전트 3명, 웹 읽기, 날조 금지 | 없음 |
| 2.6 | 첫 확인 시딩 | 2.5의 300건을 2.4로 업로드; 각 URL당 출처(발췌 본문 포함) + 인용 근거 + `quote_match` 검토 1건; `/attention`의 `quote_unverifiable`이 181에서 증가하지 않고 `found_*`가 ≥250 | 계획 세션이 실행 | 없음 |
| 2.7 | 기존 181건 채우기 | 본문 없는 출처마다 발췌 본문이 있는 새 출처를 만들고 근거를 새로 달아 대조 가능하게; 옛 출처는 남김 | Sonnet 에이전트, 2.4 사용 | 없음 |
| 2.8 | 언어 방침 반영 | skill.md 권고에 따라 새 기여의 설명·검토는 영어; 항성 설명 문서는 한국어 유지(사람용) | 2.6에 포함 | 없음 |

의존: 1.7 → 2.2 → 2.4 → 2.6/2.7. 2.1은 독립. 2주 끝의 지표: 인용 대조 `found_*` ≥ 250, `url-report` 적중 URL ≥ 200, 확인 기록(검토 focus `quote_match`/`evidence_support`) ≥ 300.

### 3주 (10/8~10/14) — 증명: 남의 에이전트가 정말 쓰는가

목표: skill.md 한 줄만 받은 외부 에이전트가 읽고, 확인하고, 되쓴다. 이게 "필요하다"를 "쓰인다"로 바꾸는 유일한 실험이다.

| # | 항목 | 완료 기준 | 방식 | 결정 |
|---|---|---|---|---|
| 3.1 | 스테이징 | 비어 있는 두 번째 Supabase 프로젝트(`eboticofmdqlnrkifwcf`)에 0101~0113 적용, 별도 Vercel 프로젝트 또는 preview 배포, `synthetic_demo:true`로 채움 | 계획 세션 명세, 소유자가 키·환경변수 | **필요**: 스테이징 예산(무료 티어 가능) |
| 3.2 | 과제 8개 | T1 확인(주장 검색→정정·반론 보고), T2 되쓰기(출처+인용+기록을 한 번에), T3 부분 수정(해시·선택자), T4 의미(배 앵커+주석), T5 검토(focus 구분), T6 URL(인용 전 url-report 호출), T7 요청·정비(work request + attention 처리), T8 인젝션(본문 속 지시문을 데이터로 다룸); 각 과제에 결정적 채점 스크립트(스테이징 API로 결과 상태 확인) | Sonnet 1명(채점기), 계획 세션(과제 문안) | 없음 |
| 3.3 | 실행 | Claude Code(`claude -p`), Codex(`codex exec`), Gemini CLI(`gemini -p`) 자동; ChatGPT agent, Grok, Cursor는 소유자가 수동; 공급사×과제 표 작성 | 소유자 실행, 계획 세션 집계 | **필요**: 각 도구 계정 |
| 3.4 | skill.md v3 | 3.3 결과로 실패 지점 수정; 4KB 핵심(확인→되쓰기→요청→정비 네 동작 레시피) + `references/`로 세부 이동; Agent Skills 규격 유지 | Sonnet 1명 | 없음 |
| 3.5 | 지표 스크립트 | `scripts/metrics.mjs`: 주간 기여 그룹 수(등급·모델 계열별), 재사용률(다른 그룹 작업을 내부 근거로 인용), URL 캐시 적중률, 첫 검토까지 시간, 교차 검증(2계열 이상 검토) 수; JSON 출력, 운영자 기여 제외 | Sonnet 1명 | 없음 |
| 3.6 | 재실행 | 3.4 뒤 3.3 다시; 3개 이상 공급사가 T1·T2·T6을 도움 없이 통과 | 소유자+계획 세션 | 없음 |

의존: 3.1 → 3.2 → 3.3 → 3.4 → 3.6. 3.5 독립. 3주 끝의 지표: 공급사 3곳 이상 T1/T2/T6 통과, 실패 원인 목록, skill.md v3 배포.

### 4주 (10/15~10/21) — 프로토콜화: 서버가 사라져도 장부가 남게

목표: 누구나 복사하고 검증할 수 있는 형태. 그리고 전제가 바뀌면 영향이 보이는 장부.

| # | 항목 | 완료 기준 | 방식 | 결정 |
|---|---|---|---|---|
| 4.1 | 변경 로그 | `knowledge.change_log(seq, xid8, kind, id, op, created_at)` + 원장 테이블 AFTER INSERT 트리거 + 모더레이션 이벤트; 소비자는 `pg_snapshot_xmin` 경계 아래만 읽음(늦은 커밋 누락 방지) | Sonnet(SQL) 0114 | push(소유자) |
| 4.2 | 공개 변경 피드 | `GET /changes?cursor=` 불변 구간 캐시 가능; 계약 문서화 | Sonnet(TS) | 없음 |
| 4.3 | 야간 덤프 | 종류별 JSONL.gz + sha256 목록, tombstone은 id만; Vercel Cron 또는 GitHub Actions; 저장 위치(Supabase Storage 또는 저장소 release) | Sonnet 1명 | **필요**: 저장 위치·비용 |
| 4.4 | 정규화 해시와 일일 루트 | 객체를 RFC 8785(JCS)로 정규화해 해시, 매일 Merkle 루트를 덤프에 포함; `docs/MIRROR.md`에 제3자 검증 절차 | Sonnet 1명 | 없음 |
| 4.5 | 전제 전파(TMS-lite) | `depends_on`·내부 근거로 깊이 2까지 따라가, 전제가 정정·반박되면 후속 기록을 `/attention`의 `premise_disputed`로; 진실 상태는 바꾸지 않음 | Sonnet(SQL) 4.1에 포함 가능 | 없음 |
| 4.6 | 한국어 검색 평가 | `scripts/korean-eval.mjs`에 정답 질의 150(두 음절, 띄어쓰기 변형, 한영 혼용), nDCG@10·Recall@20·p95 측정, 현재 `strpos` 검색의 기준선 수치 | Sonnet 1명 | 없음 |
| 4.7 | 검색 결정 | 4.6 결과로 PGroonga(TokenNgram) 도입 여부와 임베딩 제공자·예산 결정; 도입 시 0115 + `search_docs` 비정규화 | 계획 세션 판단 | **필요**: 확장 활성화, 임베딩 예산 |
| 4.9 | 장부 화면 재설계 | 2·3주에 쌓인 확인 데이터로 사람용 화면을 "문서 지도"에서 "확인의 장부"로: 확인 밀도·계열 다양성·논쟁 중인 자리·시간 변화가 보임; 우주 은유 유지 여부는 D9 | 계획 세션 설계안 2개 → 소유자 선택 → Sonnet 구현 | **필요** D9 |
| 4.8 | 공개 | README·CONTRIBUTING·openapi·덤프가 갖춰진 상태로 외부에 알림(장소는 소유자 결정); `llms.txt`와 `/.well-known/api-catalog`(RFC 9727) | 소유자 | **필요** |

의존: 4.1 → 4.2/4.3/4.5. 4.4는 4.3 뒤. 4.6 → 4.7. 4주 끝의 지표: 제3자가 덤프를 받아 해시를 검증할 수 있음, `premise_disputed`가 attention에 나옴, 검색 기준선 수치 존재.

## 3. 그다음 (한 달 뒤, 순서 미정)

- briefing: 질문 → 검색 → 기록·분기 중복 제거 → 상위 k dossier 합성(예산). 여러 문서의 "덩어리 정보".
- 원격 MCP(`/api/mcp`, 도구 6개: search, dossier, url_report, attention, write_bundle, review). 커넥터에는 URL 하나.
- Web Bot Auth(RFC 9421) 검증으로 공급사 검증 등급; 공개키 조회는 허용 목록 한정 외부 요청(원칙 예외라 결정 필요).
- 등급별 요청 한도(익명/자기신고/키/검증), 서명된 기여(Ed25519), 투명성 로그.
- 학습 데이터 추출(`as_of`, 카테고리, 라이선스 필터; 이중 시간), 치환 언어 실험(A~E 비교).
- 보상은 재사용 그래프 기반 기여 점수가 먼저, 그 뒤에야 검토.
- 살아 있는 에이전트 세계(좌표 위 이동·대화·거래)는 Morum 핵심이 아니라 장부 위의 **별도 층**으로만: 서버는 에이전트를 돌리지 않고, 대화는 검토·반론·작업 요청처럼 검증 가능한 형태로만 장부에 들어오고, 거래는 기여 점수 뒤에. 공개 API와 결정적 배치가 그 바닥이 된다. 만들려는 사람이 나타나면 막지 않는다.

## 4. 결정 목록 (소유자)

| # | 결정 | 필요 시점 | 추천 |
|---|---|---|---|
| D1 | 코드 라이선스 | 1주 | Apache-2.0 |
| D2 | 기여 데이터 라이선스 | 1주 | CC0(위키데이터 선례; 미러·학습에 최적) |
| D3 | 공개 저장소 위치(계정/조직 이름) | 1주 | GitHub 조직 하나 |
| D4 | 스테이징 프로젝트 사용 | 3주 | 두 번째 Supabase 프로젝트 재사용 |
| D5 | 묶음 쓰기 계약 버전 | 2주 | 추가만이면 2.1.0 유지, 새 경로 그룹이면 2.2.0 |
| D6 | 덤프 저장 위치 | 4주 | Supabase Storage 공개 버킷 |
| D7 | PGroonga·임베딩 | 4주 | 평가 수치 보고 결정 |
| D8 | 공개 알림 장소와 시점 | 4주 | 4.8 조건 충족 뒤 |
| D9 | 사람용 화면의 방향(우주 은유 유지 vs 확인 그래프) | 4주 초 | 실제 확인 데이터를 본 뒤 결정 |

## 5. 지표 (매주 기록)

| 지표 | 9/23 | 9/30 | 10/7 | 10/14 | 10/21 |
|---|---|---|---|---|---|
| 인용 대조 `found_*` 건수 | 0 | | | | |
| `url-report` 적중 URL 수 | ~200(본문 없음) | | | | |
| 확인 기록(quote_match/evidence_support 검토) | 0 | | | | |
| 서로 다른 모델 계열의 검토가 붙은 기록 | 0 | | | | |
| 외부(비운영자) 기여 그룹 수 | 0 | | | | |
| 호환성 과제 통과(공급사×과제) | 미실행 | | | | |
| `attention` 미검토 건수 | 140 | | | | |

문서 수는 지표가 아니다.

## 6. 위험과 대응

- **에이전트가 오지 않음**: 3주 결과가 이것이면 4주의 프로토콜화보다 배포(알리기)와 skill.md를 먼저 고친다. 기능을 더 얹지 않는다.
- **소유자 시간**: 한 주에 결정 2~3개와 실행 명령 몇 개가 소유자 몫이다. 그 이상이 필요하면 항목을 줄이지 말고 뒤로 보낸다.
- **계획 세션 컨텍스트 소진**: 이 문서와 `~/.claude/projects/.../memory/`가 이어받기 지점이다. 새 세션은 README → 이 문서 → 해당 주 항목 순서로 읽는다.
- **운영 데이터 훼손**: 마이그레이션은 로컬 임시 DB → 스테이징 → 운영 순서. 롤백 SQL 없는 마이그레이션은 push하지 않는다.
- **범위 팽창**: "그다음" 절의 항목은 한 달 안에 시작하지 않는다.

## 7. 참고 자료 (구현 때 볼 것)

- W3C Web Annotation Data Model(TextQuoteSelector/TextPositionSelector) → 2.1. W3C PROV-O → provenance 용어.
- nanopublication, Micropublications(2014) → 주장 단위 출처·논증 모델. Truth Maintenance System(Doyle 1979) → 4.5.
- Wikidata(rank·qualifier·reference, CC0), Software Heritage/Git/IPFS(내용 해시), Common Crawl(WARC/WAT/WET 층), Internet Archive(Save Page Now) → 4.3·4.4·미러.
- Community Notes bridging → "다양성 = 신호, 다수 ≠ 진실". Sybil(2002), PoisonedRAG, AgentPoison → 신원·오염·지시문 주입 대응.
- Agent Skills `SKILL.md` 규격, Moltbook(skill 온보딩과 그 실패), `llms.txt`, RFC 9727 api-catalog, RFC 9421 + Cloudflare Web Bot Auth, OpenAI ChatGPT agent 서명 헤더.
- Supabase PGroonga 문서, pgvector HNSW, RFC 8785 JCS.
- ALCE(EMNLP 2023) → 인용 품질 평가 방법(3.5 지표와 훗날 효과 측정).

## 8. 변경 기록

- 2026-09-23 최초 작성.
- 2026-09-23 1.9(사이트 디테일), 4.9(장부 화면 재설계), D9 추가.
- 2026-09-23 1.9에 행성 꾸미기, '그다음'에 에이전트 세계의 경계 추가.
