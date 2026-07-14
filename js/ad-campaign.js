/* =========================================================
   캠페인 만들기 (쇼피파이 Create campaign 재현)
   - 광고 설정하기 → [Create campaign] → ad-campaign.html

   [핵심 개념]
   CAC (고객 획득 비용) = 고객 한 명을 데려오는 데 쓰는 광고비
   TOV (목표 객단가)    = 주문 한 건에서 기대하는 매출
   ROAS = 매출 / 광고비 ≈ TOV / CAC

   → CAC 를 객단가보다 높게 잡으면 ROAS 가 1 밑으로 떨어진다 = 팔수록 손해.
     수강생이 이걸 몸으로 알게 하는 게 이 화면의 목적이다.
   ========================================================= */
(function () {
  var STORE = 'ad_campaigns';
  // 이탈 고객은 기간별로 따로 걸 수 있다 (1~12개월)
  var TERMS = [];
  for (var m = 1; m <= 12; m++) TERMS.push(m + (m === 1 ? ' month' : ' months'));

  /* 세그먼트 우선순위 목록 (전체 고객은 항상 있으므로 여기 없음)
     - new    : 신규 고객 (하나만)
     - lapsed : 이탈 고객 (기간별로 여러 개 가능 — 3개월 이탈과 6개월 이탈에 다른 비용) */
  var segs = [
    { type: 'new', cac: 0 },
    { type: 'lapsed', term: '3 months', cac: 0 },
  ];

  function usedTerms() {
    return segs.filter(function (s) { return s.type === 'lapsed'; })
      .map(function (s) { return s.term; });
  }
  function freeTerms() {
    var used = usedTerms();
    return TERMS.filter(function (t) { return used.indexOf(t) === -1; });
  }

  /* ---------- 세그먼트 줄 그리기 ---------- */
  function renderSegs() {
    document.getElementById('segBox').hidden = !segs.length;

    document.getElementById('segRows').innerHTML = segs.map(function (s, i) {
      var name = s.type === 'new' ? '신규 고객 (New customers)' : '이탈 고객 (Lapsed customers)';
      var term = s.type === 'lapsed'
        ? '<select class="cac-row__term" data-term="' + i + '">' +
            TERMS.map(function (t) {
              // 다른 줄이 이미 쓰는 기간은 고를 수 없다
              var taken = usedTerms().indexOf(t) !== -1 && t !== s.term;
              return '<option' + (t === s.term ? ' selected' : '') +
                (taken ? ' disabled' : '') + '>' + t + '</option>';
            }).join('') +
          '</select>'
        : '';
      return '<div class="cac-row">' +
        '<span class="cac-row__ico">👤</span>' +
        '<span class="cac-row__name">' + name + '</span>' +
        term +
        '<span class="cac-row__input">' +
          '<span class="cac-row__unit">$</span>' +
          '<input type="number" step="0.01" min="0" value="' + s.cac + '" data-cac="' + i + '">' +
        '</span>' +
        '<button class="cac-row__del" data-del="' + i + '" title="빼기">×</button>' +
      '</div>';
    }).join('');

    // 추가 칩 — 신규 고객은 하나만, 이탈 고객은 남은 기간이 있으면 계속 추가 가능
    var chips = [];
    if (!segs.some(function (s) { return s.type === 'new'; })) {
      chips.push('<button class="adv-chip adv-chip--add" data-add="new">+ 신규 고객</button>');
    }
    if (freeTerms().length) {
      chips.push('<button class="adv-chip adv-chip--add" data-add="lapsed">+ 이탈 고객</button>');
    }
    document.getElementById('segAdd').innerHTML = chips.join('');
  }

  function money(n) { return '$' + Number(n || 0).toFixed(2); }
  function num(id) { return parseFloat(document.getElementById(id).value) || 0; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function round2(n) { return Math.round(n * 100) / 100; }
  function randF(a, b) { return Math.random() * (b - a) + a; }
  function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

  /* ---------- 현재 입력값 ---------- */
  function read() {
    var cacs = [{ name: '전체 고객', value: num('cacAll') }];
    segs.forEach(function (s) {
      cacs.push({
        name: s.type === 'new' ? '신규 고객' : '이탈 고객 · ' + s.term,
        value: s.cac,
      });
    });
    var avg = cacs.reduce(function (a, c) { return a + c.value; }, 0) / cacs.length;

    return {
      name: document.getElementById('cname').value.trim(),
      country: document.getElementById('country').value,
      tov: num('tov'),
      budget: num('budget'),
      cacs: cacs,
      avgCac: round2(avg),
      channels: channels(),
    };
  }

  // 켜져 있는 노출 채널
  function channels() {
    return Array.prototype.slice
      .call(document.querySelectorAll('[data-ch].is-on'))
      .map(function (b) { return b.dataset.ch; });
  }

  /* ---------- 광고 미리보기 ----------
     어드민이 등록한 실제 상품 중에서 무작위로 골라 광고 소재로 보여준다.
     상품이 수천 개일 수 있으므로 전부 받지 않고, 임의의 구간만 잘라와 그 안에서 섞는다. */
  var pool = [];

  async function loadProducts() {
    var c = await sb.from('products')
      .select('id', { count: 'exact', head: true })
      .eq('active', true);
    var total = c.count || 0;
    if (!total) { pool = []; return; }

    var span = 60;
    var offset = Math.max(0, Math.floor(Math.random() * Math.max(1, total - span)));
    var res = await sb.from('products')
      .select('name, image_url, cost')
      .eq('active', true)
      .range(offset, offset + span - 1);

    pool = (res.data || []).filter(function (p) { return p.image_url; });
  }

  function renderPreview() {
    var box = document.getElementById('advImgs');
    if (!pool.length) {
      box.innerHTML = '<span class="adv-preview__ph">등록된 상품이 없습니다</span>';
      return;
    }
    // 매번 다른 상품 2개
    var a = pool.slice();
    var pick = [];
    for (var i = 0; i < 2 && a.length; i++) {
      pick.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
    }
    box.innerHTML = pick.map(function (p) {
      // 광고에 보이는 가격은 판매가 → 원가에 마진을 붙인 값
      var price = Number(p.cost || 0) * 1.3;
      return '<span class="adv-preview__item">' +
        '<img src="' + esc(p.image_url) + '" alt="">' +
        '<span class="adv-preview__name">' + esc(String(p.name).slice(0, 42)) + '</span>' +
        '<span class="adv-preview__price">' + money(price) + '</span>' +
      '</span>';
    }).join('');
  }

  document.getElementById('advShuffle').addEventListener('click', renderPreview);

  /* ---------- 일정 (달력) ---------- */
  var today = new Date().toISOString().slice(0, 10);
  var sched = { start: today, end: null, now: true };   // now = 지금 바로 시작

  function fmtK(iso) {
    var d = new Date(iso + 'T00:00:00');
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }
  function schedLabel() {
    if (sched.now && !sched.end) return '📅 지금 시작';
    var s = sched.now ? '지금' : fmtK(sched.start);
    return '📅 ' + s + (sched.end ? ' → ' + fmtK(sched.end) : ' 부터');
  }
  function renderSched() {
    document.getElementById('schedChip').textContent = schedLabel();
  }

  function openSchedule() {
    var box = document.createElement('div');
    box.className = 'modal-overlay is-open';
    box.innerHTML =
      '<div class="modal-card" style="max-width:420px;">' +
        '<div class="modal-card__head">' +
          '<h3>일정 설정</h3>' +
          '<button class="modal-close" data-close>×</button>' +
        '</div>' +
        '<div class="modal-card__body">' +
          '<label style="display:flex;gap:8px;align-items:center;margin-bottom:16px;font-size:0.88rem;">' +
            '<input type="checkbox" id="sNow"' + (sched.now ? ' checked' : '') + '> 지금 바로 시작' +
          '</label>' +
          '<div class="field">' +
            '<label>시작일</label>' +
            '<input type="date" id="sStart" value="' + sched.start + '" min="' + today + '"' +
              (sched.now ? ' disabled' : '') + '>' +
          '</div>' +
          '<div class="field">' +
            '<label>종료일 (비우면 계속 진행)</label>' +
            '<input type="date" id="sEnd" value="' + (sched.end || '') + '" min="' + today + '">' +
          '</div>' +
          '<div id="sErr" style="color:var(--danger);font-size:0.82rem;"></div>' +
        '</div>' +
        '<div class="modal-card__foot">' +
          '<button class="btn-sm" data-close>취소</button>' +
          '<button class="btn-sm is-dark" id="sGo">적용</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(box);

    box.addEventListener('click', function (e) {
      if (e.target === box || e.target.closest('[data-close]')) box.remove();
    });
    box.querySelector('#sNow').addEventListener('change', function () {
      var st = box.querySelector('#sStart');
      st.disabled = this.checked;
      if (this.checked) st.value = today;
    });
    box.querySelector('#sGo').addEventListener('click', function () {
      var now = box.querySelector('#sNow').checked;
      var start = now ? today : box.querySelector('#sStart').value;
      var end = box.querySelector('#sEnd').value || null;

      if (!start) { box.querySelector('#sErr').textContent = '시작일을 고르세요.'; return; }
      if (end && end < start) { box.querySelector('#sErr').textContent = '종료일이 시작일보다 빠릅니다.'; return; }

      sched = { start: start, end: end, now: now };
      box.remove();
      renderSched();
    });
  }

  document.getElementById('schedChip').addEventListener('click', openSchedule);

  /* ---------- 예상 ROAS ----------
     매출/광고비 ≈ 객단가/획득비용. 실제로는 오차가 있으므로 범위로 보여준다. */
  function roasRange(s) {
    if (!s.avgCac) return [0, 0];
    var base = s.tov / s.avgCac;
    return [round2(base * 0.85), round2(base * 1.15)];
  }

  /* ---------- 요약 다시 그리기 ---------- */
  function refresh() {
    var s = read();
    var r = roasRange(s);

    document.getElementById('sTov').textContent = money(s.tov);
    document.getElementById('sCac').textContent = money(s.avgCac);
    document.getElementById('sSegs').innerHTML = s.cacs.map(function (c) {
      return '<div class="adv-seg"><span>' + c.name + '</span><b>' + money(c.value) + '</b></div>';
    }).join('');
    document.getElementById('sRoas').textContent = r[0].toFixed(1) + 'x - ' + r[1].toFixed(1) + 'x';
    document.getElementById('sChannels').textContent = s.channels.join(' · ');

    // 획득 비용이 객단가에 가깝거나 넘으면 광고를 돌릴수록 손해
    var warn = document.getElementById('sWarn');
    if (!s.tov || !s.avgCac) { warn.innerHTML = ''; }
    else if (s.avgCac >= s.tov) {
      warn.innerHTML = '<div class="adv-warn danger">⚠ 고객 한 명을 데려오는 비용(' + money(s.avgCac) +
        ')이 객단가(' + money(s.tov) + ')보다 큽니다. <b>팔수록 손해입니다.</b></div>';
    } else if (r[1] < 2) {
      warn.innerHTML = '<div class="adv-warn">⚠ 예상 ROAS가 2배 미만입니다. 원가와 배송비를 빼면 남는 게 거의 없습니다.</div>';
    } else {
      warn.innerHTML = '';
    }
  }

  /* ---------- 세그먼트 추가 / 삭제 / 수정 ---------- */
  // 채널 칩 켜고 끄기 (최소 하나는 켜져 있어야 함)
  document.addEventListener('click', function (e) {
    var ch = e.target.closest('[data-ch]');
    if (ch) {
      if (ch.classList.contains('is-on') && channels().length === 1) {
        alert('채널은 최소 하나를 선택해야 합니다.');
        return;
      }
      ch.classList.toggle('is-on');
      refresh();
    }
  });

  document.addEventListener('click', function (e) {
    var del = e.target.closest('[data-del]');
    if (del) {
      segs.splice(Number(del.dataset.del), 1);
      renderSegs();
      refresh();
      return;
    }
    var add = e.target.closest('[data-add]');
    if (add) {
      if (add.dataset.add === 'new') {
        segs.unshift({ type: 'new', cac: 0 });
      } else {
        var t = freeTerms()[0];                        // 아직 안 쓴 기간을 자동으로 잡아줌
        if (!t) return;
        segs.push({ type: 'lapsed', term: t, cac: 0 });
      }
      renderSegs();
      refresh();
    }
  });

  // 세그먼트 줄의 금액/기간 변경
  document.getElementById('segRows').addEventListener('input', function (e) {
    var cac = e.target.closest('[data-cac]');
    if (cac) {
      segs[Number(cac.dataset.cac)].cac = parseFloat(cac.value) || 0;
      refresh();
    }
  });
  document.getElementById('segRows').addEventListener('change', function (e) {
    var term = e.target.closest('[data-term]');
    if (term) {
      segs[Number(term.dataset.term)].term = term.value;
      renderSegs();   // 다른 줄의 선택 가능 기간이 달라지므로 다시 그림
      refresh();
    }
  });

  ['cacAll', 'tov', 'budget', 'country', 'cname'].forEach(function (id) {
    var el = document.getElementById(id);
    el.addEventListener('input', refresh);
    el.addEventListener('change', refresh);
  });

  document.getElementById('resetBtn').addEventListener('click', function () {
    document.getElementById('cacAll').value = 0;
    document.getElementById('tov').value = 0;
    document.getElementById('budget').value = 0;
    segs = [
      { type: 'new', cac: 0 },
      { type: 'lapsed', term: '3 months', cac: 0 },
    ];
    renderSegs();
    refresh();
  });

  // 금액 박스는 어디를 눌러도 숫자 입력으로 포커스가 간다
  document.addEventListener('click', function (e) {
    var box = e.target.closest('.cac-row__input');
    if (box && e.target.tagName !== 'INPUT') box.querySelector('input').focus();
  });

  /* ---------- 캠페인 시작 ----------
     설정값대로 성과가 나온다: 예상 ROAS 범위 안에서 실제 ROAS 가 결정됨 */
  document.getElementById('startBtn').addEventListener('click', function () {
    var s = read();
    if (!s.name) { alert('캠페인 이름을 입력하세요.'); return; }
    if (!s.budget) { alert('일 예산을 입력하세요.'); return; }
    if (!s.tov) { alert('목표 객단가를 입력하세요.'); return; }

    var r = roasRange(s);
    if (s.avgCac >= s.tov &&
        !confirm('획득 비용이 객단가보다 큽니다. 이대로 시작하면 광고를 돌릴수록 손해입니다.\n\n그래도 시작할까요?')) {
      return;
    }

    // 집행 일수: 종료일이 있으면 그 기간, 없으면 지금까지 며칠 돌았다고 가정
    var days = sched.end
      ? Math.max(1, Math.round((new Date(sched.end) - new Date(sched.start)) / 86400000))
      : randInt(4, 12);
    days = Math.min(days, 30);

    var spend = round2(s.budget * days * randF(0.85, 1.05));
    var roas = round2(randF(r[0], r[1]));
    var sales = round2(spend * roas);
    var aov = round2(s.tov * randF(0.92, 1.08));
    var customers = Math.max(1, Math.round(sales / aov));

    var c = {
      id: Date.now(),
      name: s.name,
      budget: s.budget,
      country: s.country,
      segment: 'All',
      tov: s.tov,
      cacs: s.cacs,
      channels: s.channels,
      start: sched.start,
      end: sched.end,
      status: (sched.end && sched.end <= today) ? 'completed' : 'active',
      spend: spend,
      sales: sales,
      roas: roas,
      aov: aov,
      customers: customers,
      cac: round2(spend / customers),
      alert: roas < 3 ? 'TOV' : null,
    };

    var list = [];
    try { list = JSON.parse(localStorage.getItem(STORE)) || []; } catch (e) { list = []; }
    list.unshift(c);
    localStorage.setItem(STORE, JSON.stringify(list));

    location.href = 'ad-settings.html';
  });

  (async function init() {
    var user = await Auth.require();
    if (!user) return;

    // 다음 캠페인 번호를 이름 기본값으로
    var list = [];
    try { list = JSON.parse(localStorage.getItem(STORE)) || []; } catch (e) { list = []; }
    document.getElementById('cname').value =
      '새 캠페인 ' + String(list.length + 1).padStart(2, '0');

    renderSegs();
    renderSched();
    refresh();

    await loadProducts();
    renderPreview();
  })();
})();
