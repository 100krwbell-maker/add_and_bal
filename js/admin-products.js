/* =========================================================
   어드민 · 상품 관리
   - 주제(topics 테이블)를 먼저 등록 → 수강생 세팅 드롭다운에 그대로 보임
   - 상품(products)은 반드시 등록된 주제에 속함
   - 가져오기: CSV/TSV 파일 또는 엑셀 복사-붙여넣기
     · 컬럼이 몇 개든 상관없음 → 헤더를 읽어 "어느 컬럼이 상품명/원가인지" 직접 연결
     · 쇼피파이 export처럼 한 상품이 여러 줄이면 그룹 컬럼(Handle)으로 합침
     · 많은 행은 500개씩 끊어서 저장
   - 삭제: 개별 / 선택(체크박스) / 주제 통째로
   - 판매가는 저장하지 않는다 → 판매가 = 원가 × (1 + 설정마진/100), 주문 생성 시점 계산
   ========================================================= */
(function () {
  var CHUNK = 500;
  var LIST_LIMIT = 300;   // 목록은 최근 300개만 표시 (상품이 수천 개일 수 있음)
  var MAX_IMAGES = 8;     // 상품 하나당 저장할 사진 수 상한

  var topics = [];        // [{id, name, active, count}]
  var products = [];      // 목록에 보이는 상품 (전체가 아님)
  var dupeNames = {};     // 가져올 주제에 이미 있는 상품명
  var table = null;       // 읽어들인 파일 { header, rows }
  var pending = [];       // 등록 대기 행

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function money(n) { return '$' + Number(n || 0).toFixed(2); }
  function num(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : NaN;
  }

  /* =======================================================
     주제
     ======================================================= */
  async function loadTopics() {
    var res = await sb.from('topics').select('*').order('name');
    if (res.error) { alert('주제를 불러오지 못했습니다: ' + res.error.message); return; }
    topics = res.data || [];

    // 주제별 상품 수 (행을 다 받지 않고 개수만 세어옴)
    await Promise.all(topics.map(async function (t) {
      var c = await sb.from('products')
        .select('id', { count: 'exact', head: true })
        .eq('topic', t.name);
      t.count = c.count || 0;
    }));

    renderTopics();
    fillTopicSelects();
  }

  function renderTopics() {
    var body = document.getElementById('topicBody');
    if (!topics.length) {
      body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:30px;">' +
        '주제가 없습니다. 위에서 주제를 먼저 추가하세요.</td></tr>';
      return;
    }
    body.innerHTML = topics.map(function (t) {
      return '<tr' + (t.active ? '' : ' style="opacity:0.45;"') + '>' +
        '<td style="font-weight:700;">' + esc(t.name) + '</td>' +
        '<td>' + t.count + '개</td>' +
        '<td><button class="btn-sm" data-tact="toggle" data-id="' + t.id + '">' +
          (t.active ? '표시중' : '숨김') + '</button></td>' +
        '<td><span class="btn-group">' +
          '<button class="btn-sm is-danger" data-tact="clear" data-id="' + t.id + '">상품 전체 삭제</button>' +
          '<button class="btn-sm is-danger" data-tact="del" data-id="' + t.id + '">주제 삭제</button>' +
        '</span></td>' +
      '</tr>';
    }).join('');
  }

  function fillTopicSelects() {
    var opts = '<option value="">주제를 고르세요</option>' + topics.map(function (t) {
      return '<option value="' + esc(t.name) + '">' + esc(t.name) + ' (' + t.count + '개)</option>';
    }).join('');

    ['fTopic', 'sTopic'].forEach(function (id) {
      var el = document.getElementById(id);
      var cur = el.value;
      el.innerHTML = opts;
      el.value = cur;
    });

    var f = document.getElementById('topicFilter');
    var curF = f.value;
    f.innerHTML = '<option value="">전체 주제</option>' + topics.map(function (t) {
      return '<option value="' + esc(t.name) + '">' + esc(t.name) + ' (' + t.count + '개)</option>';
    }).join('');
    f.value = curF;
  }

  document.getElementById('addTopicBtn').addEventListener('click', async function () {
    var input = document.getElementById('newTopic');
    var msg = document.getElementById('topicMsg');
    var name = input.value.trim();
    if (!name) { msg.textContent = '주제 이름을 입력하세요.'; return; }

    var res = await sb.from('topics').insert({ name: name });
    if (res.error) {
      msg.textContent = res.error.code === '23505' ? '이미 있는 주제입니다.' : '추가 실패: ' + res.error.message;
      return;
    }
    input.value = '';
    msg.textContent = '"' + name + '" 추가됨';
    await loadTopics();
  });

  document.getElementById('topicBody').addEventListener('click', async function (e) {
    var btn = e.target.closest('button[data-tact]');
    if (!btn) return;
    var t = topics.find(function (x) { return x.id === Number(btn.dataset.id); });
    if (!t) return;

    if (btn.dataset.tact === 'toggle') {
      var r = await sb.from('topics').update({ active: !t.active }).eq('id', t.id);
      if (r.error) { alert('변경 실패: ' + r.error.message); return; }
      await loadTopics();
      return;
    }

    if (btn.dataset.tact === 'clear') {
      if (!t.count) { alert('이 주제에는 상품이 없습니다.'); return; }
      if (!confirm('정말로 삭제하시겠습니까?\n\n"' + t.name + '" 주제의 상품 ' + t.count + '개가 모두 삭제됩니다.\n되돌릴 수 없습니다.')) return;
      var d = await sb.from('products').delete().eq('topic', t.name);
      if (d.error) { alert('삭제 실패: ' + d.error.message); return; }
      await refresh();
      return;
    }

    if (btn.dataset.tact === 'del') openDelModal(t);
  });

  /* ---------- 주제 삭제 모달 (상품을 다른 주제로 옮길 수 있음) ---------- */
  var delModal = document.getElementById('delModal');
  var moveTarget = document.getElementById('moveTarget');
  var moveNewTopic = document.getElementById('moveNewTopic');
  var delTarget = null;   // 삭제하려는 주제

  var NEW_TOPIC = '__new__';

  function delMode() {
    var r = document.querySelector('input[name="delMode"]:checked');
    return r ? r.value : 'move';
  }

  function openDelModal(t) {
    delTarget = t;
    document.getElementById('delTopicName').textContent = '"' + t.name + '"';
    document.getElementById('delTopicCount').textContent = t.count
      ? '이 주제에는 상품이 ' + t.count + '개 있습니다.'
      : '이 주제에는 상품이 없습니다.';
    document.getElementById('delError').textContent = '';

    // 상품이 없으면 옮길 것도 없으므로 선택지를 감춘다
    var hasProducts = t.count > 0;
    document.getElementById('moveBox').hidden = !hasProducts;

    var others = topics.filter(function (x) { return x.id !== t.id; });
    moveTarget.innerHTML = others.map(function (x) {
      return '<option value="' + esc(x.name) + '">' + esc(x.name) + ' (' + x.count + '개)</option>';
    }).join('') + '<option value="' + NEW_TOPIC + '">+ 새 주제 만들기</option>';
    moveTarget.value = others.length ? others[0].name : NEW_TOPIC;
    moveNewTopic.value = '';
    moveNewTopic.hidden = moveTarget.value !== NEW_TOPIC;

    // 옮길 주제가 하나도 없으면 '새 주제 만들기'만 가능
    document.querySelector('input[name="delMode"][value="move"]').checked = hasProducts;
    document.querySelector('input[name="delMode"][value="delete"]').checked = !hasProducts;

    delModal.classList.add('is-open');
  }

  function closeDelModal() {
    delModal.classList.remove('is-open');
    delTarget = null;
  }

  moveTarget.addEventListener('change', function () {
    moveNewTopic.hidden = this.value !== NEW_TOPIC;
    document.querySelector('input[name="delMode"][value="move"]').checked = true;
    if (!moveNewTopic.hidden) moveNewTopic.focus();
  });
  moveNewTopic.addEventListener('input', function () {
    document.querySelector('input[name="delMode"][value="move"]').checked = true;
  });

  delModal.addEventListener('click', function (e) {
    if (e.target === delModal || e.target.closest('[data-close]')) closeDelModal();
  });

  document.getElementById('delConfirm').addEventListener('click', async function () {
    if (!delTarget) return;
    var t = delTarget;
    var err = document.getElementById('delError');
    var btn = this;
    err.textContent = '';

    var moving = t.count > 0 && delMode() === 'move';
    var dest = null;

    if (moving) {
      dest = moveTarget.value === NEW_TOPIC ? moveNewTopic.value.trim() : moveTarget.value;
      if (!dest) { err.textContent = '옮길 주제 이름을 입력하세요.'; return; }
      if (dest === t.name) { err.textContent = '같은 주제로는 옮길 수 없습니다.'; return; }
    } else if (t.count > 0) {
      if (!confirm('정말로 삭제하시겠습니까?\n\n"' + t.name + '" 주제와 상품 ' + t.count + '개가 모두 삭제됩니다.\n되돌릴 수 없습니다.')) return;
    }

    btn.disabled = true;
    try {
      if (moving) {
        // 새 주제면 먼저 만든다 (이미 있으면 그냥 통과)
        if (moveTarget.value === NEW_TOPIC) {
          var ct = await sb.from('topics').insert({ name: dest });
          if (ct.error && ct.error.code !== '23505') throw new Error('새 주제 생성 실패: ' + ct.error.message);
        }
        var mv = await sb.from('products').update({ topic: dest }).eq('topic', t.name);
        if (mv.error) throw new Error('상품 이동 실패: ' + mv.error.message);
      } else if (t.count > 0) {
        var dp = await sb.from('products').delete().eq('topic', t.name);
        if (dp.error) throw new Error('상품 삭제 실패: ' + dp.error.message);
      }

      var dt = await sb.from('topics').delete().eq('id', t.id);
      if (dt.error) throw new Error('주제 삭제 실패: ' + dt.error.message);

      closeDelModal();
      await refresh();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  /* =======================================================
     파일 읽기 (구분자 자동 판별 + 따옴표/줄바꿈 처리)
     ======================================================= */
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
    return { header: rows[0].map(function (h) { return String(h).trim(); }), rows: rows.slice(1) };
  }

  /* ---------- 컬럼 자동 추측 ---------- */
  var GUESS = {
    group: ['handle', 'group', 'sku', 'asin', '핸들'],
    name: ['title', 'name', 'product name', 'product', 'item', '상품명', '제품명', '이름'],
    cost: ['cost per item', 'variant price', 'cost', 'price', 'unit price', '원가', '단가', '가격', '구매가'],
    image: ['image src', 'image_url', 'image url', 'image', 'img', 'thumbnail', 'photo', '이미지', '사진'],
    source: ['source_url', 'product url', 'url', 'link', '링크', '주소'],
  };
  function guessColumn(header, kind) {
    var low = header.map(function (h) { return h.toLowerCase().trim(); });
    var cands = GUESS[kind];
    for (var i = 0; i < cands.length; i++) {
      var hit = low.indexOf(cands[i]);
      if (hit !== -1) return hit;
    }
    for (var j = 0; j < low.length; j++) {
      for (var k = 0; k < cands.length; k++) {
        if (low[j].indexOf(cands[k]) !== -1) return j;
      }
    }
    return -1;
  }
  // 쇼피파이는 'Cost per item' 이 비어있는 경우가 많음 → 값이 실제로 채워진 컬럼을 고른다
  function guessCostColumn(t) {
    var cands = ['cost per item', 'variant price', 'cost', 'price', '원가', '단가'];
    var low = t.header.map(function (h) { return h.toLowerCase().trim(); });
    var best = -1;
    for (var c = 0; c < cands.length; c++) {
      var i = low.indexOf(cands[c]);
      if (i === -1) continue;
      if (best === -1) best = i;
      var filled = t.rows.some(function (r) { var v = num(r[i]); return isFinite(v) && v > 0; });
      if (filled) return i;
    }
    return best !== -1 ? best : guessColumn(t.header, 'cost');
  }

  var mapEls = {
    group: document.getElementById('mapGroup'),
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
      var g = kind === 'cost' ? guessCostColumn(table) : guessColumn(table.header, kind);
      mapEls[kind].value = String(g !== -1 ? g : (required ? 0 : -1));
    });

    // 한 상품이 여러 줄인가? (그룹 컬럼은 찼는데 상품명이 빈 줄이 있으면 그렇다)
    var gi = parseInt(mapEls.group.value, 10);
    var ni = parseInt(mapEls.name.value, 10);
    var multiRow = gi >= 0 && table.rows.some(function (r) {
      return String(r[gi] || '').trim() && !String(r[ni] || '').trim();
    });
    document.getElementById('groupNote').hidden = !multiRow;
    if (!multiRow) mapEls.group.value = '-1';
    document.getElementById('mapBox').hidden = false;
  }

  /* ---------- 매핑 적용 ---------- */
  function applyMapping() {
    var warn = document.getElementById('previewWarn');
    var topic = document.getElementById('fTopic').value;
    if (!table) { pending = []; renderPreview(); return; }
    if (!topic) {
      pending = []; renderPreview();
      warn.textContent = '어느 주제에 넣을지 먼저 고르세요.';
      return;
    }

    var iGroup = parseInt(mapEls.group.value, 10);
    var iName = parseInt(mapEls.name.value, 10);
    var iCost = parseInt(mapEls.cost.value, 10);
    var iImage = parseInt(mapEls.image.value, 10);
    var iSource = parseInt(mapEls.source.value, 10);
    var cell = function (r, i) { return i >= 0 ? String(r[i] == null ? '' : r[i]).trim() : ''; };

    // 줄들을 상품 단위로 모은다 (그룹 컬럼이 있으면 같은 값끼리 하나로)
    // 쇼피파이 export는 추가 이미지가 아래 줄들에 있으므로, 그 줄들의 사진을 모두 모은다
    var items = [], byKey = {};
    table.rows.forEach(function (r) {
      var gk = iGroup >= 0 ? cell(r, iGroup) : null;
      var item = gk ? byKey[gk] : null;
      if (!item) {
        item = { name: '', cost: NaN, images: [], source: '' };
        items.push(item);
        if (gk) byKey[gk] = item;
      }
      if (!item.name) item.name = cell(r, iName);
      if (!isFinite(item.cost)) {
        var c = num(cell(r, iCost));
        if (isFinite(c) && c > 0) item.cost = c;
      }
      var img = cell(r, iImage);
      if (img && item.images.indexOf(img) === -1 && item.images.length < MAX_IMAGES) {
        item.images.push(img);
      }
      if (!item.source) item.source = cell(r, iSource);
    });

    var skipDupe = document.getElementById('skipDupe').checked;
    var seen = {}, bad = 0, dupe = 0;
    pending = [];

    items.forEach(function (it) {
      if (!it.name || !isFinite(it.cost)) { bad++; return; }
      var key = it.name.toLowerCase();
      if (seen[key] || (skipDupe && dupeNames[key])) { dupe++; return; }
      seen[key] = true;
      pending.push({
        topic: topic,
        name: it.name,
        cost: it.cost,
        image_url: it.images[0] || null,   // 대표 사진
        images: it.images,                 // 전체 사진 (상세 화면에서 넘겨보기)
        source_url: it.source || null,
      });
    });

    renderPreview();
    var notes = [];
    if (iGroup >= 0) {
      var imgTotal = pending.reduce(function (a, p) { return a + p.images.length; }, 0);
      notes.push(table.rows.length + '줄 → 상품 ' + items.length + '개로 합쳤습니다 (사진 ' + imgTotal + '장).');
    }
    if (bad) notes.push(bad + '개는 상품명 또는 원가가 없어 제외했습니다.');
    if (dupe) notes.push(dupe + '개는 이미 있는 상품이라 건너뜁니다.');
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
      var extra = p.images && p.images.length > 1
        ? '<span class="prod-imgcount">+' + (p.images.length - 1) + '</span>' : '';
      var img = p.image_url
        ? '<img class="prod-thumb" src="' + esc(p.image_url) + '" alt="">' + extra
        : '<span class="prod-thumb prod-thumb--empty">?</span>';
      return '<tr>' +
        '<td style="white-space:nowrap;">' + img + '</td>' +
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
    msg.textContent = table.rows.length + '줄을 읽었습니다.';
    fillMapSelects();
    applyMapping();
  }

  document.getElementById('fCsv').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    document.getElementById('uploadMsg').textContent = '파일 읽는 중...';
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

  // 가져올 주제가 바뀌면 그 주제의 기존 상품명을 받아온다 (중복 건너뛰기용)
  document.getElementById('fTopic').addEventListener('change', async function () {
    dupeNames = {};
    var topic = this.value;
    if (topic) {
      var res = await sb.from('products').select('name').eq('topic', topic).limit(20000);
      (res.data || []).forEach(function (p) { dupeNames[String(p.name).trim().toLowerCase()] = true; });
    }
    applyMapping();
  });
  document.getElementById('skipDupe').addEventListener('change', applyMapping);
  Object.keys(mapEls).forEach(function (k) { mapEls[k].addEventListener('change', applyMapping); });

  /* ---------- 등록 (500개씩) ---------- */
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
        await refresh();
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
    await refresh();
  });

  /* ---------- 상품 하나만 추가 ---------- */
  document.getElementById('addBtn').addEventListener('click', async function () {
    var row = {
      topic: document.getElementById('sTopic').value,
      name: document.getElementById('sName').value.trim(),
      image_url: document.getElementById('sImage').value.trim() || null,
      cost: parseFloat(document.getElementById('sCost').value) || 0,
    };
    if (!row.topic) { alert('주제를 고르세요.'); return; }
    if (!row.name) { alert('상품명을 입력하세요.'); return; }
    var res = await sb.from('products').insert(row);
    if (res.error) { alert('추가 실패: ' + res.error.message); return; }
    ['sName', 'sImage', 'sCost'].forEach(function (id) { document.getElementById(id).value = ''; });
    var msg = document.getElementById('addMsg');
    msg.hidden = false;
    setTimeout(function () { msg.hidden = true; }, 2000);
    await refresh();
  });

  /* =======================================================
     상품 목록 + 삭제
     ======================================================= */
  var filter = document.getElementById('topicFilter');

  async function loadProducts() {
    var q = sb.from('products').select('*').order('created_at', { ascending: false }).limit(LIST_LIMIT);
    if (filter.value) q = q.eq('topic', filter.value);
    var res = await q;
    if (res.error) { alert('상품을 불러오지 못했습니다: ' + res.error.message); return; }
    products = res.data || [];
    renderProducts();
  }

  function totalCount() {
    if (filter.value) {
      var t = topics.find(function (x) { return x.name === filter.value; });
      return t ? t.count : 0;
    }
    return topics.reduce(function (a, t) { return a + (t.count || 0); }, 0);
  }

  function renderProducts() {
    var total = totalCount();
    document.getElementById('pCount').textContent = total ? '(' + total + '개)' : '';
    document.getElementById('checkAll').checked = false;
    document.getElementById('delSelBtn').disabled = true;

    var note = document.getElementById('listNote');
    note.textContent = total > products.length
      ? '최근 ' + products.length + '개만 보여줍니다 (전체 ' + total + '개). 주제 단위로 지우려면 위 주제 관리의 [상품 전체 삭제]를 쓰세요.'
      : '';

    if (!products.length) {
      document.getElementById('prodBody').innerHTML =
        '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:40px;">' +
        '등록된 상품이 없습니다.</td></tr>';
      return;
    }
    document.getElementById('prodBody').innerHTML = products.map(function (p) {
      var img = p.image_url
        ? '<img class="prod-thumb" src="' + esc(p.image_url) + '" alt="">'
        : '<span class="prod-thumb prod-thumb--empty">?</span>';
      return '<tr' + (p.active ? '' : ' style="opacity:0.45;"') + '>' +
        '<td><input type="checkbox" class="rowCheck" data-id="' + p.id + '"></td>' +
        '<td>' + img + '</td>' +
        '<td>' + esc(p.topic || '-') + '</td>' +
        '<td style="text-align:left;max-width:340px;">' + esc(p.name) + '</td>' +
        '<td>' + money(p.cost) + '</td>' +
        '<td><button class="btn-sm" data-act="toggle" data-id="' + p.id + '">' +
          (p.active ? '사용중' : '중지') + '</button></td>' +
        '<td><button class="btn-sm is-danger" data-act="del" data-id="' + p.id + '">삭제</button></td>' +
      '</tr>';
    }).join('');
  }

  function checkedIds() {
    return Array.prototype.slice
      .call(document.querySelectorAll('.rowCheck:checked'))
      .map(function (c) { return Number(c.dataset.id); });
  }

  filter.addEventListener('change', loadProducts);

  document.getElementById('checkAll').addEventListener('change', function () {
    var on = this.checked;
    document.querySelectorAll('.rowCheck').forEach(function (c) { c.checked = on; });
    document.getElementById('delSelBtn').disabled = !checkedIds().length;
  });

  document.getElementById('prodBody').addEventListener('change', function (e) {
    if (e.target.classList.contains('rowCheck')) {
      document.getElementById('delSelBtn').disabled = !checkedIds().length;
    }
  });

  document.getElementById('delSelBtn').addEventListener('click', async function () {
    var ids = checkedIds();
    if (!ids.length) return;
    if (!confirm('정말로 삭제하시겠습니까?\n\n선택한 상품 ' + ids.length + '개가 삭제됩니다.')) return;
    var d = await sb.from('products').delete().in('id', ids);
    if (d.error) { alert('삭제 실패: ' + d.error.message); return; }
    await refresh();
  });

  document.getElementById('prodBody').addEventListener('click', async function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var id = Number(btn.dataset.id);
    var p = products.find(function (x) { return x.id === id; });
    if (!p) return;

    if (btn.dataset.act === 'toggle') {
      var res = await sb.from('products').update({ active: !p.active }).eq('id', id);
      if (res.error) { alert('변경 실패: ' + res.error.message); return; }
      await loadProducts();
      return;
    }
    if (btn.dataset.act === 'del') {
      if (!confirm('정말로 삭제하시겠습니까?\n\n"' + p.name + '"')) return;
      var d = await sb.from('products').delete().eq('id', id);
      if (d.error) { alert('삭제 실패: ' + d.error.message); return; }
      await refresh();
    }
  });

  async function refresh() {
    await loadTopics();
    await loadProducts();
  }

  (async function init() {
    var admin = await Auth.requireAdmin();
    if (!admin) return;
    await refresh();
  })();
})();
