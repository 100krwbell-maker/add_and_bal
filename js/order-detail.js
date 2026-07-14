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

  var current = null;   // 지금 보고 있는 주문

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

  // 바뀐 주문을 목록에 되돌려 저장
  function saveOrder(o) {
    var orders = [];
    try { orders = JSON.parse(localStorage.getItem(ORDERS)) || []; } catch (e) { return; }
    var i = orders.findIndex(function (x) { return x.no === o.no; });
    if (i !== -1) orders[i] = o;
    localStorage.setItem(ORDERS, JSON.stringify(orders));
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
    return (o.lines || []).map(function (l, li) {
      // 사진을 누르면 크게 볼 수 있다 (사진이 여러 장이면 넘겨볼 수 있음)
      var imgs = (l.images && l.images.length) ? l.images : (l.image ? [l.image] : []);
      var img = imgs.length
        ? '<span class="od-imgwrap is-zoom" data-line="' + li + '" title="클릭하면 크게 보기">' +
            '<img class="od-img" src="' + esc(imgs[0]) + '" alt="">' +
            (imgs.length > 1 ? '<span class="od-imgcount">' + imgs.length + '</span>' : '') +
          '</span>'
        : '<span class="od-img od-img--empty">?</span>';
      return '<div class="od-line">' +
        img +
        '<div class="od-line__info">' +
          '<a class="od-line__name" href="' + (l.source ? esc(l.source) : '#') + '"' +
            (l.source ? ' target="_blank"' : '') + '>' + esc(l.name) + '</a>' +
          '<div class="od-line__sku">' + esc(l.sku || '') +
            (l.stock != null && l.stock < l.qty
              ? '<span class="od-stock">' + (l.stock > 0 ? '재고 ' + l.stock + '개' : '품절') + '</span>'
              : '') +
          '</div>' +
        '</div>' +
        '<div class="od-line__qty">' + money(l.price) + ' × <span class="od-qty">' + l.qty + '</span></div>' +
        '<div class="od-line__sum">' + money(l.price * l.qty) + '</div>' +
      '</div>';
    }).join('');
  }

  /* ---------- 재고 부족 안내 + 고객 문의 ----------
     아마존 재고가 주문 수량보다 적을 때 뜬다.
     [고객에게 문의하기] 를 눌러야 고객의 답장이 오고, 그 답장대로 처리해야 정답이다. */
  function stockBox(o) {
    var short = (o.lines || []).filter(function (l) {
      return l.stock != null && l.stock < l.qty;
    });
    if (!short.length) return '';

    var l = short[0];
    var head = l.stock > 0
      ? '⚠️ 이 상품은 현재 재고가 <b>' + l.stock + '개</b>만 남았습니다. (주문 수량 ' + l.qty + '개)'
      : '⚠️ 이 상품은 현재 <b>품절 · 단종</b> 되어 발주할 수 없습니다. (주문 수량 ' + l.qty + '개)';

    var body;
    if (!o.replied) {
      body = '<p class="oos-p">주문한 수량을 모두 보낼 수 없습니다. 고객에게 어떻게 할지 물어보세요.</p>' +
        '<button class="btn-sm is-primary" id="btnAsk">📧 고객에게 문의하기</button>';
    } else {
      body = '<div class="oos-mail">' +
        '<div class="oos-mail__from">✉️ ' + esc(o.cust) +
          (o.email ? ' &lt;' + esc(o.email) + '&gt;' : '') + '</div>' +
        '<div class="oos-mail__body">' + replyText(o, l) + '</div>' +
      '</div>';
    }

    return '<div class="oos-box"><div class="oos-head">' + head + '</div>' + body + '</div>';
  }

  function replyText(o, l) {
    if (o.reply === 'partial') {
      return 'Hi, thanks for letting me know.<br>' +
        'Please just send me the <b>' + l.stock + '</b> you have in stock and refund the rest. ' +
        'I still want them!<br><br>' +
        '<span class="od-muted">(재고 있는 ' + l.stock + '개만 보내주시고 나머지는 환불해 주세요. ' +
        '→ <b>주문 편집</b>으로 수량을 ' + l.stock + '개로 줄이세요.)</span>';
    }
    return 'Hi, if you cannot send the full order, I do not want a partial shipment.<br>' +
      'Please <b>cancel the order and refund me in full</b>.<br><br>' +
      '<span class="od-muted">(전부 못 받으면 필요 없습니다. 전액 환불해 주세요. ' +
      '→ <b>환불하기(주문 취소)</b> 를 하세요.)</span>';
  }

  /* Order risk 카드의 아이콘을 누르면 뜨는 상세 분석.
     감지된 신호만 나열하고 결론은 내려주지 않는다 (판단은 수강생 몫) */
  function riskSignals(o) {
    var s = [];
    if (o.billTo && o.billTo !== o.cust) {
      s.push(['청구지 명의 불일치',
        '결제한 사람(' + esc(o.billTo) + ')과 받는 사람(' + esc(o.cust) + ')의 이름이 다릅니다. ' +
        '도난 카드로 결제한 뒤 다른 주소로 받는 전형적인 수법이지만, 선물 주문일 수도 있습니다.']);
    }
    if ((o.custOrderNo || 1) === 1) {
      s.push(['첫 주문 고객',
        '이 스토어에서 구매 이력이 없는 고객입니다.']);
    }
    return s;
  }

  function openRiskDetail(o) {
    var lvl = o.risk || 'low';
    var label = lvl === 'high' ? 'High' : (lvl === 'medium' ? 'Medium' : 'Low');
    var signals = riskSignals(o);

    var box = document.createElement('div');
    box.className = 'modal-overlay is-open';
    box.innerHTML =
      '<div class="modal-card">' +
        '<div class="modal-card__head">' +
          '<h3>Order risk — ' + label + '</h3>' +
          '<button class="modal-close" data-close>×</button>' +
        '</div>' +
        '<div class="modal-card__body">' +
          '<div class="od-risk" style="margin-bottom:10px;">' +
            '<i style="width:' + (lvl === 'high' ? 100 : lvl === 'medium' ? 60 : 28) + '%;' +
              'background:' + (lvl === 'high' ? '#e03131' : lvl === 'medium' ? '#f59e0b' : '#1aab5b') + ';"></i>' +
          '</div>' +
          '<div class="od-risk__labels" style="margin-bottom:18px;">' +
            '<span' + (lvl === 'low' ? ' class="on"' : '') + '>Low</span>' +
            '<span' + (lvl === 'medium' ? ' class="on"' : '') + '>Medium</span>' +
            '<span' + (lvl === 'high' ? ' class="on"' : '') + '>High</span>' +
          '</div>' +

          (signals.length
            ? '<div class="risk-sig__title">감지된 신호</div>' +
              signals.map(function (s) {
                return '<div class="risk-sig">' +
                  '<div class="risk-sig__name">⚠ ' + s[0] + '</div>' +
                  '<div class="risk-sig__desc">' + s[1] + '</div>' +
                '</div>';
              }).join('')
            : '<p class="od-muted" style="margin:0;">특별히 감지된 신호가 없습니다.</p>') +

          '<div class="risk-sig__foot">' +
            '위험도가 높다고 <b>반드시 사기인 것은 아니고</b>, 낮다고 안전한 것도 아닙니다. ' +
            '배송지·청구지·연락처를 직접 확인하고 판단하세요.' +
          '</div>' +
        '</div>' +
        '<div class="modal-card__foot">' +
          '<button class="btn-sm" data-close>닫기</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(box);

    box.addEventListener('click', function (ev) {
      if (ev.target === box || ev.target.closest('[data-close]')) box.remove();
    });
  }

  // 헤더 옆 리스크 뱃지 — Low 는 표시하지 않는다
  function riskBadge(o) {
    if (o.risk === 'high') return '<span class="risk-badge high">⚠ High risk</span>';
    if (o.risk === 'medium') return '<span class="risk-badge med">⚠ Medium risk</span>';
    return '';
  }

  function riskBar(o) {
    var lvl = o.risk || 'low';
    var pct = lvl === 'high' ? 100 : (lvl === 'medium' ? 60 : 28);
    var color = lvl === 'high' ? '#e03131' : (lvl === 'medium' ? '#f59e0b' : '#1aab5b');
    var text = lvl === 'high'
      ? '차지백 위험이 높습니다. 발주하기 전에 주문을 검토하세요.'
      : lvl === 'medium'
        ? '차지백 위험이 보통입니다. 발주하기 전에 주문을 검토하세요.'
        : '차지백 위험이 낮습니다. 발주해도 됩니다.';
    return '<div class="od-card">' +
      '<div class="od-card__head od-card__head--icon">Order risk' +
        '<button class="risk-info" id="btnRisk" title="위험 신호 자세히 보기">🔍</button>' +
      '</div>' +
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
        badges(o) + riskBadge(o) +
        '<div class="od-top__actions">' +
          (o.payment === 'refunded'
            ? '<button class="btn-sm" disabled>환불 완료</button>'
            : '<button class="btn-sm is-danger" id="btnRefund">환불하기 (주문 취소)</button>') +
          '<button class="btn-sm" id="btnEdit">주문 편집하기</button>' +
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
            stockBox(o) +
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
        '</div>' +
      '</div>';

    // TODO: 실제 발주 처리(정산·성적) 연결 — 지금은 상태만 바뀜
    var f = document.getElementById('btnFulfill');
    if (f) f.addEventListener('click', function () {
      alert('발주 처리 동작은 다음 단계에서 붙입니다.');
    });

    var e = document.getElementById('btnEdit');
    if (e) e.addEventListener('click', function () {
      location.href = 'order-edit.html?no=' + encodeURIComponent(o.no);
    });

    var r = document.getElementById('btnRefund');
    if (r) r.addEventListener('click', function () { openRefund(o); });

    var rk = document.getElementById('btnRisk');
    if (rk) rk.addEventListener('click', function () { openRiskDetail(o); });

    // 고객에게 문의 → 답장이 도착 (이미 정해져 있던 답장이 드러남)
    var a = document.getElementById('btnAsk');
    if (a) a.addEventListener('click', function () {
      o.replied = true;
      o.repliedAt = Date.now();
      saveOrder(o);
      render(o);
    });

    bindZoom(o);
  }

  /* ---------- 환불하기 (주문 취소) ----------
     사기 주문을 걸러내거나, 품절이라 발주할 수 없을 때 쓰는 동작.
     결제 상태가 Refunded 로 바뀌고 목록에서 취소선이 그어진다. */
  function openRefund(o) {
    var box = document.createElement('div');
    box.className = 'modal-overlay is-open';
    box.innerHTML =
      '<div class="modal-card">' +
        '<div class="modal-card__head">' +
          '<h3>환불하기 (주문 취소)</h3>' +
          '<button class="modal-close" data-close>×</button>' +
        '</div>' +
        '<div class="modal-card__body">' +
          '<p style="margin:0 0 16px;font-size:0.9rem;line-height:1.6;">' +
            '<b>' + esc(o.no) + '</b> 주문을 취소하고 고객에게 전액 환불합니다.<br>' +
            '<span class="od-muted">이 주문은 발주하지 않습니다.</span></p>' +
          '<table class="od-money" style="margin-bottom:16px;">' +
            '<tr><td>환불 금액</td><td></td><td class="r">' + money(o.grandTotal) + '</td></tr>' +
          '</table>' +
          '<div class="field">' +
            '<label>환불 사유</label>' +
            '<select id="refundReason" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:0.88rem;">' +
              '<option value="fraud">사기 의심 주문 (차지백 위험)</option>' +
              '<option value="oos">상품 품절 · 단종으로 발주 불가</option>' +
              '<option value="no_ship">배송 불가 지역</option>' +
              '<option value="etc">기타 (고객 요청 등)</option>' +
            '</select>' +
          '</div>' +
          '<p style="margin:14px 0 0;font-weight:700;font-size:0.9rem;">정말로 환불하시겠습니까?</p>' +
        '</div>' +
        '<div class="modal-card__foot">' +
          '<button class="btn-sm" data-close>취소</button>' +
          '<button class="btn-sm is-danger" id="refundGo">환불하기</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(box);

    function close() { box.remove(); }
    box.addEventListener('click', function (ev) {
      if (ev.target === box || ev.target.closest('[data-close]')) close();
    });

    box.querySelector('#refundGo').addEventListener('click', function () {
      o.payment = 'refunded';
      o.fulfillment = 'not_required';    // 발주하지 않는 주문
      o.refundReason = box.querySelector('#refundReason').value;
      o.refundedAt = Date.now();
      saveOrder(o);
      close();
      render(o);                         // 화면 갱신 (뱃지가 Refunded 로 바뀜)
    });
  }

  /* ---------- 사진 크게 보기 (여러 장이면 넘겨보기) ---------- */
  var zoomReady = false;

  function bindZoom(o) {
    current = o;                 // 갤러리가 참조할 현재 주문
    if (zoomReady) return;       // 화면을 다시 그려도 이벤트는 한 번만 건다
    zoomReady = true;

    var box = document.createElement('div');
    box.className = 'img-zoom';
    box.innerHTML =
      '<button class="img-zoom__close" aria-label="닫기">×</button>' +
      '<button class="img-zoom__nav prev" aria-label="이전">‹</button>' +
      '<img class="img-zoom__img" src="" alt="">' +
      '<button class="img-zoom__nav next" aria-label="다음">›</button>' +
      '<div class="img-zoom__cap"></div>' +
      '<div class="img-zoom__thumbs"></div>';
    document.body.appendChild(box);

    var imgEl = box.querySelector('.img-zoom__img');
    var capEl = box.querySelector('.img-zoom__cap');
    var thumbsEl = box.querySelector('.img-zoom__thumbs');
    var prevBtn = box.querySelector('.prev');
    var nextBtn = box.querySelector('.next');

    var gallery = [];   // 현재 열려 있는 상품의 사진들
    var name = '';
    var idx = 0;

    function show(i) {
      if (!gallery.length) return;
      idx = (i + gallery.length) % gallery.length;   // 끝에서 넘기면 처음으로
      imgEl.src = gallery[idx];
      capEl.textContent = name + (gallery.length > 1 ? '  (' + (idx + 1) + ' / ' + gallery.length + ')' : '');
      thumbsEl.querySelectorAll('img').forEach(function (t, n) {
        t.classList.toggle('on', n === idx);
      });
    }

    function open(line) {
      gallery = (line.images && line.images.length) ? line.images : (line.image ? [line.image] : []);
      if (!gallery.length) return;
      name = line.name;

      var multi = gallery.length > 1;
      prevBtn.hidden = nextBtn.hidden = !multi;
      thumbsEl.hidden = !multi;
      thumbsEl.innerHTML = multi
        ? gallery.map(function (src, n) {
            return '<img src="' + esc(src) + '" data-i="' + n + '" alt="">';
          }).join('')
        : '';

      show(0);
      box.classList.add('is-open');
    }
    function close() {
      box.classList.remove('is-open');
      imgEl.src = '';
      gallery = [];
    }

    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('.is-zoom');
      if (trigger) {
        var line = ((current && current.lines) || [])[Number(trigger.dataset.line)];
        if (line) open(line);
        return;
      }
      if (!box.classList.contains('is-open')) return;

      if (e.target.closest('.img-zoom__nav')) {           // 화살표
        e.stopPropagation();
        show(idx + (e.target.closest('.next') ? 1 : -1));
        return;
      }
      var thumb = e.target.closest('.img-zoom__thumbs img');
      if (thumb) { e.stopPropagation(); show(Number(thumb.dataset.i)); return; }
      if (e.target.closest('.img-zoom')) close();         // 배경이나 × 를 누르면 닫힘
    });

    document.addEventListener('keydown', function (e) {
      if (!box.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') show(idx + 1);
      if (e.key === 'ArrowLeft') show(idx - 1);
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
