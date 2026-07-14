/* =========================================================
   공통 사이드바 렌더링
   - 각 페이지 <body data-area="user|admin" data-active="키"> 로 지정
   - file:// 로 바로 열어도 동작 (fetch 미사용, DOM 생성 방식)
   ========================================================= */
(function () {
  const MENUS = {
    user: {
      brand: { title: '발주 &amp; 광고<br>설정 훈련', sub: '사용자 영역' },
      base: '',            // 사용자 페이지는 루트 기준
      items: [
        { key: 'home',     ico: '🏠', label: '메인',            href: 'index.html' },
        { key: 'myinfo',   ico: '🧾', label: '내 스토어 정보',    href: 'my-info.html' },
        { key: 'basic',    ico: '⚙️', label: '기본 설정 연습하기', href: 'basic-settings.html' },
        { key: 'ad',       ico: '📢', label: '광고 설정하기',      href: 'ad-settings.html' },
        { key: 'setup',    ico: '🧩', label: '발주 연습 세팅',     href: 'order-setup.html' },
        { key: 'practice', ico: '📦', label: '발주 연습하기',      href: 'order-practice.html' },
      ],
      footer: '<div class="who">홍길동 <span class="badge-admin">수강생</span></div><a href="#">로그아웃</a>',
    },
    admin: {
      brand: { title: '발주 &amp; 광고<br>설정 훈련', sub: '어드민 영역' },
      base: '',            // 어드민 페이지는 admin/ 폴더 내부이므로 상대경로 그대로
      items: [
        { key: 'home',        ico: '🏠', label: '메인',        href: 'index.html' },
        { key: 'registrants', ico: '🙋', label: '가입자 관리',  href: 'registrants.html' },
        { key: 'users',       ico: '👥', label: '사용자 관리',  href: 'users.html' },
        { key: 'review',      ico: '📝', label: '자료 검수',    href: 'review.html' },
        { key: 'products',    ico: '🛍️', label: '상품 관리',    href: 'products.html' },
        { key: 'results',     ico: '📊', label: '결과 관리',    href: 'results.html' },
      ],
      footer: '<div class="who">GSK Admin <span class="badge-admin">관리자</span></div><a href="../index.html">사용자 화면으로</a>',
    },
  };

  const area = document.body.dataset.area || 'user';
  const active = document.body.dataset.active || 'home';
  const menu = MENUS[area];

  const links = menu.items.map(function (it) {
    const cls = it.key === active ? 'is-active' : '';
    return '<li><a class="' + cls + '" href="' + it.href + '">' +
           '<span class="ico">' + it.ico + '</span>' + it.label + '</a></li>';
  }).join('');

  const html =
    '<aside class="sidebar">' +
      '<div class="sidebar__brand"><h1>' + menu.brand.title + '</h1>' +
        '<span>' + menu.brand.sub + '</span></div>' +
      '<ul class="nav">' + links + '</ul>' +
      '<div class="sidebar__footer">' + menu.footer + '</div>' +
    '</aside>';

  const mount = document.getElementById('sidebar');
  if (mount) mount.outerHTML = html;
})();
