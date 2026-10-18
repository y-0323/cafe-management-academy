// ===== UI =====
(function () {
  const E = window.Engine;
  const C = E.CONFIG;
  const SAVE_KEY = 'cafe-mba-save-v1';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  let state = load() || E.initialState();
  let pending = null; // 決算直後の { result, next }
  let quizScore = loadQuiz();

  // ---------- フォーマッタ ----------
  const yen = (n) => (n < 0 ? '−' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
  const man = (n) => {
    const v = Math.round(n / 10000);
    return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('ja-JP') + '万円';
  };
  const num = (n) => Math.round(n).toLocaleString('ja-JP');
  const pct = (n, d = 0) => (n * 100).toFixed(d) + '%';
  const periodName = (q) => `${Math.floor(q / 4) + 1}年目 ${C.seasons[q % 4]}`;
  const signClass = (n) => (n < 0 ? 'neg' : 'pos');

  // ---------- 保存 ----------
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ state, quizScore })); } catch (e) { /* 保存できない環境でも遊べる */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw).state : null;
    } catch (e) { return null; }
  }
  function loadQuiz() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return (raw && JSON.parse(raw).quizScore) || { correct: 0, total: 0 };
    } catch (e) { return { correct: 0, total: 0 }; }
  }

  // ---------- フォーム ----------
  const form = $('#decision-form');

  function buildStatic() {
    $('#quality-group').innerHTML = C.qualities.map((ql) => `
      <label class="quality">
        <input type="radio" name="quality" value="${ql.id}">
        <span class="q-card">
          <span class="q-name">${ql.name}</span>
          <span class="q-desc">${ql.desc}</span>
          <span class="q-meta">原価 <b data-cost="${ql.id}"></b>／適正価格 ¥${ql.ref}</span>
        </span>
      </label>`).join('');
    $('#glossary').innerHTML = window.GLOSSARY.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }

  function fillSelect(el, max, value) {
    const opts = [];
    for (let v = 0; v <= max; v += 500000) opts.push(`<option value="${v}">${v === 0 ? 'なし' : man(v)}</option>`);
    el.innerHTML = opts.join('');
    el.value = String(Math.min(value, max - (max % 500000)));
  }

  function setForm(d) {
    form.price.value = d.price;
    form.purchase.value = d.purchase;
    form.staff.value = d.staff;
    form.ad.value = d.ad;
    $$('input[name=quality]').forEach((r) => { r.checked = +r.value === d.quality; });
    form.renovate.checked = false;
    form.renovate.disabled = state.renovated;
    $('#renovate-wrap').classList.toggle('done', state.renovated);
    if (state.renovated) $('#renovate-wrap span').innerHTML = '<b>改装済み</b>（席数 17,000杯分/期）';
    fillSelect(form.borrow, Math.max(0, C.maxLoan - state.loan), 0);
    fillSelect(form.repay, state.loan, 0);
  }

  function readForm() {
    const q = $$('input[name=quality]').find((r) => r.checked);
    return {
      price: +form.price.value,
      quality: q ? +q.value : 1,
      purchase: +form.purchase.value,
      staff: +form.staff.value,
      ad: +form.ad.value,
      renovate: form.renovate.checked,
      borrow: +form.borrow.value,
      repay: +form.repay.value,
    };
  }

  // ---------- 画面描画 ----------
  function renderStatus() {
    const equity = state.capital + state.retained;
    const assets = state.cash + state.equipment;
    const items = [
      ['期', state.finished ? '経営終了' : `${periodName(state.q)}（${state.q + 1}/${C.quarters}）`],
      ['現金', man(state.cash), state.cash < 1500000 ? 'warn' : ''],
      ['借入金', man(state.loan)],
      ['純資産', man(equity), equity < state.capital ? 'warn' : ''],
      ['自己資本比率', pct(equity / assets)],
      ['評判', meter(state.reputation, 0.6, 1.4)],
      ['認知度', meter(state.awareness, 0, 1)],
    ];
    $('#status').innerHTML = items.map(([k, v, cls]) => `<div class="stat ${cls || ''}"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
  }

  function meter(v, lo, hi) {
    const r = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    return `<span class="meter"><span style="width:${(r * 100).toFixed(0)}%"></span></span><span class="meter-n">${Math.round(r * 100)}</span>`;
  }

  function renderEvent() {
    const ev = E.EVENTS[state.q];
    const m = E.modifiers(state.q);
    const ongoing = [];
    if (m.costMult > 1 && !(ev && ev.id === 'beans')) ongoing.push('原材料費 +20%（豆価格高騰）');
    if (m.competitor && !(ev && ev.id === 'competitor')) ongoing.push('大手チェーンと競合中');
    if (m.wageMult > 1 && !(ev && ev.id === 'wage')) ongoing.push('人件費 +10%');
    if (m.marketMult > 1 && !(ev && ev.id === 'office')) ongoing.push('市場規模 +15%');
    let html = '';
    if (ev) html += `<div class="event"><span class="event-tag">NEWS</span><div><b>${ev.title}</b><p>${ev.body}</p></div></div>`;
    if (ongoing.length) html += `<div class="ongoing">継続中の環境：${ongoing.join(' ／ ')}</div>`;
    $('#event-banner').innerHTML = html;
  }

  function renderForm() {
    const d = readForm();
    $('#price-out').textContent = yen(d.price);
    $('#staff-out').textContent = d.staff + '人';
    $('#ad-out').textContent = man(d.ad);
    C.qualities.forEach((ql) => { const el = document.querySelector(`[data-cost="${ql.id}"]`); if (el) el.textContent = '¥' + E.unitCost(ql.id, state.q); });
    const ref = C.qualities[d.quality].ref;
    const ratio = d.price / ref;
    $('#price-hint').innerHTML = `「${C.qualities[d.quality].name}」の適正価格 ¥${ref} に対して <b>${pct(ratio)}</b>。` +
      (ratio > 1.3 ? '<span class="neg">高すぎて評判が下がります</span>' : ratio < 0.85 ? '割安感で客は増えますが、1杯の利益は薄くなります' : '');
    $('#staff-hint').textContent = `人件費 ${man(d.staff * E.staffCost(state.q))}/期、処理能力 ${num(d.staff * C.staffCapacity)}杯/期`;
    const last = state.history[state.history.length - 1];
    $('#purchase-hint').innerHTML = last
      ? `前期の需要：<b>${num(last.demand)}杯</b>（販売 ${num(last.sold)}杯／廃棄 ${num(last.wasteUnits)}杯）。季節は「${C.seasons[state.q % 4]}」（係数 ${C.seasonFactor[state.q % 4]}）`
      : `初期の需要は1万杯前後が目安。季節は「${C.seasons[state.q % 4]}」`;
    renderDashboard(d);
  }

  function renderDashboard(d) {
    const p = E.preview(state, d);
    const cap = p.cap.capacity;
    const bepOk = p.bep <= Math.min(cap, p.d.purchase);
    const scale = Math.max(cap, p.d.purchase, isFinite(p.bep) ? p.bep : 0, 1) * 1.1;
    const pos = (v) => Math.min(100, (v / scale) * 100).toFixed(1) + '%';
    const warnings = [];
    if (p.cm <= 0) warnings.push(['bad', '売価が原価を下回っています。売るほど赤字です。']);
    else if (p.bep > cap) warnings.push(['bad', `損益分岐点（${num(p.bep)}杯）が処理能力（${num(cap)}杯）を超えています。満席でも赤字です。`]);
    else if (p.bep > p.d.purchase) warnings.push(['bad', `仕入数が損益分岐点（${num(p.bep)}杯）より少なく、全部売れても赤字です。`]);
    if (p.d.purchase > cap) warnings.push(['warn', `仕入数が処理能力（${num(cap)}杯）を超えています。超過分は確実に廃棄になります。`]);
    if (p.worstCash < 0) warnings.push(['warn', `売上ゼロなら期末現金は ${man(p.worstCash)}。資金ショートのリスクに注意。`]);
    if (p.cap.staffCap > p.cap.seats) warnings.push(['warn', `スタッフの能力が席数（${num(p.cap.seats)}杯）を超え、余剰人員が出ます。`]);

    $('#dashboard').innerHTML = `
      <div class="kpis">
        <div class="kpi"><span class="k">1杯の限界利益</span><span class="v ${signClass(p.cm)}">${yen(p.cm)}</span><span class="s">限界利益率 ${pct(p.cmRate)}</span></div>
        <div class="kpi"><span class="k">固定費（今期）</span><span class="v">${man(p.fixed)}</span><span class="s">人件費・家賃・広告・償却・利息</span></div>
        <div class="kpi"><span class="k">損益分岐点</span><span class="v ${bepOk ? '' : 'neg'}">${isFinite(p.bep) ? num(p.bep) + '杯' : '到達不能'}</span><span class="s">${isFinite(p.bep) ? '売上 ' + man(p.bepSales) : ''}</span></div>
      </div>
      <div class="bep-bar" aria-label="損益分岐点と処理能力の比較">
        <div class="track">
          <div class="zone-loss" style="width:${isFinite(p.bep) ? pos(p.bep) : '100%'}"></div>
          <div class="mark cap" style="left:${pos(cap)}"><span>処理能力 ${num(cap)}</span></div>
          <div class="mark buy" style="left:${pos(p.d.purchase)}"><span>仕入 ${num(p.d.purchase)}</span></div>
          ${isFinite(p.bep) ? `<div class="mark bep" style="left:${pos(p.bep)}"><span>分岐点 ${num(p.bep)}</span></div>` : ''}
        </div>
        <div class="legend"><span class="lg loss"></span>赤字ゾーン <span class="lg profit"></span>黒字ゾーン</div>
      </div>
      <table class="mini">
        <tr><th>仕入代金</th><td>${man(p.purchaseCash)}</td><th>処理能力</th><td>${num(cap)}杯 <small>(${p.cap.staffCap < p.cap.seats ? 'スタッフが上限' : '席数が上限'})</small></td></tr>
        <tr><th>減価償却費</th><td>${man(p.dep)}</td><th>支払利息</th><td>${man(p.interest)}</td></tr>
      </table>
      ${warnings.map(([c, t]) => `<p class="alert ${c}">${t}</p>`).join('')}
    `;
  }

  function renderChart() {
    const h = state.history;
    if (!h.length) {
      $('#chart').innerHTML = '<p class="empty">最初の決算後にグラフが表示されます。</p>';
      $('#last-summary').innerHTML = '';
      return;
    }
    const W = 520, H = 200, P = { l: 48, r: 12, t: 14, b: 26 };
    const series = [
      { key: 'revenue', name: '売上高', get: (r) => r.pl.revenue, cls: 's1' },
      { key: 'op', name: '営業利益', get: (r) => r.pl.operating, cls: 's2' },
      { key: 'cash', name: '現金残高', get: (r) => r.bs.cash, cls: 's3' },
    ];
    const vals = h.flatMap((r) => series.map((s) => s.get(r))).concat([0]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const span = hi - lo || 1; lo -= span * 0.05; hi += span * 0.05;
    const x = (i) => P.l + (C.quarters <= 1 ? 0 : (i / (C.quarters - 1)) * (W - P.l - P.r));
    const y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
    const ticks = 4;
    let grid = '';
    for (let i = 0; i <= ticks; i++) {
      const v = lo + ((hi - lo) * i) / ticks;
      grid += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${P.l - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${Math.round(v / 10000)}万</text>`;
    }
    grid += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(0)}" y2="${y(0)}" class="zero"/>`;
    let xl = '';
    for (let i = 0; i < C.quarters; i += 1) xl += `<text x="${x(i)}" y="${H - 8}" class="axis" text-anchor="middle">${i % 4 === 0 ? (i / 4 + 1) + '年' : ''}</text>`;
    const lines = series.map((s) => {
      const pts = h.map((r, i) => `${x(i).toFixed(1)},${y(s.get(r)).toFixed(1)}`).join(' ');
      const dots = h.map((r, i) => `<circle cx="${x(i)}" cy="${y(s.get(r))}" r="3" class="${s.cls}"><title>${periodName(i)} ${s.name}: ${man(s.get(r))}</title></circle>`).join('');
      return `<polyline points="${pts}" class="line ${s.cls}"/>${dots}`;
    }).join('');
    $('#chart').innerHTML = `
      <div class="chart-legend">${series.map((s) => `<span><i class="${s.cls}"></i>${s.name}</span>`).join('')}</div>
      <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="業績推移グラフ">${grid}${xl}${lines}</svg>`;

    const r = h[h.length - 1];
    $('#last-summary').innerHTML = `
      <table class="mini">
        <tr><th>前期 売上</th><td>${man(r.pl.revenue)}</td><th>営業利益</th><td class="${signClass(r.pl.operating)}">${man(r.pl.operating)}</td></tr>
        <tr><th>販売数</th><td>${num(r.sold)}杯</td><th>機会損失</th><td>${num(r.lostCapacity + r.lostStock)}杯</td></tr>
      </table>
      <button class="ghost small" id="btn-reopen">前期の決算書を見る</button>`;
    $('#btn-reopen').onclick = () => openResult(r, false);
  }

  function render() {
    renderStatus();
    $('#period-label').textContent = state.finished ? '' : periodName(state.q);
    renderEvent();
    renderForm();
    renderChart();
    $('#btn-run').disabled = state.finished || state.gameOver;
  }

  // ---------- 講評（メンター） ----------
  function mentorComments(r, prev) {
    const out = [];
    const cm = r.decision.price - r.cost;
    const bep = cm > 0 ? (r.pl.labor + r.pl.rent + r.pl.other + r.pl.ad + r.pl.depreciation + r.pl.interest) / cm : Infinity;
    if (r.lostCapacity > 0) {
      const lost = r.lostCapacity * cm;
      out.push(['warn', 'キャパシティ不足', `処理能力の上限で <b>${num(r.lostCapacity)}杯</b> を売り逃しました（限界利益換算 ${man(lost)}）。ボトルネックは${r.cap.staffCap < r.cap.seats ? 'スタッフ数' : '席数'}です。値上げで需要を利益に変えるか、キャパを増やすかを検討しましょう。`]);
    }
    if (r.lostStock > 0) out.push(['warn', '欠品による機会損失', `仕入不足で <b>${num(r.lostStock)}杯</b> の機会損失（${man(r.lostStock * cm)}）。限界利益 ${yen(cm)} ＞ 原価 ${yen(r.cost)} なら、やや多めに仕入れるほうが期待利益は高くなります。`]);
    const wasteRate = r.decision.purchase ? r.wasteUnits / r.decision.purchase : 0;
    if (wasteRate > 0.08) out.push(['warn', '廃棄ロス', `廃棄率 <b>${pct(wasteRate)}</b>、廃棄損 ${man(r.pl.waste)} が粗利を圧迫しました。前期の需要と季節係数から仕入数を見積もりましょう。`]);
    if (r.pl.operating < 0 && r.sold < bep) out.push(['bad', '損益分岐点に未達', `販売 ${num(r.sold)}杯に対し、損益分岐点は <b>${isFinite(bep) ? num(bep) + '杯' : '到達不能'}</b>。固定費を下げるか、限界利益（価格−原価）を厚くする必要があります。`]);
    if (prev && prev.decision.price !== r.decision.price && prev.demand > 0) {
      const dp = r.decision.price / prev.decision.price - 1;
      const dd = r.demand / prev.demand - 1;
      out.push(['info', '価格変更の効果', `価格を <b>${dp > 0 ? '+' : ''}${pct(dp, 1)}</b> 変えた結果、需要は <b>${dd > 0 ? '+' : ''}${pct(dd, 1)}</b>（季節・評判・競合など他の要因も含む）。売上は ${man(prev.pl.revenue)} → ${man(r.pl.revenue)}。`]);
    }
    if (r.pl.net > 0 && r.cf.end < r.cf.begin) out.push(['info', '黒字なのに現金が減少', `純利益は ${man(r.pl.net)} の黒字ですが、現金は ${man(r.cf.end - r.cf.begin)}。投資CF（${man(r.cf.cfi)}）や財務CF（${man(r.cf.cff)}）を確認しましょう。`]);
    if (r.utilization < 0.65 && r.decision.staff > 1) out.push(['info', '人員に余裕あり', `稼働率は <b>${pct(r.utilization)}</b>。人件費 ${man(r.pl.labor)} に対して処理能力が余っています。スタッフを減らせば固定費が下がります。`]);
    if (r.decision.ad === 0 && r.awareness < 0.25) out.push(['info', '認知度の低下', `広告を止めた結果、認知度は ${pct(r.awareness)} まで低下。ブランドはストックなので、失うと戻すのに時間がかかります。`]);
    if (r.reputation < r.repBefore - 0.02) out.push(['warn', '評判の低下', `評判が下がりました（${Math.round((r.repBefore - 0.6) / 0.8 * 100)} → ${Math.round((r.reputation - 0.6) / 0.8 * 100)}）。売り逃し・混雑・高すぎる価格が主な原因です。`]);
    if (r.compF < 1) out.push(['info', '競合の影響', `大手チェーンの出店で、需要が <b>${pct(1 - r.compF)}</b> 奪われています。品質を上げて差別化するほど影響は小さくなります。`]);
    if (r.pl.operating > 0 && out.length < 2) out.push(['good', '本業で黒字', `営業利益率 <b>${pct(r.pl.operating / r.pl.revenue, 1)}</b>。粗利率 ${pct(r.pl.gross / r.pl.revenue, 1)} を維持しつつ、次の環境変化に備えましょう。`]);
    return out.slice(0, 5);
  }

  // ---------- 決算書 ----------
  function plTable(r) {
    const p = r.pl;
    const row = (k, v, cls = '', note = '') => `<tr class="${cls}"><th>${k}</th><td class="${v < 0 ? 'neg' : ''}">${yen(v)}</td><td class="note">${note}</td></tr>`;
    return `<table class="fs">
      ${row('売上高', p.revenue, 'strong', `${num(r.sold)}杯 × ${yen(r.decision.price)}`)}
      ${row('　売上原価', -p.cogs, '', `${num(r.sold)}杯 × 原価${yen(r.cost)}`)}
      ${row('　廃棄損', -p.waste, '', `${num(r.wasteUnits)}杯分`)}
      ${row('売上総利益（粗利）', p.gross, 'sub', p.revenue ? '粗利率 ' + pct(p.gross / p.revenue, 1) : '')}
      ${row('　人件費', -p.labor, '', `${r.decision.staff}人`)}
      ${row('　家賃', -p.rent)}
      ${row('　水道光熱・雑費', -p.other)}
      ${row('　広告宣伝費', -p.ad)}
      ${row('　減価償却費', -p.depreciation, '', '現金支出なし')}
      ${row('営業利益', p.operating, 'sub', p.revenue ? '営業利益率 ' + pct(p.operating / p.revenue, 1) : '')}
      ${row('　支払利息', -p.interest)}
      ${row('税引前利益', p.pretax, 'sub')}
      ${row('　法人税等', -p.tax, '', p.tax === 0 && p.pretax > 0 ? '繰越欠損金と相殺' : '税率30%')}
      ${row('当期純利益', p.net, 'total')}
    </table>`;
  }

  function bsTable(r) {
    const b = r.bs;
    return `<div class="bs">
      <table class="fs"><caption>資産の部</caption>
        <tr><th>現金</th><td>${yen(b.cash)}</td></tr>
        <tr><th>店舗設備</th><td>${yen(b.equipment)}</td></tr>
        <tr class="total"><th>資産合計</th><td>${yen(b.assets)}</td></tr>
      </table>
      <table class="fs"><caption>負債・純資産の部</caption>
        <tr><th>借入金</th><td>${yen(b.loan)}</td></tr>
        <tr><th>資本金</th><td>${yen(b.capital)}</td></tr>
        <tr><th>利益剰余金</th><td class="${b.retained < 0 ? 'neg' : ''}">${yen(b.retained)}</td></tr>
        <tr class="total"><th>負債・純資産合計</th><td>${yen(b.loan + b.equity)}</td></tr>
      </table>
    </div>
    <div class="ratios">
      <div><span>自己資本比率</span><b>${pct(b.equity / b.assets, 1)}</b></div>
      <div><span>D/Eレシオ</span><b>${(b.loan / Math.max(1, b.equity)).toFixed(2)}倍</b></div>
      <div><span>累計ROE</span><b class="${signClass(b.retained)}">${pct(b.retained / b.capital, 1)}</b></div>
    </div>
    <p class="hint">今期の純利益 ${man(r.pl.net)} が利益剰余金に積み上がりました。資産合計と負債・純資産合計は必ず一致します。</p>`;
  }

  function cfTable(r) {
    const c = r.cf;
    const row = (k, v, cls = '') => `<tr class="${cls}"><th>${k}</th><td class="${v < 0 ? 'neg' : ''}">${yen(v)}</td></tr>`;
    return `<table class="fs">
      ${row('当期純利益', c.net)}
      ${row('　＋ 減価償却費', c.depreciation)}
      ${row('営業キャッシュフロー', c.cfo, 'sub')}
      ${row('　設備投資', -c.capex)}
      ${row('投資キャッシュフロー', c.cfi, 'sub')}
      ${row('　借入', c.borrow)}
      ${row('　返済', -c.repay)}
      ${row('財務キャッシュフロー', c.cff, 'sub')}
      ${row('期首現金', c.begin)}
      ${row('期末現金', c.end, 'total')}
    </table>
    <p class="hint">フリーキャッシュフロー（営業CF＋投資CF）＝ <b class="${signClass(c.cfo + c.cfi)}">${man(c.cfo + c.cfi)}</b>。本業で稼いだ現金から投資を差し引いた、自由に使えるお金です。</p>`;
  }

  function summaryView(r, prev) {
    const comments = mentorComments(r, prev);
    return `
      <div class="result-kpis">
        <div><span>需要</span><b>${num(r.demand)}杯</b></div>
        <div><span>販売</span><b>${num(r.sold)}杯</b></div>
        <div><span>売上高</span><b>${man(r.pl.revenue)}</b></div>
        <div><span>営業利益</span><b class="${signClass(r.pl.operating)}">${man(r.pl.operating)}</b></div>
        <div><span>純利益</span><b class="${signClass(r.pl.net)}">${man(r.pl.net)}</b></div>
        <div><span>期末現金</span><b class="${signClass(r.bs.cash)}">${man(r.bs.cash)}</b></div>
      </div>
      <div class="funnel">
        ${funnelRow('来店希望（需要）', r.demand, r.demand)}
        ${funnelRow('対応できた（処理能力内）', r.demand - r.lostCapacity, r.demand)}
        ${funnelRow('販売できた（在庫あり）', r.sold, r.demand)}
      </div>
      <h3 class="mentor-title">🧑‍🏫 メンターの講評</h3>
      <ul class="mentor">${comments.map(([c, t, b]) => `<li class="${c}"><b>${t}</b><p>${b}</p></li>`).join('')}</ul>`;
  }

  function funnelRow(label, v, max) {
    const w = max ? (v / max) * 100 : 0;
    return `<div class="f-row"><span class="f-label">${label}</span><span class="f-bar"><span style="width:${w.toFixed(1)}%"></span></span><span class="f-v">${num(v)}</span></div>`;
  }

  let resultCtx = null;
  function openResult(r, isNew) {
    resultCtx = r;
    const prev = state.history[r.q - 1] || null;
    $('#result-title').textContent = `${periodName(r.q)} 決算`;
    $('#result-chip').textContent = r.pl.net >= 0 ? '黒字' : '赤字';
    $('#result-chip').className = 'chip ' + (r.pl.net >= 0 ? 'good' : 'bad');
    $$('#dlg-result .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'summary'));
    $('#result-content').innerHTML = summaryView(r, prev);
    $('#btn-to-lesson').textContent = isNew ? '今期のレッスンへ →' : '閉じる';
    $('#btn-to-lesson').dataset.mode = isNew ? 'lesson' : 'close';
    $('#dlg-result').showModal();
    $('#dlg-result .modal-body').scrollTop = 0;
  }

  $$('#dlg-result .tab').forEach((t) => {
    t.addEventListener('click', () => {
      $$('#dlg-result .tab').forEach((x) => x.classList.toggle('active', x === t));
      const r = resultCtx;
      const prev = state.history[r.q - 1] || null;
      const view = { summary: () => summaryView(r, prev), pl: () => plTable(r), bs: () => bsTable(r), cf: () => cfTable(r) }[t.dataset.tab];
      $('#result-content').innerHTML = view();
    });
  });

  // ---------- レッスン ----------
  function openLesson(q) {
    const L = window.LESSONS[q];
    const box = $('#lesson-content');
    box.innerHTML = `
      <div class="lesson-head"><span class="chip">${L.tag}</span><span class="lesson-no">LESSON ${q + 1} / ${C.quarters}</span></div>
      <h2>${L.title}</h2>
      <div class="prose">${L.body.map((p) => `<p>${p}</p>`).join('')}</div>
      <div class="formula">${L.formula}</div>
      <div class="quiz">
        <p class="quiz-q">確認クイズ：${L.quiz.q}</p>
        <div class="choices">${L.quiz.choices.map((c, i) => `<button class="choice" data-i="${i}">${c}</button>`).join('')}</div>
        <div class="quiz-explain" hidden></div>
      </div>
      <div class="modal-foot"><button class="primary" id="btn-next" disabled>次の四半期へ →</button></div>`;
    $('#dlg-lesson').showModal();
    box.scrollTop = 0;
    box.querySelectorAll('.choice').forEach((b) => {
      b.addEventListener('click', () => {
        const i = +b.dataset.i;
        const ok = i === L.quiz.answer;
        box.querySelectorAll('.choice').forEach((x) => {
          x.disabled = true;
          if (+x.dataset.i === L.quiz.answer) x.classList.add('right');
        });
        if (!ok) b.classList.add('wrong');
        quizScore.total += 1;
        if (ok) quizScore.correct += 1;
        save();
        const ex = box.querySelector('.quiz-explain');
        ex.hidden = false;
        ex.innerHTML = `<b>${ok ? '正解！' : '不正解'}</b> ${L.quiz.explain}`;
        const next = $('#btn-next');
        next.disabled = false;
        next.textContent = state.finished || state.gameOver ? '最終結果を見る →' : '次の四半期へ →';
      });
    });
    $('#btn-next').addEventListener('click', () => {
      $('#dlg-lesson').close();
      if (state.finished || state.gameOver) openFinal();
    });
  }

  $('#btn-to-lesson').addEventListener('click', () => {
    $('#dlg-result').close();
    if ($('#btn-to-lesson').dataset.mode === 'lesson') {
      if (state.gameOver) openFinal();
      else openLesson(resultCtx.q);
    }
  });

  // ---------- 最終結果 ----------
  function openFinal() {
    const g = E.grade(state);
    const h = state.history;
    const total = h.reduce((a, r) => ({ rev: a.rev + r.pl.revenue, net: a.net + r.pl.net, lost: a.lost + r.lostCapacity + r.lostStock, waste: a.waste + r.pl.waste }), { rev: 0, net: 0, lost: 0, waste: 0 });
    const best = h.reduce((a, r) => (r.pl.net > a.pl.net ? r : a), h[0]);
    const worst = h.reduce((a, r) => (r.pl.net < a.pl.net ? r : a), h[0]);
    const msg = {
      S: '伝説の経営者。環境変化を読み、資源配分を最適化しました。',
      A: '優秀な経営者。3年間で株主の期待を大きく上回りました。',
      B: '堅実な経営。さらに伸ばせる余地がどこにあったか振り返りましょう。',
      C: 'なんとか黒字。損益分岐点と価格の関係を見直すと伸びます。',
      D: '赤字決算。どの段階の利益で削られたか、P/Lを振り返りましょう。',
      E: '資金ショートで倒産。利益とキャッシュの違いを意識して再挑戦！',
    }[g.grade];
    $('#final-content').innerHTML = `
      <div class="final-head">
        <div class="grade grade-${g.grade}">${g.grade}</div>
        <div>
          <h2>${state.gameOver ? `${periodName(state.q - 1)}に倒産…` : '3年間の経営、おつかれさまでした'}</h2>
          <p>${msg}</p>
        </div>
      </div>
      <div class="result-kpis">
        <div><span>累計ROE</span><b class="${signClass(g.roe)}">${pct(g.roe, 1)}</b></div>
        <div><span>純資産</span><b>${man(g.equity)}</b></div>
        <div><span>累計売上</span><b>${man(total.rev)}</b></div>
        <div><span>累計純利益</span><b class="${signClass(total.net)}">${man(total.net)}</b></div>
        <div><span>機会損失</span><b>${num(total.lost)}杯</b></div>
        <div><span>クイズ正答</span><b>${quizScore.correct}/${quizScore.total}</b></div>
      </div>
      <div class="prose">
        <p>最も稼いだ期：<b>${periodName(best.q)}</b>（純利益 ${man(best.pl.net)}）／最も苦しかった期：<b>${periodName(worst.q)}</b>（純利益 ${man(worst.pl.net)}）</p>
        <p>累計の廃棄損は ${man(total.waste)}。もう一度プレイして、別の戦略（差別化 vs コストリーダーシップ、借入を活用する／しない）を試してみましょう。</p>
      </div>
      <div class="modal-foot">
        <button class="ghost" id="btn-final-close">決算書を見返す</button>
        <button class="primary" id="btn-restart">もう一度プレイ</button>
      </div>`;
    $('#dlg-final').showModal();
    $('#btn-restart').onclick = () => { $('#dlg-final').close(); reset(); };
    $('#btn-final-close').onclick = () => $('#dlg-final').close();
  }

  // ---------- 進行 ----------
  form.addEventListener('input', renderForm);
  form.addEventListener('change', renderForm);
  $$('[data-step]').forEach((b) => b.addEventListener('click', () => {
    const el = form[b.dataset.step];
    el.value = Math.max(0, (+el.value || 0) + +b.dataset.delta);
    renderForm();
  }));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.finished || state.gameOver) return;
    const { next, result } = E.simulate(state, readForm());
    state = next;
    save();
    render();
    setForm(E.defaultDecision(state));
    renderForm();
    openResult(result, true);
  });

  function reset() {
    state = E.initialState();
    quizScore = { correct: 0, total: 0 };
    save();
    setForm(E.defaultDecision(state));
    render();
    $('#dlg-intro').showModal();
  }

  $('#btn-reset').addEventListener('click', () => {
    if (confirm('最初からやり直しますか？現在の進行状況は失われます。')) reset();
  });
  $('#btn-start').addEventListener('click', () => $('#dlg-intro').close());
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => $('#dlg-' + b.dataset.open).showModal()));
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  // 決算・レッスンはEscで閉じさせない（進行が飛ばないように）
  ['#dlg-result', '#dlg-lesson', '#dlg-intro'].forEach((s) => $(s).addEventListener('cancel', (e) => e.preventDefault()));

  // ---------- 起動 ----------
  buildStatic();
  setForm(E.defaultDecision(state));
  render();
  if (state.finished || state.gameOver) openFinal();
  else if (state.q === 0) $('#dlg-intro').showModal();
})();
