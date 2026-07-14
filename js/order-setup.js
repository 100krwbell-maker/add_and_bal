/* =========================================================
   발주 연습 세팅
   - 주제 목록은 어드민이 등록한 products 의 topic 에서 자동으로 채움
   - 저장하면 practice_settings 에 upsert → 발주 연습하기가 이 값으로 주문 시나리오를 생성
   - 저장 시 이전 연습 주문(localStorage)은 초기화 (새 시나리오이므로)
   ========================================================= */
(function () {
  var topicSel = document.getElementById('topic');
  var marginEl = document.getElementById('margin');
  var countEl = document.getElementById('count');
  var levelEl = document.getElementById('level');
  var startBtn = document.getElementById('startBtn');
  var savedEl = document.getElementById('saved');

  var user = null;

  async function loadTopics() {
    var res = await sb.from('products').select('topic').eq('active', true);
    if (res.error) { topicSel.innerHTML = '<option value="">주제를 불러오지 못했습니다</option>'; return; }

    var seen = {};
    (res.data || []).forEach(function (r) { if (r.topic) seen[r.topic] = true; });
    var list = Object.keys(seen).sort();

    if (!list.length) {
      topicSel.innerHTML = '<option value="">등록된 주제가 없습니다 (관리자 문의)</option>';
      startBtn.disabled = true;
      return;
    }
    topicSel.innerHTML = '<option value="">선택하세요</option>' + list.map(function (t) {
      return '<option>' + t + '</option>';
    }).join('');
  }

  async function loadSettings() {
    var res = await sb.from('practice_settings').select('*').eq('user_id', user.id).maybeSingle();
    var s = res.data;
    if (!s) return;
    topicSel.value = s.topic || '';
    marginEl.value = s.margin != null ? s.margin : '';
    countEl.value = s.order_count || '';
    levelEl.value = s.level || '';
  }

  startBtn.addEventListener('click', async function () {
    var topic = topicSel.value;
    var margin = parseFloat(marginEl.value);
    var count = parseInt(countEl.value, 10);
    var level = levelEl.value;

    if (!topic) { alert('주제를 선택하세요.'); return; }
    if (!isFinite(margin)) { alert('설정 마진을 입력하세요.'); return; }
    if (!count || count < 1) { alert('받을 주문 건수를 입력하세요.'); return; }
    if (!level) { alert('난이도를 선택하세요.'); return; }

    startBtn.disabled = true;
    var res = await sb.from('practice_settings').upsert({
      user_id: user.id,
      topic: topic,
      margin: margin,
      order_count: count,
      level: level,
      updated_at: new Date().toISOString(),
    });
    startBtn.disabled = false;

    if (res.error) { alert('저장 실패: ' + res.error.message); return; }

    // 새 시나리오이므로 이전 연습 주문은 버림
    localStorage.removeItem('practice_orders');
    localStorage.removeItem('practice_nextno');
    localStorage.removeItem('practice_plan');

    savedEl.hidden = false;
    location.href = 'order-practice.html';
  });

  (async function init() {
    user = await Auth.require();
    if (!user) return;
    await loadTopics();
    await loadSettings();
  })();
})();
