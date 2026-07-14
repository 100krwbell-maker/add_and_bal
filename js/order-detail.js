/* =========================================================
   주문 상세 (쇼피파이 주문 상세 화면 재현)
   - order-practice.html 의 주문 행을 클릭하면 ?no=#1150 으로 들어옴
   - 데이터는 localStorage('practice_orders') 에 저장된 주문 그대로 사용
   - 이 화면은 '판단의 재료'를 보여주는 곳:
     상품/금액/배송지·청구지/연락처/Order risk/타임라인 을 보고
     발주할지, 사기라서 거를지, 고객에게 문의할지를 결정하게 된다
   - TODO: [Mark as fulfilled] 등 실제 처리 동작 → 정산·성적 (다음 단계)
   ========================================================= */
(function () {
  var ORDERS = 'practice_orders';

  var MONTHS = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function money(n) { return '$' + Number(n || 0).toFixed(2); }

  function fmtFull(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var h = d.getHours(), ampm = h >= 12 ? 'pm' : 'am', h12 = h % 12 || 12;
    var mm = String(d.getMinutes()).padStart(2, '0');
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() +
      ' at ' + h12 + ':' + mm + ' ' + ampm;
  }
  function fmtTime(ts, minusMin) {
    var d = new Date(ts - (minusMin || 0) * 60000);
    var h = d.getHours(), ampm = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12;
    return h12 + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ampm;
  }
  function fmtDay(ts) {
    var d = new Date(ts);
    return MONTHS[d.getMonth()].slice(0, 3) === 'Jun' ? 'June ' + d.getDate()
      : MONTHS[d.getMonth()] + ' ' + d.getDate();
  }
  function ordinal(n) {
    if (n === 1) return '1st';
    if (n === 2) return '2nd';
    if (n === 3) return '3rd';
    return n + 'th';
  }

  function load() {
    var no = new URLSearchParams(location.search).get('no');
    var orders = [];
    try { orders = JSON.parse(localStorage.getItem(ORDERS)) || []; } catch (e) { orders = []; }
    return orders.find(function (o) { return o.no === no; });
  }

  /* ---------- 조각들 ---------- */
  function badges(o) {
    var pay = '<span class="ord-badge"><span class="dot"></span>' +
      (o.payment === 'refunded' ? 'Refunded' : 'Paid') + '</span>';
    var ful = o.fulfillment === 'fulfilled'
      ? '<span class="ord-badge"><span class="dot"></span>Fulfilled</span>'
      : '<span class="ord-badge attn"><span class="dot"></span>Unfulfilled</span>';
    return pay + ' ' + ful;
  }

  function lineRows(o) {
    return (o.lines || []).map(function (l) {
      var img = l.image
        ? '<img class="od-img" src="' + esc(l.image) + '" alt="">'
        : '<span class="od-img od-img--empty">?</span>';
      return '<div class="od-line">' +
        img +
        '<div class="od-line__info">' +
          '<a class="od-line__name" href="' + (l.source ? esc(l.source) : '#') + '"' +
            (l.source ? ' target="_blank"' : '') + '>' + esc(l.name) + '</a>' +
          '<div class="od-line__sku">' + esc(l.sku || '') + '</div>' +
        '</div>' +
        '<div class="od-line__qty">' + money(l.price) + ' × <span class="od-qty">' + l.qty + '</span></div>' +
        '<div class="od-line__sum">' + money(l.price * l.qty) + '</div>' +
      '</div>';
    }).join('');
  }

  function riskBar(o) {
    var lvl = o.risk || 'low';
    var pct = lvl === 'high' ? 100 : (lvl === 'medium' ? 60 : 28);
    var color = lvl === 'high' ? '#e03131' : (lvl === 'medium' ? '#f59e0b' : '#1aab5b');
    var text = lvl === 'high'
      ? 'Chargeback risk is high. Review this order before fulfilling it.'
      : lvl === 'medium'
        ? 'Chargeback risk is medium. Review this order before fulfilling it.'
        : 'Chargeback risk is low. You can fulfill this order.';
    return '<div class="od-card">' +
      '<div class="od-card__head">Order risk</div>' +
      '<div class="od-card__body">' +
        '<div class="od-risk"><i style="width:' + pct + '%;background:' + color + ';"></i></div>' +
        '<div class="od-risk__labels"><span' + (lvl === 'low' ? ' class="on"' : '') + '>Low</span>' +
          '<span' + (lvl === 'medium' ? ' class="on"' : '') + '>Medium</span>' +
          '<span' + (lvl === 'high' ? ' class="on"' : '') + '>High</span></div>' +
        '<p class="od-muted" style="margin:12px 0 0;">' + text + '</p>' +
      '</div>' +
    '</div>';
  }

  // 타임라인 — 주문이 들어온 시각을 기준으로 역순 이벤트 생성
  function timeline(o) {
    var g = esc(o.gateway || 'PayPal Wallet');
    var payout = (o.grandTotal || 0) * 0.95;   // 결제 수수료를 뗀 정산 예정액
    var events = [
      [1, money(payout) + ' USD will be added to your next payout.'],
      [0, money(o.grandTotal) + ' USD was captured on ' + g + '.'],
      [0, 'Order confirmation email was sent to ' + esc(o.cust) +
          (o.email ? ' (' + esc(o.email) + ')' : '') + '.'],
      [0, 'A ' + money(o.grandTotal) + ' USD capture is pending on ' + g + '.'],
      [0, money(o.grandTotal) + ' USD was authorized on ' + g + '.'],
      [0, 'Confirmation ' + esc(o.no.replace('#', '')) + 'CNF was generated for this order.'],
      [0, esc(o.cust) + ' placed this order on ' + esc(o.channel) + '.'],
    ];
    return '<div class="od-box">' +
      '<div class="od-box__title">Timeline</div>' +
      '<div class="od-comment">Leave a comment...</div>' +
      '<div class="od-tl">' +
        '<div class="od-tl__day">' + fmtDay(o.ts) + '</div>' +
        events.map(function (e) {
          return '<div class="od-tl__row">' +
            '<span class="od-tl__dot"></span>' +
            '<span class="od-tl__text">' + e[1] + '</span>' +
            '<span class="od-tl__time">' + fmtTime(o.ts, -e[0]) + '</span>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  function addressBlock(name, o) {
    // 정보가 누락된 주문은 실제로 빈 칸이 보인다 → 수강생이 직접 알아채야 함
    var lines = [
      esc(name),
      o.addr ? esc(o.addr) : '<span class="od-missing">주소 없음</span>',
      esc(o.city || ''),
      o.zip ? esc(o.zip) : '<span class="od-missing">우편번호 없음</span>',
      'United States',
    ];
    return lines.join('<br>');
  }

  function render(o) {
    var itemCount = (o.lines || []).reduce(function (a, l) { return a + l.qty; }, 0);

    document.getElementById('odRoot').innerHTML =
      '<div class="od-top">' +
        '<a class="od-back" href="order-practice.html">←</a>' +
        '<h2 class="od-no">' + esc(o.no) + '</h2>' +
        badges(o) +
        '<div class="od-top__actions">' +
          '<button class="btn-sm" disabled>Refund</button>' +
          '<button class="btn-sm" disabled>Edit</button>' +
          '<button class="btn-sm" disabled>More actions ▾</button>' +
        '</div>' +
      '</div>' +
      '<div class="od-sub">' + fmtFull(o.ts) + ' from ' + esc(o.channel) + '</div>' +

      '<div class="od-grid">' +
        // ===== 왼쪽 =====
        '<div>' +
          '<div class="od-box">' +
            '<div class="od-tag attn">📦 ' +
              (o.fulfillment === 'fulfilled' ? 'Fulfilled' : 'Unfulfilled') + '</div>' +
            '<div class="od-method">🚚 ' + esc(o.method) + '</div>' +
            '<div class="od-lines">' + lineRows(o) + '</div>' +
            '<div class="od-actions">' +
              '<button class="btn-sm" id="btnFulfill">Mark as fulfilled</button>' +
              '<button class="btn-sm" disabled>Create shipping label</button>' +
              '<button class="btn-sm is-dark" disabled>Add to batch</button>' +
            '</div>' +
          '</div>' +

          '<div class="od-box">' +
            '<div class="od-tag">💳 ' + (o.payment === 'refunded' ? 'Refunded' : 'Paid') + '</div>' +
            '<table class="od-money">' +
              '<tr><td>Subtotal</td><td>' + itemCount + (itemCount === 1 ? ' item' : ' items') + '</td>' +
                '<td class="r">' + money(o.total) + '</td></tr>' +
              '<tr><td>Shipping</td><td>' + esc(o.method) + '</td>' +
                '<td class="r">' + money(o.shipping) + '</td></tr>' +
              '<tr><td>Taxes</td><td>Tax details</td><td class="r">' + money(o.tax) + '</td></tr>' +
              '<tr class="tot"><td>Total</td><td></td><td class="r">' + money(o.grandTotal) + '</td></tr>' +
            '</table>' +
            '<table class="od-money paid">' +
              '<tr><td>Paid</td><td></td><td class="r">' +
                (o.payment === 'refunded' ? money(0) : money(o.grandTotal)) + '</td></tr>' +
            '</table>' +
          '</div>' +

          timeline(o) +
        '</div>' +

        // ===== 오른쪽 =====
        '<div>' +
          '<div class="od-card">' +
            '<div class="od-card__head">Notes</div>' +
            '<div class="od-card__body od-muted">No notes from customer</div>' +
          '</div>' +

          '<div class="od-card">' +
            '<div class="od-card__head">Customer</div>' +
            '<div class="od-card__body">' +
              '<a href="#">' + esc(o.cust) + '</a>' +
              '<div class="od-muted" style="margin-top:4px;">' +
                (o.custOrderNo || 1) + (o.custOrderNo === 1 ? ' order' : ' orders') + '</div>' +

              '<div class="od-card__sub">Contact information</div>' +
              (o.email ? '<a href="#">' + esc(o.email) + '</a>' : '<span class="od-missing">이메일 없음</span>') +
              '<div style="margin-top:4px;">' +
                (o.phone ? esc(o.phone) : '<span class="od-missing">No phone number</span>') + '</div>' +

              '<div class="od-card__sub">Shipping address</div>' +
              addressBlock(o.cust, o) +

              '<div class="od-card__sub">Billing address</div>' +
              addressBlock(o.billTo || o.cust, o) +
            '</div>' +
          '</div>' +

          '<div class="od-card">' +
            '<div class="od-card__head">Conversion summary</div>' +
            '<div class="od-card__body od-muted">' +
              '<div>🛒 This is their ' + ordinal(o.custOrderNo || 1) + ' order</div>' +
              '<div style="margin-top:6px;">👁 1st session from shopify.com</div>' +
              '<div style="margin-top:6px;">🖥 1 session over 1 day</div>' +
            '</div>' +
          '</div>' +

          riskBar(o) +

          '<div class="od-card">' +
            '<div class="od-card__head">Tags</div>' +
            '<div class="od-card__body">' +
              ((o.tags || []).length
                ? o.tags.map(function (t) { return '<span class="ord-chip">' + esc(t) + '</span>'; }).join('')
                : '<span class="od-muted">태그 없음</span>') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    // TODO: 실제 발주 처리(정산·성적) 연결 — 지금은 UI만
    var f = document.getElementById('btnFulfill');
    if (f) f.addEventListener('click', function () {
      alert('발주 처리 동작은 다음 단계에서 붙입니다.');
    });
  }

  (async function init() {
    var user = await Auth.require();
    if (!user) return;

    var o = load();
    if (!o) {
      document.getElementById('odRoot').innerHTML =
        '<div class="page-head"><h2>주문을 찾을 수 없습니다</h2>' +
        '<p>주문 목록에서 다시 선택해주세요.</p></div>' +
        '<a class="btn-primary" href="order-practice.html" style="text-decoration:none;padding:10px 18px;">발주 연습으로 돌아가기</a>';
      return;
    }
    render(o);
  })();
})();
