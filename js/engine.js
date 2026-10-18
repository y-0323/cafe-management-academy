// ===== 経営シミュレーション エンジン（UIから独立した純粋ロジック） =====
(function (root) {
  const CONFIG = {
    quarters: 12,
    seasons: ['春', '夏', '秋', '冬'],
    seasonFactor: [1.0, 0.85, 1.05, 1.2],
    baseDemand: 12500,
    rent: 750000,
    otherFixed: 200000,
    staffCost: 650000,
    staffCapacity: 4000,
    seatCapacity: 12000,
    renovationSeats: 5000,
    renovationCost: 4000000,
    renovationLife: 20,
    initialDepreciation: 150000,
    elasticity: 2.5,
    interestRate: 0.005, // 四半期あたり（年2%）
    taxRate: 0.3,
    maxLoan: 15000000,
    qualities: [
      { id: 0, name: 'スタンダード', desc: '業務用ブレンド。安いが印象に残らない', cost: 110, ref: 470, rep: 0, compFactor: 0.8 },
      { id: 1, name: 'こだわり', desc: '自家焙煎の単一農園豆。バランス型', cost: 190, ref: 560, rep: 0.01, compFactor: 0.88 },
      { id: 2, name: 'プレミアム', desc: 'スペシャルティ豆＋手作りスイーツ', cost: 280, ref: 650, rep: 0.025, compFactor: 0.97 },
    ],
  };

  // 期ごとのイベント（期番号は0始まり）。開始時に告知される
  const EVENTS = {
    2: { id: 'beans', title: 'コーヒー豆の国際価格が高騰', body: '天候不良で生豆価格が上昇。今期から3四半期、原材料費が20%上がります。', },
    4: { id: 'competitor', title: '大手チェーンが近所に出店', body: '低価格が売りの大手カフェチェーンが徒歩1分の場所にオープン。以後、ずっと競争相手になります。差別化できていない店ほど客を奪われます。', },
    6: { id: 'buzz', title: '人気雑誌への掲載が決定', body: '今期だけ来店希望者が約1.4倍になる見込み。準備（仕入・人員）が足りないと機会損失や評判低下に。', },
    8: { id: 'wage', title: '最低賃金の引き上げ', body: '今期から人件費が1人あたり10%上がります（以後ずっと）。', },
    10: { id: 'office', title: '駅前に大型オフィスビルが完成', body: '通勤客が増え、市場規模が今期から15%拡大します（以後ずっと）。', },
  };

  function initialState() {
    return {
      q: 0,
      cash: 4000000,
      equipment: 6000000,
      renovated: false,
      renovationDep: 0,
      loan: 4000000,
      capital: 6000000,
      retained: 0,
      lossCarry: 0,
      awareness: 0.4,
      reputation: 1.0,
      history: [],
      gameOver: false,
      finished: false,
    };
  }

  function defaultDecision(state) {
    const last = state.history[state.history.length - 1];
    if (last) return Object.assign({}, last.decision, { renovate: false, borrow: 0, repay: 0 });
    return { price: 550, quality: 1, purchase: 11000, staff: 3, ad: 300000, renovate: false, borrow: 0, repay: 0 };
  }

  function modifiers(q) {
    return {
      costMult: q >= 2 && q <= 4 ? 1.2 : 1.0,
      competitor: q >= 4,
      eventDemand: q === 6 ? 1.4 : 1.0,
      wageMult: q >= 8 ? 1.1 : 1.0,
      marketMult: q >= 10 ? 1.15 : 1.0,
    };
  }

  function unitCost(quality, q) {
    return Math.round(CONFIG.qualities[quality].cost * modifiers(q).costMult);
  }

  function staffCost(q) {
    return Math.round(CONFIG.staffCost * modifiers(q).wageMult);
  }

  function capacityOf(staff, renovated) {
    const seats = CONFIG.seatCapacity + (renovated ? CONFIG.renovationSeats : 0);
    return { staffCap: staff * CONFIG.staffCapacity, seats, capacity: Math.min(staff * CONFIG.staffCapacity, seats) };
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // 入力値の正規化
  function sanitize(d, state) {
    const out = {
      price: clamp(Math.round(+d.price || 0), 300, 1200),
      quality: clamp(Math.round(+d.quality || 0), 0, 2),
      purchase: clamp(Math.round(+d.purchase || 0), 0, 40000),
      staff: clamp(Math.round(+d.staff || 1), 1, 8),
      ad: clamp(Math.round(+d.ad || 0), 0, 3000000),
      renovate: !!d.renovate && !state.renovated,
      borrow: clamp(Math.round(+d.borrow || 0), 0, Math.max(0, CONFIG.maxLoan - state.loan)),
      repay: 0,
    };
    out.repay = clamp(Math.round(+d.repay || 0), 0, state.loan);
    return out;
  }

  // 決算前の見積もり（損益分岐点など）
  function preview(state, rawDecision) {
    const d = sanitize(rawDecision, state);
    const q = state.q;
    const cost = unitCost(d.quality, q);
    const renovated = state.renovated || d.renovate;
    const cap = capacityOf(d.staff, renovated);
    const dep = CONFIG.initialDepreciation + state.renovationDep + (d.renovate ? CONFIG.renovationCost / CONFIG.renovationLife : 0);
    const loanAfter = state.loan + d.borrow - d.repay;
    const interest = Math.round(loanAfter * CONFIG.interestRate);
    const labor = d.staff * staffCost(q);
    const fixed = labor + CONFIG.rent + CONFIG.otherFixed + d.ad + dep + interest;
    const cm = d.price - cost;
    const bep = cm > 0 ? Math.ceil(fixed / cm) : Infinity;
    const purchaseCash = d.purchase * cost;
    const cashOut = purchaseCash + labor + CONFIG.rent + CONFIG.otherFixed + d.ad + interest + (d.renovate ? CONFIG.renovationCost : 0) + d.repay;
    const worstCash = state.cash + d.borrow - cashOut; // 1杯も売れなかった場合
    return { d, cost, cap, dep, interest, labor, fixed, cm, cmRate: cm / d.price, bep, bepSales: bep * d.price, purchaseCash, worstCash, loanAfter };
  }

  function simulate(state, rawDecision) {
    const d = sanitize(rawDecision, state);
    const q = state.q;
    const m = modifiers(q);
    const ql = CONFIG.qualities[d.quality];
    const cost = unitCost(d.quality, q);
    const season = q % 4;

    // 財務活動・投資活動（期首）
    const renovatedNow = state.renovated || d.renovate;
    const capex = d.renovate ? CONFIG.renovationCost : 0;
    const renovationDep = state.renovationDep + (d.renovate ? CONFIG.renovationCost / CONFIG.renovationLife : 0);
    const loan = state.loan + d.borrow - d.repay;

    // 需要
    const priceF = clamp(Math.pow(ql.ref / d.price, CONFIG.elasticity), 0.05, 3);
    const adEffect = 0.25 * (1 - Math.exp(-d.ad / 800000));
    const awareness = clamp(state.awareness * 0.8 + adEffect, 0, 1);
    const awarenessF = 0.5 + awareness;
    let compF = 1;
    if (m.competitor) {
      compF = ql.compFactor;
      if (d.price <= 420) compF += 0.08; // 価格で真っ向勝負
    }
    const demand = Math.round(CONFIG.baseDemand * m.marketMult * CONFIG.seasonFactor[season] * priceF * awarenessF * state.reputation * compF * m.eventDemand);

    // 供給制約
    const cap = capacityOf(d.staff, renovatedNow);
    const servable = Math.min(demand, cap.capacity);
    const sold = Math.min(servable, d.purchase);
    const lostCapacity = demand - servable;
    const lostStock = servable - sold;
    const wasteUnits = d.purchase - sold;

    // 損益計算書
    const revenue = sold * d.price;
    const cogs = sold * cost;
    const waste = wasteUnits * cost;
    const gross = revenue - cogs - waste;
    const labor = d.staff * staffCost(q);
    const depreciation = CONFIG.initialDepreciation + renovationDep;
    const sga = labor + CONFIG.rent + CONFIG.otherFixed + d.ad + depreciation;
    const operating = gross - sga;
    const interest = Math.round(loan * CONFIG.interestRate);
    const pretax = operating - interest;
    let lossCarry = state.lossCarry;
    let taxable = pretax;
    if (pretax > 0) {
      const used = Math.min(lossCarry, pretax);
      taxable = pretax - used;
      lossCarry -= used;
    } else {
      lossCarry += -pretax;
      taxable = 0;
    }
    const tax = Math.round(Math.max(0, taxable) * CONFIG.taxRate);
    const net = pretax - tax;

    // キャッシュフロー（間接法）
    const cfo = net + depreciation;
    const cfi = -capex;
    const cff = d.borrow - d.repay;
    const cash = state.cash + cfo + cfi + cff;

    // 評判
    const utilization = cap.capacity > 0 ? servable / cap.capacity : 1;
    let repDelta = ql.rep;
    const lostRatio = demand > 0 ? (lostCapacity + lostStock) / demand : 0;
    repDelta -= 0.12 * lostRatio;
    if (utilization > 0.92) repDelta -= 0.03;
    if (d.price > ql.ref * 1.3) repDelta -= 0.03;
    if (utilization < 0.6) repDelta += 0.01; // ゆったり接客
    const reputation = clamp(state.reputation + repDelta, 0.6, 1.4);

    const equipment = state.equipment + capex - depreciation;
    const retained = state.retained + net;

    const result = {
      q, season, decision: d, cost, demand, cap, sold, lostCapacity, lostStock, wasteUnits,
      priceF, awareness, awarenessF, compF, utilization,
      pl: { revenue, cogs, waste, gross, labor, rent: CONFIG.rent, other: CONFIG.otherFixed, ad: d.ad, depreciation, sga, operating, interest, pretax, tax, net },
      cf: { net, depreciation, cfo, capex, cfi, borrow: d.borrow, repay: d.repay, cff, begin: state.cash, end: cash },
      bs: { cash, equipment, assets: cash + equipment, loan, capital: state.capital, retained, equity: state.capital + retained },
      repBefore: state.reputation, reputation,
    };

    const next = Object.assign({}, state, {
      q: q + 1, cash, equipment, renovated: renovatedNow, renovationDep, loan, retained, lossCarry,
      awareness, reputation, history: state.history.concat([result]),
    });
    if (cash < 0) next.gameOver = true;
    if (next.q >= CONFIG.quarters) next.finished = true;
    return { next, result };
  }

  function grade(state) {
    const equity = state.capital + state.retained;
    const roe = state.retained / state.capital;
    let g = 'D';
    if (state.gameOver) g = 'E';
    else if (roe >= 1.0) g = 'S';
    else if (roe >= 0.6) g = 'A';
    else if (roe >= 0.3) g = 'B';
    else if (roe >= 0) g = 'C';
    return { equity, roe, grade: g };
  }

  const api = { CONFIG, EVENTS, initialState, defaultDecision, preview, simulate, sanitize, unitCost, staffCost, capacityOf, modifiers, grade };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
