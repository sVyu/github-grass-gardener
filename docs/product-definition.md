# GitHub Grass Gardener 제품 정의 및 요구사항

## 문서 정보

- 상태: Draft
- 대상 버전: MVP
- 구현 절차: SDD → TDD → Implementation
- 기본 클라이언트: React Web
- 향후 클라이언트: Electron

## 1. 제품 정의

`github-grass-gardener`는 사용자가 GitHub 기여 캘린더를 확인하고, 원하는 날짜에 커밋을 계획·생성하며, 애플리케이션이 만든 커밋의 날짜 구성을 관리할 수 있게 하는 애플리케이션이다.

핵심 용어는 다음과 같이 구분한다.

- **Grass**: 특정 날짜와 개수로 새로운 커밋을 생성하는 기능
- **Gardening**: 아직 발행하지 않은 커밋 계획의 날짜를 재배치하는 기능
- **History Rewrite**: 이미 GitHub에 푸시된 커밋의 날짜를 변경하는 고위험 기능

MVP의 기본 사용자 흐름은 다음과 같다.

> GitHub 연결 → 기여 현황 확인 → 캘린더에서 날짜와 개수 계획 → 미리보기 → 앱 전용 저장소에 커밋 발행 → 결과 확인

## 2. 문제 정의

GitHub 기여 캘린더 형태로 커밋을 구성하려는 사용자는 다음 작업을 직접 처리해야 한다.

- GitHub 인증 및 저장소 준비
- GitHub 기여 집계 조건 확인
- 날짜별 커밋 개수 계산
- Git author/committer 날짜 설정
- 커밋 생성 및 default branch 반영
- 잘못 설정한 날짜의 재작업
- 실제 GitHub 기여 반영 여부 확인

이 과정은 Git과 GitHub 기여 집계 규칙에 대한 이해를 요구한다. 특히 이미 원격에 반영된 커밋을 수정하면 후속 커밋의 SHA까지 달라지고 협업자의 이력과 충돌할 수 있다.

이 애플리케이션은 복잡한 Git 조작을 캘린더 기반 계획과 안전한 실행 흐름으로 추상화한다.

## 3. 목표와 비목표

### 3.1 목표

- GitHub가 계산한 실제 기여 캘린더를 조회한다.
- 캘린더 UI에서 날짜별 커밋 생성 계획을 편집한다.
- GitHub 기여 집계 조건을 만족할 가능성이 높은 커밋을 생성한다.
- 실행 전에 모든 변경을 미리 보여주고 사용자의 명시적 승인을 받는다.
- 동시 수정, 권한 부족, 잘못된 저장소 선택으로부터 원격 이력을 보호한다.
- 도메인 로직을 Web과 Electron에서 재사용할 수 있게 구성한다.

### 3.2 비목표

- GitHub 기여 반영을 보장하지 않는다.
- MVP에서는 임의 저장소의 기존 원격 커밋 이력을 재작성하지 않는다.
- MVP에서는 PR, Review, Issue, Discussion, Fork를 자동 생성하지 않는다.
- MVP에서는 예약 실행이나 백그라운드 자동 커밋을 제공하지 않는다.
- 실제 개발 활동이나 경력을 증명하는 도구로 포지셔닝하지 않는다.

## 4. GitHub 기여 집계 규칙

다음 활동은 GitHub 기여 활동의 후보로 취급한다.

1. GitHub Contribution 조건을 충족하는 Commit
2. Pull Request 생성
3. Pull Request Review 제출
4. Issue 생성
5. Discussion 생성
6. Discussion 답변
7. Repository 생성
8. Repository Fork

다만 모든 활동이 동일한 조건으로 집계되지는 않는다.

- 저장소 생성과 Fork는 기본적으로 기여 활동으로 취급된다.
- Commit, Issue, Pull Request, Review, Discussion은 조건부로 집계된다.
- 커밋은 GitHub 계정에 연결된 이메일을 사용해야 한다.
- 커밋은 Fork가 아닌 독립 저장소에서 만들어져야 한다.
- 커밋은 저장소의 default branch 또는 `gh-pages` branch에 포함되어야 한다.
- 프로필 기여 날짜 계산에는 커밋의 author date가 사용된다.

따라서 제품에서는 다음 원칙을 따른다.

> GitHub 기여 집계 조건을 만족하도록 커밋을 생성하지만, 최종 집계 여부는 GitHub 정책과 사용자 계정 설정에 따라 달라질 수 있다.

실제 기여 캘린더는 GitHub GraphQL API의 `ContributionsCollection.contributionCalendar`를 사용해 조회한다. 애플리케이션이 저장소 이력을 조합해 기여 현황을 추정하지 않는다.

참고 자료:

- [GitHub Profile contributions reference](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference)
- [GitHub GraphQL ContributionCalendar](https://docs.github.com/en/graphql/reference/users)

## 5. MVP 범위

### 5.1 포함

1. GitHub 토큰 연결 및 사용자 확인
2. 접근 가능한 저장소 목록 조회
3. 앱 전용 저장소 생성
4. 저장소 및 default branch 유효성 검사
5. GitHub 실제 기여 캘린더 조회
6. 날짜별 커밋 개수 계획
7. 계획 수정, 삭제 및 템플릿 적용
8. 지정된 author date로 커밋 생성
9. default branch 반영
10. 실행 결과 및 실패 원인 표시
11. Palantir 계열 기본 테마
12. 반응형 캘린더 UI

### 5.2 제외

- 임의 저장소의 기존 커밋 이력 재작성
- Merge commit을 포함한 복잡한 히스토리 재작성
- PR, Review, Issue, Discussion 자동 생성
- Repository Fork 자동화
- Electron 패키징
- Airbnb 계열 선택 테마
- 다중 사용자 서버 계정
- 예약 실행 및 백그라운드 자동 커밋

## 6. 기능 요구사항

### 6.1 인증과 권한

- `AUTH-001` 사용자는 GitHub 토큰을 입력할 수 있어야 한다.
- `AUTH-002` 애플리케이션은 토큰으로 로그인 사용자를 조회하고 유효성을 검증해야 한다.
- `AUTH-003` 토큰은 URL, 로그, 분석 이벤트 및 오류 추적 데이터에 포함되어서는 안 된다.
- `AUTH-004` Web MVP에서는 토큰을 메모리에만 보관하고 브라우저 영구 저장소에 저장하지 않는다.
- `AUTH-005` 권한 부족 시 필요한 권한과 해결 방법을 표시해야 한다.
- `AUTH-006` 공개 서비스 전환 시 GitHub App 또는 Backend for Frontend 기반 인증을 검토한다.

Fine-grained PAT 기준으로 커밋 생성에는 선택한 저장소의 `Contents: write` 권한이 필요하다. 사용자 저장소 생성에는 `Administration: write` 권한이 필요하다.

참고 자료:

- [GitHub Git commits REST API](https://docs.github.com/en/rest/git/commits)
- [GitHub Repositories REST API](https://docs.github.com/en/rest/repos/repos)

### 6.2 저장소

- `REPO-001` 접근 가능한 저장소를 목록으로 표시한다.
- `REPO-002` 이름, 공개 여부, Fork 여부, default branch 및 쓰기 가능 여부를 표시한다.
- `REPO-003` 앱 전용 저장소를 생성할 수 있다.
- `REPO-004` Fork 저장소를 선택하면 커밋이 기여로 집계되지 않을 수 있음을 경고한다.
- `REPO-005` default branch 쓰기 권한과 branch protection 상태를 사전 검사한다.
- `REPO-006` 앱 전용 저장소 사용을 기본 안전 모드로 권장한다.
- `REPO-007` 아카이브되었거나 비활성화된 저장소는 발행 대상으로 선택할 수 없다.

### 6.3 기여 캘린더

- `CAL-001` 최근 1년 또는 사용자가 선택한 연도의 실제 GitHub 기여 현황을 표시한다.
- `CAL-002` GitHub에서 확인된 실제 기여를 표시한다.
- `CAL-003` 아직 발행하지 않은 계획을 실제 기여와 구분해 표시한다.
- `CAL-004` 발행했지만 GitHub 반영을 확인하지 못한 커밋과 실패한 커밋을 구분한다.
- `CAL-005` 날짜 클릭, 드래그 및 범위 선택으로 커밋 개수를 설정할 수 있다.
- `CAL-006` 색상뿐 아니라 숫자, 패턴 및 툴팁으로 상태를 전달한다.
- `CAL-007` 키보드만으로 날짜를 탐색하고 계획을 편집할 수 있어야 한다.
- `CAL-008` 미래 날짜는 기본적으로 선택할 수 없다.
- `CAL-009` 시간대는 IANA time zone 이름으로 저장한다.
- `CAL-010` 날짜 경계 오류를 줄이기 위해 선택 날짜의 정오를 기본 커밋 시각으로 사용한다.

### 6.4 Grass 생성

- `GRASS-001` 날짜별 커밋 개수, 메시지 템플릿, 콘텐츠 템플릿 및 대상 저장소를 설정한다.
- `GRASS-002` 실행 전에 생성될 커밋 수와 날짜 목록을 보여준다.
- `GRASS-003` 각 커밋에는 GitHub 계정과 연결된 author email을 사용한다.
- `GRASS-004` author date와 committer date를 ISO 8601 형식으로 명시한다.
- `GRASS-005` 각 커밋은 `.grass-gardener/activity.jsonl`과 같은 앱 전용 파일에 실제 변경을 남긴다.
- `GRASS-006` 동일 실행의 중복 생성을 막기 위해 batch ID를 기록한다.
- `GRASS-007` 실행 직전 remote HEAD가 계획 생성 시점의 HEAD와 같은지 확인한다.
- `GRASS-008` remote HEAD가 변경되었다면 자동으로 덮어쓰지 않고 실행을 중단한다.
- `GRASS-009` 생성 완료 후 새 HEAD와 생성된 커밋 목록을 표시한다.
- `GRASS-010` API 일부 호출이 실패하면 사용자가 재시도 가능한 항목과 현재 원격 상태를 표시한다.

GitHub Git Database API는 author와 committer의 날짜를 지정한 커밋 생성을 지원한다.

### 6.5 Gardening

MVP에서 Gardening은 원격 이력 재작성이 아니라 발행 전 커밋 계획 수정으로 정의한다.

- `GARDEN-001` 아직 발행하지 않은 커밋을 다른 날짜로 이동할 수 있다.
- `GARDEN-002` 여러 날짜를 선택해 일괄 이동하거나 개수를 변경할 수 있다.
- `GARDEN-003` 수정된 계획은 사용자가 발행을 확정하기 전까지 GitHub 원격 상태를 변경하지 않는다.
- `GARDEN-004` 이미 발행한 커밋은 MVP에서 읽기 전용으로 표시한다.
- `GARDEN-005` 이미 발행된 커밋의 변경 요청에는 History Rewrite가 필요한 이유를 안내한다.

## 7. 기존 커밋 날짜 변경의 기술적 의미

Git 커밋은 수정 가능한 레코드가 아니다. 날짜를 변경하면 새로운 커밋이 된다.

```text
기존: A ─ B ─ C ─ D
              날짜 변경

결과: A ─ B' ─ C' ─ D'
```

커밋 B의 날짜만 바꾸더라도 다음 변화가 발생한다.

- B의 SHA가 변경된다.
- B를 부모로 가지는 모든 후속 커밋의 SHA도 변경된다.
- 기존 커밋 서명이 무효화될 수 있다.
- 원격 branch를 새 이력으로 강제 갱신해야 한다.
- 협업자의 clone, Pull Request 및 branch에 충돌이 발생할 수 있다.
- 보호된 branch에서는 force push가 차단될 수 있다.

따라서 History Rewrite는 다음 조건을 충족하는 경우에만 후속 버전에서 검토한다.

- 앱 전용 저장소
- 선형 히스토리
- 앱이 생성한 커밋만 포함
- 다른 branch 또는 열린 Pull Request 없음
- force push를 막는 branch protection 없음
- 실행 전 백업 branch 생성
- 변경될 모든 SHA 미리보기
- 사용자의 명시적인 고위험 작업 확인
- 동시 변경을 감지하는 ref 확인

참고 자료:

- [GitHub commit history 변경 안내](https://docs.github.com/en/pull-requests/committing-changes-to-your-project/creating-and-editing-commits/changing-a-commit-message)
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

## 8. 화면 구성

### 8.1 Connect GitHub

- 토큰 입력
- 필요 권한 안내
- 로그인 사용자 및 이메일 상태 확인

### 8.2 Repository Setup

- 기존 저장소 선택
- 앱 전용 저장소 생성
- 기여 집계 가능성 및 쓰기 권한 검사

### 8.3 Contribution Calendar

- 실제 기여
- 계획된 커밋
- 발행 상태
- 날짜별 상세 정보

### 8.4 Grass Editor

- 날짜 및 범위 선택
- 커밋 개수 지정
- 메시지와 콘텐츠 템플릿 선택
- 시간대 선택

### 8.5 Execution Preview

- 생성 개수
- 대상 저장소와 branch
- 날짜 목록
- 예상 변경 내용
- 권한 및 이력 관련 경고

### 8.6 Execution Result

- 성공 및 실패 목록
- 생성된 commit SHA
- GitHub 링크
- 기여 캘린더 새로고침

### 8.7 Templates

- 평일 패턴
- 주 N회 패턴
- 균일 패턴
- 제한된 범위의 랜덤 패턴
- 텍스트 또는 이미지 패턴

## 9. 기술 스택과 아키텍처

### 9.1 채택 기술

- React
- TypeScript
- Vite
- Tailwind CSS
- pnpm
- Vitest
- React Testing Library
- Mock Service Worker
- Playwright

Next.js는 MVP의 필수 요소로 사용하지 않는다. 공개 서비스에서 토큰을 브라우저 런타임에 노출하지 않기 위한 Backend for Frontend가 필요해질 때 도입 여부를 별도로 결정한다.

TypeScript는 다음 목적을 위해 JavaScript 대신 사용한다.

- GitHub REST 및 GraphQL 응답 계약 관리
- 커밋 계획과 실행 상태의 명시적 모델링
- Web과 Electron adapter 사이의 인터페이스 정의
- 날짜와 시간대 관련 오류의 조기 탐지
- SDD와 테스트의 요구사항을 타입으로 보강

### 9.2 모듈 경계

```text
UI
 ├─ Calendar
 ├─ Repository
 └─ Execution

Application
 ├─ CreateCommitPlan
 ├─ ValidateRepository
 ├─ PublishCommitPlan
 └─ MovePlannedCommit

Domain
 ├─ CommitPlan
 ├─ ContributionDay
 └─ ExecutionBatch

Adapters
 ├─ GitHub REST/GraphQL
 ├─ BrowserCredentialStore
 └─ ElectronCredentialStore
```

React 컴포넌트에서 GitHub API를 직접 호출하지 않는다. 도메인과 애플리케이션 계층은 React, 브라우저 및 Electron API에 의존하지 않는다.

## 10. 비기능 요구사항

### 10.1 보안

- PAT를 `localStorage` 또는 IndexedDB에 저장하지 않는다.
- 토큰과 이메일을 로그와 오류 보고에서 마스킹한다.
- GitHub API 오류 응답 전체를 분석 서비스로 전송하지 않는다.
- 최소 권한 토큰만 사용한다.
- Content Security Policy를 적용한다.
- 사용자가 입력한 템플릿을 HTML로 직접 렌더링하지 않는다.
- Electron에서는 OS keychain 기반 보안 저장소를 사용한다.

순수 Web 애플리케이션은 실행 중인 JavaScript, 악성 브라우저 확장 및 XSS로부터 토큰을 완전히 숨길 수 없다. 이 제약을 사용자와 개발 문서에 명시한다.

### 10.2 신뢰성

- 발행 작업에 중복 실행 방지용 batch ID를 사용한다.
- 계획을 생성할 때 기준 remote HEAD를 기록한다.
- 발행 직전 remote HEAD를 다시 확인한다.
- 충돌을 자동 force push로 해결하지 않는다.
- API rate limit과 재시도 가능 시간을 사용자에게 보여준다.

### 10.3 접근성

- 기여 단계를 색상만으로 표현하지 않는다.
- 모든 캘린더 작업을 키보드로 수행할 수 있게 한다.
- 날짜 셀에 읽을 수 있는 접근성 레이블을 제공한다.
- 테마별 명도 대비를 WCAG 기준으로 검증한다.

### 10.4 성능

- 1년 단위 기여 캘린더 상호작용에서 눈에 띄는 지연이 없어야 한다.
- GitHub API 요청을 불필요하게 날짜별로 반복하지 않는다.
- 대량 커밋 계획에는 사전 정의된 최대 개수와 사용자 경고를 적용한다.

## 11. 주요 논점과 결정 사항

### 11.1 결정 완료

- MVP Gardening은 발행 전 계획 변경으로 정의한다.
- 앱 전용 저장소를 기본 안전 모드로 사용한다.
- 실제 캘린더는 GitHub GraphQL 결과를 기준으로 한다.
- Web MVP 인증은 사용자가 제공한 fine-grained PAT로 시작한다.
- JavaScript 대신 TypeScript를 사용한다.
- React + Vite를 기본으로 하고 Next.js는 현재 도입하지 않는다.
- Palantir 계열 디자인을 기본 테마로 한다.

### 11.2 추가 결정 필요

1. 앱 전용 저장소의 기본 공개 범위
2. GitHub 연결 이메일을 확보하고 검증하는 방식
3. 일별 및 batch별 최대 커밋 개수
4. 커밋 메시지와 콘텐츠의 기본 템플릿
5. 계획 데이터를 새로고침 이후에도 보존할지 여부
6. 공개 서비스 전환 시 GitHub App과 OAuth/BFF 중 선택
7. History Rewrite 기능을 실제로 제공할지 여부
8. 인위적 기여 생성에 관한 사용자 책임 고지와 서비스 정책

## 12. SDD 산출물

구현 전에 다음 문서를 순서대로 작성하거나 확정한다.

- `docs/product-definition.md`
- `docs/domain-model.md`
- `docs/github-contribution-rules.md`
- `docs/auth-and-security.md`
- `docs/commit-publication-flow.md`
- `docs/adr/001-auth-strategy.md`
- `docs/adr/002-history-rewrite-scope.md`
- `docs/adr/003-timezone-policy.md`

각 문서에는 정상 흐름뿐 아니라 실패 조건, 복구 방법 및 인수 조건을 포함해야 한다.

## 13. TDD 전략

테스트는 다음 순서로 작성한다.

1. 날짜와 시간대 변환
2. 날짜별 커밋 계획 생성
3. 계획 이동 및 개수 변경
4. 중복 batch 방지
5. GitHub 기여 조건 검증
6. API 응답과 오류 매핑
7. remote HEAD 동시성 검사
8. 캘린더 상호작용
9. 발행 전체 흐름 E2E

### 13.1 핵심 인수 테스트

```gherkin
Given 사용자가 2026-01-10에 커밋 3개를 계획했고
And 유효한 저장소와 연결된 이메일을 선택했을 때
When 사용자가 계획 발행을 확정하면
Then default branch에 커밋 3개가 순서대로 생성되어야 하고
And 각 커밋의 author date는 2026-01-10이어야 하며
And 실행 결과에 각 커밋 SHA가 표시되어야 한다
```

```gherkin
Given 사용자가 계획을 만든 이후 remote HEAD가 변경되었을 때
When 계획 발행을 시도하면
Then branch ref를 변경해서는 안 되고
And 새 변경 내용을 다시 불러오도록 안내해야 한다
```

```gherkin
Given 사용자가 Fork 저장소를 선택했을 때
When Grass 생성 화면으로 이동하려 하면
Then 기여 집계 대상이 아닐 수 있다는 경고를 표시해야 한다
And 앱 전용 저장소를 생성할 수 있는 경로를 제공해야 한다
```

## 14. AGENTS.md 작성 원칙

향후 루트 `AGENTS.md`에는 최소한 다음 규칙을 포함한다.

```markdown
# Development Workflow

1. 구현 전에 관련 specification을 작성하거나 갱신한다.
2. specification에는 acceptance criteria와 실패 조건을 포함한다.
3. 테스트를 먼저 작성하고 실패를 확인한다.
4. 테스트를 통과하는 최소 구현을 작성한다.
5. 리팩터링 후 전체 테스트를 실행한다.

# Safety Rules

- 토큰을 파일, 로그, fixture 또는 snapshot에 기록하지 않는다.
- 임의 저장소에 force push하는 기능을 구현하지 않는다.
- 원격 HEAD 불일치 시 발행을 중단한다.
- GitHub 기여 반영을 보장하는 문구를 사용하지 않는다.
- 날짜는 명시적인 IANA time zone과 함께 처리한다.

# Architecture Rules

- UI 컴포넌트에서 GitHub API를 직접 호출하지 않는다.
- 도메인 로직은 React와 Electron에 의존하지 않는다.
- 외부 API 응답은 adapter 경계에서 검증한다.
- 새로운 기능에는 unit test와 acceptance test를 추가한다.
```

## 15. MVP 완료 기준

다음 조건을 모두 만족하면 MVP가 완료된 것으로 간주한다.

- 유효한 GitHub 토큰으로 사용자를 확인할 수 있다.
- 사용 가능한 저장소를 조회하거나 앱 전용 저장소를 생성할 수 있다.
- GitHub 실제 기여 캘린더를 표시할 수 있다.
- 캘린더에서 날짜별 커밋 계획을 만들고 수정할 수 있다.
- 실행 전에 전체 변경 사항을 미리 확인할 수 있다.
- 연결된 이메일과 지정 날짜를 사용해 커밋을 생성할 수 있다.
- remote HEAD 변경 시 안전하게 실행을 중단한다.
- 생성 결과와 실패 원인을 사용자에게 제공한다.
- 핵심 도메인, API adapter 및 사용자 흐름 테스트가 통과한다.
- 토큰이 영구 저장소, 로그 및 테스트 결과에 노출되지 않는다.

MVP 이후 첫 번째 검토 항목은 원격 History Rewrite가 아니라 Electron 보안 저장소와 인증 경험 개선으로 한다.
