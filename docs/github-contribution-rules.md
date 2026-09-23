# GitHub 기여 집계 규칙과 MVP의 경계

제품이 다루는 GitHub 기여 활동 후보는 Commit, Pull Request 생성, Pull Request Review 제출, Issue 생성, Discussion 생성·답변, Repository 생성, Repository Fork입니다. MVP가 직접 생성하는 것은 **Commit**뿐입니다. 나머지는 후속 고도화 범위입니다.

MVP는 계정에 연결된 이메일, Fork가 아닌 저장소, 기본 브랜치, 실제 파일 변경, 명시적인 author·committer 날짜를 사용해 기여 집계 가능성을 높입니다. 날짜는 사용자가 선택한 IANA 시간대의 정오를 기준으로 계산하고, 미래 날짜는 허용하지 않습니다. GitHub의 실제 집계 여부를 앱이 보장할 수는 없으며, 화면의 기존 잔디 수치는 GitHub GraphQL 기여 캘린더를 그대로 사용합니다.

실패 또는 미집계가 의심되면 저장소가 Fork인지, 기본 브랜치에 커밋이 있는지, 작성 이메일이 계정에 연결되어 있는지, 비공개 기여 표시 설정과 GitHub 집계 지연 여부를 확인합니다. 앱의 발행 성공과 잔디 집계는 별개입니다.

원본 요구사항과 참고 링크는 [`product-definition.md`](product-definition.md)의 4절을 따릅니다.
