# AI-Core Mobile

데스크톱 앱 [AI-Core](../paper-manager-work)의 **모바일/태블릿용 PWA**(설치형 웹앱)입니다.
안드로이드 폰, 아이폰, 갤럭시탭, 아이패드에서 모두 동작하며, 브라우저의
"홈 화면에 추가"로 일반 앱처럼 설치해 전체 화면으로 사용할 수 있습니다.

데스크톱 앱과 같은 React + pdf.js 스택, 같은 테마(라이트/다크, 종이 톤),
같은 데이터 모델(논문·컬렉션·태그·주석·읽기 상태)을 사용합니다. 모든 데이터는
기기의 브라우저 저장소(IndexedDB)에만 저장되는 로컬 우선 구조입니다.

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

## 배포 (HTTPS)

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

### 앱 아이콘 바꾸기

현재 아이콘은 데스크톱 앱과 같은 기본 아이콘입니다. 원하는 512×512 PNG로
`public/icons/icon-512.png`를 교체한 뒤 아래를 실행하면 192px·마스커블·
애플터치 아이콘이 전부 다시 생성됩니다.

```bash
npm run icons
```

## 기기별 설치 방법

| 기기 | 브라우저 | 설치 |
| --- | --- | --- |
| 안드로이드 폰 / 갤럭시탭 | Chrome | 주소창 메뉴 ⋮ → **앱 설치** (또는 "홈 화면에 추가") |
| 갤럭시 (삼성 인터넷) | Samsung Internet | 메뉴 → **현재 페이지 추가** → 홈 화면 |
| 아이폰 / 아이패드 | Safari | 공유 버튼 ↑ → **홈 화면에 추가** |

설치하면 주소창 없는 전체 화면 앱으로 실행되고, 오프라인에서도 라이브러리를
열 수 있습니다.

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

## 앱스토어 배포가 필요해지면 (Capacitor)

PWA로 충분하지 않을 때(앱스토어 배포, 파일 시스템 접근 등)는
[Capacitor](https://capacitorjs.com)로 이 코드베이스를 그대로 감싸 네이티브
앱을 만들 수 있습니다.

```bash
npm install @capacitor/core @capacitor/cli
npx cap init ai-core-mobile com.aicore.mobile --web-dir dist
npx cap add android   # Android Studio 필요
npx cap add ios       # macOS + Xcode 필요
npm run build && npx cap sync
```

웹 코드는 수정 없이 그대로 사용되므로, 필요해질 때 붙이면 됩니다.

## 로드맵 (데스크톱 기능 중 미이식)

- 선택 즉시 번역(Google Translate/DeepL/Ollama/LibreTranslate) — 브라우저
  CORS 제약으로 프록시 서버 또는 Capacitor 네이티브 HTTP가 필요
- Google Drive / Notion 동기화 (데스크톱 라이브러리와 공유)
- 검색 결과의 글자 단위 하이라이트, 참고문헌 링크 이동, Figure/Table 미리보기
