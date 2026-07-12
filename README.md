# AI-Core Mobile

데스크톱 앱 [AI-Core](../paper-manager-work)의 **모바일/태블릿용 앱**입니다.
개인·지인 공유용(비상업)이며, 기기별 설치 형태는 다음과 같습니다.

| 기기 | 설치 형태 |
| --- | --- |
| 안드로이드 폰 / 갤럭시탭 | **APK 파일 설치** (`npm run apk`로 생성해 파일 공유) |
| 아이폰 / 아이패드 | Safari **홈 화면에 추가** (애플 정책상 개발자계정 없이는 유일한 방법이며, 설치하면 아이콘·전체화면·오프라인 모두 일반 앱과 동일) |

데스크톱 앱과 같은 React + pdf.js 스택, 같은 테마(라이트/다크, 종이 톤),
같은 데이터 모델(논문·컬렉션·태그·주석·읽기 상태)을 사용합니다. 모든 데이터는
기기의 저장소(IndexedDB)에만 저장되는 로컬 우선 구조로, 서버로 나가는 데이터가
없습니다.

## 주요 기능

- PDF 가져오기(여러 개 동시 선택), 문서 메타데이터와 첫 페이지 레이아웃 분석을
  이용한 제목·저자 자동 추출 (데스크톱 앱과 동일한 휴리스틱)
- 터치 최적화 PDF 리더
  - 두 손가락 핀치 확대·축소(0.5×–4×, 확대 중심 유지), 상단 바 확대/축소 버튼
  - 화면 주변 페이지만 렌더링하는 긴 PDF 가상화
  - 마지막 읽던 위치 자동 저장·복원, 페이지 표시·직접 이동
- 텍스트를 길게 눌러 선택하면 나타나는 주석 도구: 6색 형광펜·밑줄, 메모, 복사
- 주석 목록(선택 문장·메모 미리보기)에서 해당 위치로 바로 이동, 주석 탭하여
  색·형식·메모 수정 및 삭제
- 리더 안 PDF 본문 검색(결과 문맥 미리보기 + 페이지 이동)
- 중첩 컬렉션(생성·이름 변경·삭제), 태그, 제목·저자·메모 검색
- **Google Drive / Notion 동기화** — 데스크톱 AI-Core와 같은 Drive 폴더·Notion
  데이터베이스를 사용해 PDF·주석·컬렉션·태그·읽던 위치를 기기 간 공유
  (아래 "데스크톱과 라이브러리 동기화" 참고)
- 라이브러리 전체 백업 ZIP 내보내기/가져오기(설정 → 백업) — PDF·주석·컬렉션·
  태그·읽기 상태 포함, 다른 기기에서 가져오면 병합
- 태블릿/데스크톱 브라우저에서 PDF 드래그&드롭 가져오기
- 반응형 레이아웃: 폰은 하단 탭 내비게이션, 태블릿(가로 768px 이상)은
  컬렉션 사이드바 + 라이브러리 2단 구성
- 라이트/다크 테마(시스템 연동), PDF 종이 톤(기본/따뜻하게/세피아/다크)
- 오프라인 지원(서비스 워커), 영구 저장(persistent storage) 요청으로
  브라우저의 저장소 정리로부터 라이브러리 보호

## 개발 실행

요구 사항: Node.js 22.13 이상.

```bash
npm install
npm run dev        # LAN에 열림(--host) → 폰/태블릿에서 http://<PC IP>:5173 접속
```

타입 검사, 프로덕션 빌드, E2E 스모크 테스트:

```bash
npm run build      # typecheck + vite build → dist/
npm run test:e2e   # 헤드리스 Chrome으로 가져오기→리더→위치복원→검색 검증
npm run check      # 위 전부 한 번에
npm run preview    # 빌드 결과물 미리보기 (--host)
```

E2E 테스트는 `google-chrome`이 PATH에 있어야 하며, `tests/fixture.pdf`
(3쪽 샘플)를 실제 앱 흐름 그대로 가져와 제목 자동 추출, 페이지 렌더링,
읽던 위치 저장·복원, 본문 검색까지 확인합니다.

같은 Wi-Fi에 있는 기기에서 `http://<PC의 IP>:5173`으로 바로 테스트할 수
있습니다. 단, **PWA 설치와 서비스 워커(오프라인)는 HTTPS에서만** 동작합니다
(localhost 제외). 실제 설치까지 테스트하려면 아래처럼 배포하세요.

## 안드로이드 APK 만들기·설치하기

```bash
npm run apk        # 웹 빌드 → Capacitor 동기화 → 서명된 APK 생성
# → releases/AI-Core-Mobile.apk
```

만들어진 `releases/AI-Core-Mobile.apk` 파일을 카카오톡·드라이브 등으로
지인에게 보내면 됩니다. 받는 사람은:

1. APK 파일을 탭 → "출처를 알 수 없는 앱 설치" 허용(1회) → 설치
2. 이후 새 버전 APK를 받으면 같은 방식으로 덮어서 설치(데이터 유지)

빌드 요구사항(이 PC에는 이미 설치되어 있습니다):

- JDK 21 — `~/tools/jdk-21*` (스크립트가 자동 감지, 다른 경로면 `JAVA_HOME` 지정)
- Android SDK — `~/Android/Sdk` (다른 경로면 `ANDROID_HOME` 지정)

서명 키는 `android/release.keystore`(자체 서명)이며, 저장소가 공개될 수 있어
**git에는 포함되지 않습니다**(없으면 빌드 스크립트가 자동 생성). **이 파일을
잃어버리면 기존 설치 위에 업데이트를 덮을 수 없으니 별도로 백업해 두세요.**
Play 스토어 배포용이 아니므로 키 관리는 이 정도면 충분합니다. 새 버전을 낼
때는 `android/app/build.gradle`의 `versionCode`를 1씩 올리세요.

## 아이폰/아이패드 배포 (홈 화면 추가)

iOS는 애플 정책상 APK 같은 파일 설치가 없고, IPA 사이드로딩은 macOS + Xcode +
Apple Developer 계정($99/년)이 필요합니다. **개발자 계정 없이 지인에게
배포하는 유일한 방법은 아래처럼 HTTPS 주소를 공유하고 "홈 화면에 추가"로
설치하게 하는 것**이며, 설치 후에는 아이콘·전체화면·오프라인 동작까지 일반
앱과 동일합니다.

정적 파일만 서빙하면 되므로 어떤 정적 호스팅이든 사용할 수 있습니다.
빌드하면 서비스 워커에 에셋 목록이 자동 주입되어, 설치 직후부터 완전
오프라인으로 동작합니다.

```bash
npm run build      # typecheck + vite build + SW 프리캐시 주입 → dist/
```

### 방법 1 — GitHub Pages (자동 배포, 권장)

`.github/workflows/deploy-pages.yml`이 이미 들어 있습니다.

1. GitHub에 새 저장소를 만들고 이 폴더를 push
   ```bash
   git remote add origin git@github.com:<계정>/<저장소>.git
   git push -u origin main
   ```
2. 저장소 **Settings → Pages → Source**를 **GitHub Actions**로 선택
3. push할 때마다 자동으로 `https://<계정>.github.io/<저장소>/`에 배포됩니다.
   워크플로가 저장소 이름으로 `BASE_PATH`를 잡아주므로 서브경로에서도
   PWA 설치·오프라인이 정상 동작합니다(검증됨).

### 방법 2 — Cloudflare Pages / Netlify / Vercel

`dist/`를 업로드하거나 저장소를 연결하면 끝. 빌드 명령 `npm run build`,
출력 디렉터리 `dist`. 루트 도메인으로 서빙되므로 추가 설정이 없습니다.

### 방법 3 — 자체 서버 / 연구실 LAN

- nginx 등으로 `dist/` 서빙 + Let's Encrypt HTTPS
- LAN 전용이면 [Tailscale](https://tailscale.com) + `tailscale serve`로
  HTTPS를 붙이는 방법이 간단합니다.

서브경로에 배포한다면 `BASE_PATH=/경로/ npm run build`로 빌드하세요.

### 지인 외 접근 막기 (접근 코드, 선택)

웹 주소는 아는 사람이면 누구나 열 수 있으므로, 원하면 간단한 접근 코드를
걸 수 있습니다. 코드를 모르면 첫 화면에서 막힙니다.

- GitHub Pages: 저장소 **Settings → Secrets and variables → Actions**에
  `ACCESS_CODE` 시크릿을 만들면 다음 배포부터 적용됩니다.
- 직접 빌드: `VITE_ACCESS_CODE=원하는코드 npm run build`

접근 코드는 번들에 포함되는 가벼운 잠금장치이지 보안 수단은 아닙니다.
어차피 라이브러리 데이터는 각자 기기에만 있어서, 주소가 새어나가도 남의
데이터가 보이는 일은 없습니다. APK에는 설치 파일 자체가 관문이므로 접근
코드가 적용되지 않습니다(기본 빌드 기준).

### 앱 아이콘 바꾸기

현재 아이콘은 데스크톱 앱과 같은 기본 아이콘입니다. 원하는 512×512 PNG로
`public/icons/icon-512.png`를 교체한 뒤 아래를 실행하면 192px·마스커블·
애플터치 아이콘이 전부 다시 생성됩니다.

```bash
npm run icons
```

## 기기별 설치 방법 정리

| 기기 | 방법 |
| --- | --- |
| 안드로이드 폰 / 갤럭시탭 | 공유받은 **APK 파일 설치** (권장) 또는 Chrome ⋮ → 앱 설치 |
| 아이폰 / 아이패드 | Safari로 배포 주소 접속 → 공유 ↑ → **홈 화면에 추가** |

둘 다 설치 후에는 주소창 없는 전체 화면 앱으로 실행되고, 오프라인에서도
라이브러리를 열 수 있습니다.

### 지원 브라우저

ES2022 + pdf.js 4.x 기준으로 **iOS/iPadOS 16.4 이상, Android Chrome /
Samsung Internet 최신 버전**을 지원합니다. 그보다 오래된 기기는 화면이
뜨지 않을 수 있습니다.

### iOS/iPadOS 주의 사항

- iOS의 웹 저장소는 해당 웹앱을 **7일간 전혀 사용하지 않으면** 삭제될 수
  있습니다(홈 화면에 설치한 PWA는 예외로 유지됩니다). 반드시 홈 화면에
  설치해서 사용하세요.
- 설정 → 저장 공간 섹션에서 "영구 저장 요청"을 눌러 두면 안드로이드/데스크톱
  브라우저에서도 저장소가 보호됩니다.

## 데스크톱 앱과의 관계

- `../paper-manager-work`(Electron 데스크톱 앱)를 **참고만** 하며, 코드를
  공유하거나 수정하지 않습니다.
- 테마 팔레트(`src/styles/theme.css`)와 PDF 메타데이터 추출 휴리스틱
  (`src/pdf/metadata.ts`)은 데스크톱 앱에서 포팅했습니다.
- 데이터 모델(논문/컬렉션/태그/주석 rect/읽기 상태)은 데스크톱 SQLite 스키마와
  1:1로 대응하도록 설계되어, 이후 Google Drive 동기화를 붙이면 데스크톱과
  라이브러리를 공유할 수 있습니다.

## 데스크톱과 라이브러리 동기화

설정 → 동기화에서 켭니다. 원격 저장 형식(Drive의 `PaperManager/{pdfs,meta}`
폴더, Notion의 "AI-Core Papers" 데이터베이스, 청크 PDF 포맷)이 데스크톱 앱과
동일해서 **데스크톱 ↔ 폰 ↔ 태블릿이 하나의 라이브러리를 공유**합니다.
충돌은 데스크톱과 같은 논문 단위 최종-수정-우선(LWW)으로 처리하고, 편집 후
5초 디바운스로 업로드하며 앱 시작 시와 "지금 동기화" 버튼으로 내려받습니다.

| | 브라우저/PWA (아이폰·아이패드 포함) | 안드로이드 APK |
| --- | --- | --- |
| Google Drive | ✅ | ❌ (웹뷰에서 Google 로그인 차단 — Chrome PWA 사용) |
| Notion | ✅ (프록시 필요) | ✅ (프록시 필요) |

### Google Drive 설정

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials)에서
   **데스크톱 앱과 같은 프로젝트**에 OAuth 클라이언트 ID를 하나 더 만듭니다.
   유형: **웹 애플리케이션**, "승인된 JavaScript 원본"에 배포 주소
   (예: `https://<계정>.github.io`)를 추가합니다.
   - 같은 프로젝트여야 하는 이유: `drive.file` 권한은 "같은 앱(프로젝트)이
     만든 파일"만 보이기 때문입니다. 다른 프로젝트면 데스크톱이 올린 파일이
     안 보입니다.
2. 설정 → 동기화 → Drive에 클라이언트 ID를 붙여넣고 **Google 로그인**.
3. 브라우저 토큰은 1시간짜리라 세션이 오래 끊기면 "다시 로그인" 안내가 뜰 수
   있습니다(데이터는 안전하며, 로그인하면 이어서 동기화됩니다).

### Notion 설정

Notion API는 브라우저 호출을 차단(CORS)하므로 얇은 중계 서버가 필요합니다.
[workers/notion-proxy.js](workers/notion-proxy.js)를 Cloudflare Workers 무료
플랜에 한 번 배포하면 됩니다 (토큰을 저장하지 않는 무상태 전달자입니다):

```bash
npx wrangler login
npx wrangler deploy workers/notion-proxy.js --name aicore-notion-proxy \
  --compatibility-date 2026-07-01
```

출력된 `https://aicore-notion-proxy.<계정>.workers.dev` 주소를 설정 → 동기화 →
Notion의 "프록시 URL"에 넣고, 데스크톱에서 쓰던 통합 토큰과 부모 페이지 ID를
입력한 뒤 **저장 & 연결 테스트**를 누릅니다.

> ⚠️ 동기화 코드는 데스크톱 구현을 그대로 포팅했고 형식 호환은 유닛 테스트로
> 검증했지만, 실제 Google/Notion 계정과의 종단 간 동작은 본인 계정으로 처음
> 연결할 때 확인이 필요합니다. 처음 켤 때는 백업(설정 → 백업)을 먼저 받아두길
> 권장합니다.

## 라이선스

개인·비상업 용도 전용입니다([LICENSE](LICENSE)). 지인 간 공유(APK 파일·접속
링크 전달)는 허용되며, 그 외 재배포·상업적 이용은 허용되지 않습니다.

## iOS 네이티브 앱이 필요해지면

Capacitor 안드로이드 프로젝트(`android/`)는 이미 포함되어 있습니다. iOS도
네이티브로 만들려면 macOS + Xcode + Apple Developer 계정을 준비한 뒤:

```bash
npm install @capacitor/ios
npx cap add ios
npm run build && npx cap sync ios   # 이후 Xcode에서 서명·빌드
```

웹 코드는 수정 없이 그대로 사용됩니다.

## 로드맵 (데스크톱 기능 중 미이식)

- 선택 즉시 번역(Google Translate/DeepL/Ollama/LibreTranslate) — 브라우저
  CORS 제약으로 프록시 서버 또는 Capacitor 네이티브 HTTP가 필요
- 번역 결과 동기화(데스크톱의 translation snapshot) — 지금은 덮어쓰지 않고
  보존만 합니다
- APK에서 Google Drive 로그인(네이티브 Google Sign-In 플러그인 필요)
- 검색 결과의 글자 단위 하이라이트, 참고문헌 링크 이동, Figure/Table 미리보기
