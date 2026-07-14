/* =========================================================
   어드민 · 상품 관리
   - 주제(topic)별 상품 카탈로그. 수강생은 세팅에서 주제를 골라 그 상품들로 발주 연습함
   - 가져오기: CSV/TSV 파일 또는 엑셀에서 그대로 복사-붙여넣기
     · 컬럼이 몇 개든 상관없음 → 헤더를 읽어서 "어느 컬럼이 상품명/원가인지" 직접 연결
     · 같은 주제에 여러 번 나눠 올릴 수 있음 (중복 상품명은 건너뛰기 옵션)
     · 많은 행은 500개씩 끊어서 저장
   - 판매가는 저장하지 않는다 → 판매가 = 원가 × (1 + 설정마진/100), 주문 생성 시점 계산
   ========================================================= */
(function () {
  var CHUNK = 500;

  var products = [];   // 이미 등록된 상품
  var table = null;    // 방금 읽어들인 파일: { header: [...], rows: [[...]] }
  var pending = [];    // 매핑 적용 후 등록 대기 행

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function money(n) { return '$' + Number(n || 0).toFixed(2); }

  /* ---------- 구분자 자동 판별 + 파싱 (따옴표 안의 구분자/줄바꿈까지 처리) ---------- */
  function sniffDelim(text) {
    var line = text.split('\n')[0];
    var counts = { ',': 0, '\t': 0, ';': 0 };
    var q = false;
    for (var i = 0; i < line.length; i++) {
      if (line[i] === '"') q = !q;
      else if (!q && counts[line[i]] !== undefined) counts[line[i]]++;
    }
    return Object.keys(counts).reduce(function (best, d) {
      return counts[d] > counts[best] ? d : best;
    }, ',');
  }

  function parseTable(text) {
    text = text.replace(/^﻿/, '');   // 엑셀 BOM 제거
    var d = sniffDelim(text);
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === d) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim(); }); });
    if (rows.length < 2) return null;
    return {
      header: rows[0].map(function (h) { return String(h).trim(); }),
      rows: rows.slice(1),
    };
  }

  /* ---------- 컬럼 자동 추측 ---------- */
  var GUESS = {
    name: ['name', 'title', 'product', 'product name', 'item', '상품명', '제품명', '이름'],
    cost: ['cost', 'price', 'unit price', 'buy price', '원가', '단가', '가격', '구매가'],
    image: ['image_url', 'image', 'img', 'image url', 'thumbnail', 'photo', '이미지', '사진'],
    source: ['source_url', 'url', 'link', 'product url', '링크', '주소'],
  };
  function guessColumn(header, kind) {
    var low = header.map(function (h) { return h.toLowerCase(); });
    var cands = GUESS[kind];
    for (var i = 0; i < cands.length; i++) {
      var hit = low.indexOf(cands[i]);
      if (hit !== -1) return hit;
    }
    // 정확히 일치하는 게 없으면 부분 일치
    for (var j = 0; j < low.length; j++) {
      for (var k = 0; k < cands.length; k++) {
        if (low[j].indexOf(cands[k]) !== -1) return j;
      }
    }
    return -1;
  }

  var mapEls = {
    name: document.getElementById('mapName'),
    cost: document.getElementById('mapCost'),
    image: document.getElementById('mapImage'),
    source: document.getElementById('mapSource'),
  };

  function fillMapSelects() {
    Object.keys(mapEls).forEach(function (kind) {
      var required = (kind === 'name' || kind === 'cost');
      var opts = (required ? '' : '<option value="-1">(사용 안 함)</option>') +
        table.header.map(function (h, i) {
          return '<option value="' + i + '">' + esc(h || '(빈 컬럼 ' + (i + 1) + ')') + '</option>';
        }).join('');
      mapEls[kind].innerHTML = opts;
      var g = guessColumn(table.header, kind);
      mapEls[kind].value = String(g !== -1 ? g : (required ? 0 : -1));
    });
    document.getElementById('mapBox').hidden = false;
  }

  function num(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : NaN;
  }

  // 매핑 + 주제 + 중복 규칙을 적용해 등록할 행을 만든다
  function applyMapping() {
    var warn = document.getElementById('previewWarn');
    var topic = document.getElementById('fTopic').value.trim();
    if (!table) { pending = []; renderPreview(); return; }
    if (!topic) {
      pending = [];
      renderPreview();
      warn.textContent = '주제를 먼저 입력하세요.';
      return;
    }

    var iName = parseInt(mapEls.name.value, 10);
    var iCost = parseInt(mapEls.cost.value, 10);
    var iImage = parseInt(mapEls.image.value, 10);
    var iSource = parseInt(mapEls.source.value, 10);

    var skipDupe = document.getElementById('skipDupe').checked;
    var existing = {};
    products.forEach(function (p) {
      if (p.topic === topic) existing[String(p.name).trim().toLowerCase()] = true;
    });

    var seen = {}, bad = 0, dupe = 0;
    pending = [];

    table.rows.forEach(function (r) {
      var name = String(r[iName] == null ? '' : r[iName]).trim();
      var cost = num(r[iCost]);
      if (!name || !isFinite(cost)) { bad++; return; }

      var key = name.toLowerCase();
      if (seen[key] || (skipDupe && existing[key])) { dupe++; return; }
      seen[key] = true;

      pending.push({
        topic: topic,
        name: name,
        cost: cost,
        image_url: iImage >= 0 ? (String(r[iImage] || '').trim() || null) : null,
        source_url: iSource >= 0 ? (String(r[iSource] || '').trim() || null) : null,
      });
    });

    renderPreview();
    var notes = [];
    if (bad) notes.push(bad + '줄은 상품명 또는 원가를 읽을 수 없어 제외했습니다.');
    if (dupe) notes.push(dupe + '줄은 이미 있는 상품명이라 건너뜁니다.');
    warn.textContent = notes.join(' ');
  }

  function renderPreview() {
    var box = document.getElementById('preview');
    var btn = document.getElementById('uploadBtn');
    if (!pending.length) {
      box.hidden = true;
      btn.disabled = true;
      document.getElementById('previewBody').innerHTML = '';
      return;
    }
    box.hidden = false;
    btn.disabled = false;
    document.getElementById('previewCount').textContent =
      '(' + pending.length + '개' + (pending.length > 50 ? ' 중 앞 50개' : '') + ')';
    document.getElementById('previewBody').innerHTML = pending.slice(0, 50).map(function (p) {
      var img = p.image_url
        ? '<img class="prod-thumb" src="' + esc(p.image_url) + '" alt="">'
        : '<span class="prod-thumb prod-thumb--empty">?</span>';
      return '<tr>' +
        '<td>' + img + '</td>' +
        '<td style="white-space:normal;">' + esc(p.name) + '</td>' +
        '<td>' + money(p.cost) + '</td>' +
        '<td>' + (p.source_url ? '<a href="' + esc(p.source_url) + '" target="_blank">링크</a>' : '-') + '</td>' +
      '</tr>';
    }).join('');
  }

  /* ---------- 파일 / 붙여넣기 입력 ---------- */
  function loadText(text) {
    var msg = document.getElementById('uploadMsg');
    table = parseTable(text);
    if (!table) {
      msg.textContent = '헤더 1줄 + 데이터가 필요합니다. 내용을 읽지 못했습니다.';
      document.getElementById('mapBox').hidden = true;
      pending = [];
      renderPreview();
      return;
    }
    msg.textContent = table.rows.length + '줄을 읽었습니다. 컬럼을 연결하세요.';
    fillMapSelects();
    applyMapping();
  }

  document.getElementById('fCsv').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { loadText(String(reader.result)); };
    reader.onerror = function () {
      document.getElementById('uploadMsg').textContent =
        '파일을 읽지 못했습니다. 엑셀에서 복사해 붙여넣기를 사용해보세요.';
    };
    reader.readAsText(file, 'utf-8');
  });

  document.getElementById('pasteBtn').addEventListener('click', function () {
    var text = document.getElementById('pasteText').value;
    if (!text.trim()) { document.getElementById('uploadMsg').textContent = '붙여넣은 내용이 없습니다.'; return; }
    loadText(text);
  });

  document.getElementById('fTopic').addEventListener('input', applyMapping);
  document.getElementById('skipDupe').addEventListener('change', applyMapping);
  Object.keys(mapEls).forEach(function (k) { mapEls[k].addEventListener('change', applyMapping); });

  /* ---------- 등록 (500개씩 나눠 저장) ---------- */
  document.getElementById('uploadBtn').addEventListener('click', async function () {
    if (!pending.length) return;
    var btn = this;
    var msg = document.getElementById('uploadMsg');
    btn.disabled = true;

    var done = 0;
    for (var i = 0; i < pending.length; i += CHUNK) {
      var slice = pending.slice(i, i + CHUNK);
      msg.textContent = '등록 중... ' + done + ' / ' + pending.length;
      var res = await sb.from('products').insert(slice);
      if (res.error) {
        msg.textContent = done + '개까지 등록됨. 이후 실패: ' + res.error.message;
        btn.disabled = false;
        await load();
        return;
      }
      done += slice.length;
    }

    msg.textContent = done + '개 등록되었습니다.';
    pending = [];
    table = null;
    document.getElementById('fCsv').value = '';
    document.getElementById('pasteText').value = '';
    document.getElementById('mapBox').hidden = true;
    renderPreview();
    await load();
  });

  /* ---------- 상품 하나만 추가 ---------- */
  document.getElementById('addBtn').addEventListener('click', async function () {
    var row = {
      topic: document.getElementById('sTopic').value.trim(),
      name: document.getElementById('sName').value.trim(),
      image_url: document.getElementById('sImage').value.trim() || null,
      cost: parseFloat(document.getElementById('sCost').value) || 0,
    };
    if (!row.topic || !row.name) { alert('주제와 상품명은 필수입니다.'); return; }
    var res = await sb.from('products').insert(row);
    if (res.error) { alert('추가 실패: ' + res.error.message); return; }
    ['sName', 'sImage', 'sCost'].forEach(function (id) { document.getElementById(id).value = ''; });
    var msg = document.getElementById('addMsg');
    msg.hidden = false;
    setTimeout(function () { msg.hidden = true; }, 2000);
    await load();
  });

  /* ---------- 목록 ---------- */
  var filter = document.getElementById('topicFilter');

  function topicList() {
    var seen = {};
    products.forEach(function (p) { if (p.topic) seen[p.topic] = (seen[p.topic] || 0) + 1; });
    return Object.keys(seen).sort().map(function (t) { return { name: t, count: seen[t] }; });
  }

  function renderTopics() {
    var list = topicList();
    document.getElementById('topicList').innerHTML = list.map(function (t) {
      return '<option value="' + esc(t.name) + '">';
    }).join('');
    var cur = filter.value;
    filter.innerHTML = '<option value="">전체 주제</option>' + list.map(function (t) {
      return '<option value="' + esc(t.name) + '">' + esc(t.name) + ' (' + t.count + ')</option>';
    }).join('');
    filter.value = cur;
  }

  function render() {
    renderTopics();
    var shown = filter.value
      ? products.filter(function (p) { return p.topic === filter.value; })
      : products;

    document.getElementById('pCount').textContent = shown.length ? '(' + shown.length + '개)' : '';
    if (!shown.length) {
      document.getElementById('prodBody').innerHTML =
        '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:40px;">' +
        '등록된 상품이 없습니다. 위에서 주제별로 상품을 가져오세요.</td></tr>';
      return;
    }
    document.getElementById('prodBody').innerHTML = shown.map(function (p) {
      var img = p.image_url
        ? '<img class="prod-thumb" src="' + esc(p.image_url) + '" alt="">'
        : '<span class="prod-thumb prod-thumb--empty">?</span>';
      return '<tr' + (p.active ? '' : ' style="opacity:0.45;"') + '>' +
        '<td>' + img + '</td>' +
        '<td>' + esc(p.topic || '-') + '</td>' +
        '<td style="text-align:left;max-width:340px;">' + esc(p.name) + '</td>' +
        '<td>' + money(p.cost) + '</td>' +
        '<td><button class="btn-sm" data-act="toggle" data-id="' + p.id + '">' +
          (p.active ? '사용중' : '중지') + '</button></td>' +
        '<td><button class="btn-link danger" data-act="del" data-id="' + p.id + '">삭제</button></td>' +
      '</tr>';
    }).join('');
  }

  filter.addEventListener('change', render);

  document.getElementById('prodBody').addEventListener('click', async function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var id = Number(btn.dataset.id);
    var p = products.find(function (x) { return x.id === id; });
    if (!p) return;

    if (btn.dataset.act === 'toggle') {
      var res = await sb.from('products').update({ active: !p.active }).eq('id', id);
      if (res.error) { alert('변경 실패: ' + res.error.message); return; }
      await load();
      return;
    }
    if (btn.dataset.act === 'del') {
      if (!confirm('"' + p.name + '" 을 삭제할까요?')) return;
      var d = await sb.from('products').delete().eq('id', id);
      if (d.error) { alert('삭제 실패: ' + d.error.message); return; }
      await load();
    }
  });

  async function load() {
    var res = await sb.from('products').select('*')
      .order('topic').order('created_at', { ascending: false }).limit(5000);
    if (res.error) { alert('상품을 불러오지 못했습니다: ' + res.error.message); return; }
    products = res.data || [];
    render();
  }

  (async function init() {
    var admin = await Auth.requireAdmin();
    if (!admin) return;
    await load();
  })();
})();
