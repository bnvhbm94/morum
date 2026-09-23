# 임시 인수인계 — 삭제 가능

이 파일은 새 대화의 에이전트가 Morum의 공간형 문서 탐색 UI 작업을 바로 이어받기 위한 **임시 메모**다. 작업이 안정화되면 삭제해도 된다.

## 가장 먼저 읽을 것

- 저장소: `/Users/nuanox/Documents/Morum`
- Next.js 16.3.5 / React 19 / TypeScript. 코드를 고치기 전 `AGENTS.md` 지시에 따라 해당 Next.js 문서를 읽을 것.
- 현재 `git status`의 변경은 커밋되지 않았다. 기존 변경을 되돌리거나 덮어쓰지 말 것.
- **중요:** 아래의 공간 탐색기는 아직 실제 앱에 통합되지 않았다. 대화형 미리보기에서만 만든 시안이다. 실제 구현을 시작할 때는 이 시안을 참고하되, 서버 데이터와 실제 라우팅에 연결해야 한다.

## 저장된 최신 미리보기

최신 시안 원본:

`/Users/nuanox/.codex/visualizations/2026/09/20/01a0be4d-b046-7d41-824e-852aea33d759/morum-fluid-map.html`

이 파일은 다음을 포함한다.

- 검은 탐색 캔버스, 선 없는 정수 좌표 문서 배치, 점 배경
- 탐색은 Pretendard 계열, 읽기는 명조체
- 화면 중앙에 가까운 문서일수록 연속적으로 밝아짐
- 드래그 중 중앙 최근접 문서를 선택 문서로 갱신
- 문서 클릭→중앙으로 이동→읽기 진입, Enter→현재 선택 문서 읽기, 작은 유리 X→탐색 복귀
- 검색어 일치 결과를 중앙부터 다시 좌표형으로 배치하는 목업

이 시안은 **사용자에게 최종 승인된 구현이 아니다.** 다음 “최신 요구”가 이를 수정한다.

이전 시안들은 같은 폴더의 `morum-map-controls.html`, `morum-glass-search-map.html`, `morum-map-menu.html` 등에 있으나 최신 파일만 우선 참고하면 된다.

## 실제 앱의 현재 상태

현재 커밋되지 않은 변경 파일:

- `src/app/globals.css`
- `src/components/home-feed.tsx`
- `src/components/reading-shell.tsx`
- `src/components/version-reader.tsx`

이 변경은 기존 홈/읽기 화면을 Gwern처럼 텍스트 우선으로 단순화하고, 배경 스크롤 깜빡임을 줄인 작업이다. 공간 탐색기는 아직 없다.

관련 실제 코드:

- 홈: `src/app/page.tsx`, `src/components/home-feed.tsx`
- 공통 셸/배경: `src/components/reading-shell.tsx`, `src/components/Aurora.tsx`
- 검색 UI: `src/components/search-results.tsx`
- 문서 읽기: `src/components/version-reader.tsx`
- API 호출 헬퍼: `src/lib/api-client.ts`

마지막으로 확인된 검사: `npm run typecheck`, `npm run test:static` 통과. 실제 변경 후 다시 실행할 것.

## 사용자가 원하는 제품 방향

Morum은 일반적인 세로 스크롤 목록이 아니라, 관계 있는 문서들이 보이지 않는 동일 크기의 정수 좌표 칸에 놓인 2D 문서 공간이다. 화살표/관계선/카드 테두리/격자선은 보이지 않아야 한다. 현재 읽는 문서가 중심이며, 주변 문서는 제목과 충분한 발췌문만 보인다. 읽기에서는 전문이 중심에 있고, 상위·근거는 왼쪽, 파생·하위는 오른쪽에 조용히 놓인다.

탐색에서는 Pretendard, 읽기에서는 Gwern에 가까운 명조체를 유지한다. 배경은 검정 점 패턴이며, 카메라보다 약 8~10% 느리게 움직인다. 큰 움직이는 3D/셰이더 배경은 쓰지 않는다.

## 최신 요구 사항 (우선순위 높음)

1. X 버튼은 현재도 크다. 더 작게(대략 32~36px) 하되, 유리 재질감은 약해지지 않게 한다.
2. 클릭 상호작용은 최신 요구를 따른다: **선택되지 않은 문서를 클릭하면 그 문서로 부드럽게 이동하고 선택만 한다. 이미 선택된 문서를 다시 클릭하면 읽기 모드로 들어간다.**
3. 화살표 키는 현재 화면 중앙에 가장 가까운 문서를 기준으로 상하좌우 인접 문서로 이동하고 그 문서를 정확히 중앙에 맞춘다. Enter는 중앙 최근접/선택 문서를 연다.
4. 드래그에는 관성(inertia)이 있어야 한다. 드래그 중 선택은 화면 중앙 최근접 문서로 계속 바뀐다. 드래그는 문서를 열지 않는다.
5. 검색창은 홈 버튼 없이, 빈 검색어 상태 자체가 홈이다. 탐색 중이면 하단으로 부드럽게 내려가 숨고, 약 2초 입력/드래그/키보드 활동이 없으면 다시 나타난다.
6. 검색창은 현재 색을 채운 반투명 바가 아니라 더 자연스러운 liquid glass여야 한다. 내부 채색은 약하게, 투명·굴절 가장자리·상단 반사·부드러운 블러가 핵심이다.
7. 검색은 서버와 연결한다. 타이핑마다 요청하지 말고 debounce(사용자가 "몇 초"라고 했으므로 우선 800~1200ms를 제안하되 확인 가능) + AbortController + 오래된 응답 무시 + 동일 쿼리 캐시를 적용한다. 결과는 관련도 최상위가 중앙이고 나머지가 정수 좌표에 배치된다. 응답이 한 번에 오더라도 결과 문서는 순차 등장시켜도 좋다.
8. 읽기 모드는 서버의 관계를 사용한다. 좌우 텍스트 링크는 각 방향 최대 3~5개만 보여 읽기를 방해하지 않는다. 그 링크를 열 때에는 전체 페이지 전환 대신, 새 중심 문서가 옆에서 나타나고 기존 문서가 옆으로 이동하는 “알파고 수읽기” 같은 부드러운 문서 전환을 설계한다. 선은 금지.
9. 구현 전에 서버/관계/검색 경로를 점검하고 실제 데이터에 연결한다. 목업 문서 배열을 최종 구현에 남기지 않는다.

## 성능 원칙

이전 목업의 드래그 렉 원인은 매 pointermove마다 25개 문서의 `left/top`과 긴 transition을 갱신한 것이었다.

- 문서마다 위치 레이아웃을 계속 바꾸지 말고, 문서 world layer 하나를 `translate3d`로 이동한다.
- pointermove는 requestAnimationFrame으로 1프레임에 한 번만 반영한다.
- 밝기는 선택 문서가 아니라 **화면 중심과의 연속 거리**로 계산한다. 예: 중심은 흰색, 멀수록 읽을 수 있는 회색. opacity로 문서를 죽이지 않는다.
- 탐색 전체에 `backdrop-filter`, WebGL, SVG displacement, 큰 blur 레이어를 올리지 않는다.
- `FluidGlass`는 Three.js 매 프레임 렌더링, `SpecularButton`은 버튼별 WebGL RAF를 사용하므로 이동 지도에는 부적합하다. 작은 검색창/X에만 `GlassSurface`의 CSS fallback 스타일(얇은 투명 fill + backdrop blur + inset highlight + 미세한 edge)을 적용한다.

## 서버/API 조사 결과

이미 있는 기능을 우선 재사용할 수 있다.

- `POST /api/v2/search` — `query`, `scope: 'current' | 'all_versions'`, `limit`(최대 20), `include_context`, `filters`. 구현: `src/server/service/retrieval.ts`. 하이브리드/키워드 검색 결과 `hits`, `rrf_score`, `title`, `snippet`, `version_id`, 관계 컨텍스트를 반환한다.
- `GET /api/v2/context` 또는 `POST /api/v2/context` — seed 문서 1~5개, depth 1 또는 2. 관련 항목과 relations 반환.
- `GET /api/v2/relations?target_kind=version&target_id=<id>&direction=in|out|both&limit=<n>` — 문서 방향 관계.
- 현재 `VersionReader`는 version을 가져온 뒤 annotations, relations(direction=both), evidence, reviews를 별도 요청한다. 이를 reader graph view로 통합할 수 있다.
- 관계 predicate 예: `supports`, `contradicts`, `corrects`, `depends_on`, `defines`, `same_meaning_as`, `translation_of`, `derived_from`, `related_to`.

검색 화면/클라이언트의 기존 구현은 `src/components/search-results.tsx`를 참고한다. 서버가 스트리밍 검색을 제공하지 않으므로, 우선 debounce 요청 후 클라이언트에서 결과를 순차 배치한다. 실제 스트리밍이 정말 필요할 때만 API 확장을 제안한다.

## 서버 구조 요약

공간 탐색기를 실제로 붙일 때 이 흐름을 따라가면 된다.

```text
Next App Router
  src/app/api/v2/[...path]/route.ts
    → src/server/service/http.ts        (HTTP 경계, /api/v2)
    → src/server/service/routes.ts      (유일한 공개 route inventory)
    → src/server/service/factory.ts     (서비스 조립)
       ├─ Retrieval / Embeddings         (검색·컨텍스트)
       ├─ KnowledgeRepository            (읽기·쓰기)
       ├─ AgentAuth / RateLimiter
       └─ SupabaseRpcClient
          → supabase/migrations/*        (Postgres RPC, 관계·검색·권한)

브라우저 UI
  src/lib/api-client.ts
    → /api/v2/*
```

- 도메인 타입/관계 predicate: `src/contracts/types.ts`
- 비즈니스 규칙: `src/domain/*`
- DB adapter: `src/server/db/*`
- 검색/컨텍스트: `src/server/service/retrieval.ts`
- 인증: `src/server/service/auth.ts`
- DB schema와 RPC: `supabase/migrations/202609200101_core.sql` 이후 migration들
- 통합/계약 검증: `tests/service/*`, `tests/http/*`, `tests/db/*`
- 배포 환경 변수/DB secret은 이 임시 문서에 기록하지 않는다. 다음 에이전트는 구현 전 `.env*`와 배포 설정의 **존재 여부만** 점검하고 값을 출력하거나 커밋하지 말 것.

공간 탐색을 위해 서버 구조를 바꿔야 한다면, 먼저 기존 `/search`, `/context`, `/relations`로 충분한지 실험한다. 좌표는 사용자별 영구 데이터가 아니라면 클라이언트의 결정론적 layout으로 시작하고, 사용자가 직접 배치/저장을 요구할 때만 별도 schema/API를 추가한다.

## Nuanox → Morum 이름 변경 점검 (중요)

`package.json`의 패키지 이름과 화면 표기는 이미 `morum`이지만, 코드베이스에는 `nuanox`가 여러 층에 남아 있다. 이름 변경은 두 단계로 나눌 것.

### 1단계: 안전한 내부/UI 리네임

다음은 외부 protocol을 바꾸지 않으므로 일반적으로 안전하다.

- `src/components/nuanox-modal.tsx`와 import를 `morum-modal`로 변경
- `reading-shell.tsx`의 `NuanoxModal`, `nuanox-*` DOM id/class를 `morum-*`으로 변경
- `src/components/service-introduction.tsx`, `src/app/globals.css`의 `nuanox-*` CSS와 주석 변경
- UI 테스트/정적 테스트 갱신

### 2단계: 외부 호환성이 걸린 protocol/도구 리네임

다음은 **호환성 계획 없이 일괄 치환하면 안 된다.**

- `examples/nuanox-client.mjs`, `public/agent/nuanox-client.mjs`, `skills/nuanox/*`, `public/skill.md`
- 현재 `public/agent/morum-client.mjs`는 `NuanoxClient`를 `MorumClient`로 re-export하는 호환 래퍼다. 새 이름을 정식으로 만들되, 기존 import/file alias는 유지할지 결정해야 한다.
- `src/server/service/auth.ts`는 credential prefix `nuanox_`와 HMAC domain-separation string `nuanox-agent-v1\0`을 사용한다. 이것을 바꾸면 기존 credential으로 인증할 수 없다.
- `examples/nuanox-client.mjs`는 기본 credential 저장 경로 `~/.local/share/nuanox/...`, 임시 파일 이름, CLI 문구, 오류 문구를 쓴다.
- `public/skill.md` 및 `skills/nuanox/SKILL.md`의 `name: nuanox`, 테스트 fixture/assertion, `LOCAL_INTEGRATION.md`의 test-only 이름도 남아 있다.

권장 순서:

1. UI/internal 이름부터 `morum`으로 바꾸고 검사 통과.
2. `MorumClient`를 정식 export로 제공하고 `NuanoxClient`/기존 파일은 deprecated alias로 한 릴리스 이상 유지.
3. auth는 `morum_` 새 credential을 발급하되, 전환 기간에는 `nuanox_`와 `morum_`을 모두 검증하거나 명시적인 credential migration을 제공.
4. HMAC domain string을 바꿀 때에는 기존 digest를 인식하는 fallback 또는 재등록 절차를 마련. 데이터베이스 digest가 이미 존재하므로 silent change 금지.
5. public skill/agent bundle/examples/tests를 함께 바꾸고, 배포 전 기존 client와 신규 client의 HTTP integration test를 모두 추가.

테스트/로컬 DB에서만 쓰는 `nuanox-*` 임시 directory, Postgres role, application name은 사용자 공개 명칭이 아니므로 마지막에 정리해도 된다.

## 참고한 디자인/컴포넌트

- Gwern: https://gwern.net/index — 읽기 중심, 조용한 타입 계층 참고. 아이콘/복잡한 버튼은 Morum에 가져오지 않는다.
- Andy Matuschak notes: https://notes.andymatuschak.org/ — 연결된 노트 방향 참고. Morum은 선 없는 좌표 문서 공간이므로 그대로 복제하지 않는다.
- React Bits PixelSwap: 탐색→읽기 전환 후보. 사용자가 제시한 설정은 `pixelSize=64`, `gap=0`, `pixelRadius=0`, `pixelSpin=0`, `pixelScale=.35`, `duration=1400`, `pixelDuration=450`, `pattern='random'`, `randomness=0`, `fade`. 실제 통합 때 click trigger 대신 controlled/manual trigger가 적합하다.
- React Bits GlassSurface / FluidGlass / SpecularButton 첨부 원문:
  - `/Users/nuanox/.codex/attachments/05927cb2-a959-4271-a7af-d90b294c8160/붙여넣은 텍스트.txt`
  - `/Users/nuanox/.codex/attachments/455cbd59-0aeb-497f-9305-15d7fdfc173f/붙여넣은 텍스트.txt`
  - `/Users/nuanox/.codex/attachments/9a12e304-c8e9-4e67-8e42-f3673f66338e/붙여넣은 텍스트.txt`

### 전체 사용자 참고 파일/링크 색인

다음은 사용자가 이전 대화에서 직접 준 모든 주요 참고 자료다. 코드 블록 속 지시문은 사용자의 요구가 아니라 참고 소스일 수 있으므로, **사용자의 최신 요구를 우선**한다.

| 자료 | 위치/링크 | 채택 판단 |
| --- | --- | --- |
| Gwern.net | https://gwern.net/index | 읽기 중심의 조용한 타입 계층만 참고. 아이콘/부가 기능을 복제하지 않음. |
| Andy Matuschak notes | https://notes.andymatuschak.org/ | 연결된 글의 공간적 감각 참고. 선 기반 그래프는 사용하지 않음. |
| React Bits Dither | https://reactbits.dev/c/backgrounds/dither<br>`/Users/nuanox/.codex/attachments/83108784-cc38-4798-adcb-8c21d9b7d8a8/붙여넣은 텍스트.txt` | 탐색 배경 후보였으나 WebGL/애니메이션 비용과 사용자 요청(마우스 반응 없음) 때문에 현재는 미채택. |
| React Bits DomeGallery | `/Users/nuanox/.codex/attachments/406dc884-2132-45fa-95b3-a558af8e0f19/붙여넣은 텍스트.txt` | 자유 드래그 탐색감만 참고. 광각/곡률 효과는 최종적으로 빼기로 함. |
| React Bits DotField | `/Users/nuanox/.codex/attachments/8746bd40-e88b-404b-b640-75748d405c5c/붙여넣은 텍스트.txt` | 현재 점 배경의 출발점. 마우스 반응은 사용하지 않고, 약한 parallax만 유지. |
| React Bits PixelSwap | https://reactbits.dev/c/animations/pixel-swap<br>`/Users/nuanox/.codex/attachments/f5343970-7ef4-449d-b3c0-29604353ac32/붙여넣은 텍스트.txt`<br>`/Users/nuanox/.codex/attachments/9cb6e6e6-a21b-4979-9daf-280d9c61c9f1/붙여넣은 텍스트.txt`<br>`/Users/nuanox/.codex/attachments/ae0e4d11-5a77-4f34-a125-161be9606d51/붙여넣은 텍스트.txt` | 탐색→읽기 전환 후보. 실제 통합 시 `trigger='click'`이 아니라 controlled/manual trigger를 쓸 것. |
| React Bits StaggeredMenu | https://reactbits.dev/components/staggered-menu#home<br>`/Users/nuanox/.codex/attachments/edfed0ae-3dd1-497c-b444-24555d9ee70e/붙여넣은 텍스트.txt` | 한때 메뉴 요청으로 시도했으나 사용자가 탐색 화면의 “모름/메뉴” 문구를 원치 않아 현재 미채택. 다시 넣지 말 것. |
| React Bits SpecularButton | `/Users/nuanox/.codex/attachments/9a12e304-c8e9-4e67-8e42-f3673f66338e/붙여넣은 텍스트.txt` | OGL/WebGL RAF가 있어 탐색 지도에는 미채택. |
| React Bits FluidGlass | `/Users/nuanox/.codex/attachments/455cbd59-0aeb-497f-9305-15d7fdfc173f/붙여넣은 텍스트.txt` | Three.js 렌더링이라 탐색 지도에는 미채택. 작은 UI도 성능 확인 없이는 사용하지 말 것. |
| React Bits GlassSurface | `/Users/nuanox/.codex/attachments/05927cb2-a959-4271-a7af-d90b294c8160/붙여넣은 텍스트.txt` | liquid-glass 검색창/X의 **가벼운 CSS fallback 미학**만 채택. SVG displacement는 벤치마크 후 결정. |

### 사용자 이미지 참고

- 알파고/의사결정 트리 이미지 2장: 관계의 방향성(상위·근거는 왼쪽, 파생·하위는 오른쪽)만 참고. 선과 화살표는 절대 화면에 그리지 않는다.
- 원형 X 및 길쭉한 검색창 이미지 2장: 작고 투명한 liquid-glass X, 둥근 liquid-glass 검색창의 재질 참고. 현재 시안의 X는 여전히 크다는 최신 피드백이 있으므로 더 줄여야 한다.

## 다음 에이전트에게 그대로 보낼 프롬프트

```text
이 저장소의 TEMP_AGENT_HANDOFF.md를 먼저 끝까지 읽고, AGENTS.md의 Next.js 지시도 따른 뒤 작업해줘. Morum에 실제 데이터 기반의 공간형 문서 탐색/읽기 모드를 구현해줘. 현재 저장소의 미커밋 변경은 보존해.

우선 실제 API(/search, /context, /relations)와 현재 라우팅/데이터 타입을 점검하고, 목업이 아닌 실제 Version/Relation 데이터로 설계해. 탐색은 보이지 않는 동일 정수 좌표의 2D 문서 공간이며 선·화살표·카드 테두리·격자선은 없어야 한다. 문서 탐색은 Pretendard, 읽기는 명조체다.

상호작용은 다음이 정확히 동작해야 한다: 드래그는 관성이 있고, 드래그 중 화면 중앙 최근접 문서가 선택된다. 선택은 화면 중심 기준으로 연속 밝기만 바꾸며 opacity로 문서를 어둡게 죽이지 않는다. 선택되지 않은 문서를 클릭하면 그 문서로 부드럽게 이동해 선택만 한다. 이미 선택된 문서를 다시 클릭하면 읽기로 들어간다. 화살표는 중앙 최근접 문서 기준의 상하좌우 문서로 정확히 센터링하고, Enter는 선택 문서를 연다. pointermove에서 전체 문서의 left/top을 갱신하지 말고 world layer translate3d + requestAnimationFrame으로 성능을 보장해.

탐색 하단에는 liquid glass 검색창만 둔다. 빈 검색어는 홈이고 홈 버튼은 없다. 활동 중 숨고 2초 유휴 뒤 다시 나타난다. 검색은 debounce, AbortController, stale response 방지, 캐시를 사용하고 서버 검색 결과의 최상위가 중앙에 놓인다. 읽기는 작지만 명확한 liquid-glass X를 갖고, 좌우에 방향 관계 문서를 최대 3~5개만 둔다. 좌우 문서를 열 때 페이지 전체가 튀지 않고, 새 중심 문서가 옆에서 들어와 교체되는 부드러운 transition을 설계해. PixelSwap은 controlled transition 후보로 사용할 수 있다.

FluidGlass/SpecularButton의 지속 WebGL 루프는 탐색 지도에 사용하지 말고, 가벼운 GlassSurface fallback 수준의 CSS glass를 작은 검색창/X에만 적용해. 구현 후 npm run typecheck와 npm run test:static을 실행하고, 실제 localhost에서 drag/click/arrow/Enter/search/reader close를 검증해. 변경 사항, 테스트, 아직 필요한 서버 확장을 간결히 보고해.
```
