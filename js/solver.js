/* Probability engine and move advisor.
 *
 * Exact odds: every possible 5-dice hand (6^5 = 7776) is enumerated, so the count
 * distribution for any bid in one hand is exact, including straight / broken rules.
 * Hidden hands are combined by convolution.
 *
 * "Reading" the table: a player who bids a face is more likely to hold it. Each
 * opponent's hands are re-weighted by how likely a typical player holding that hand
 * would be to make the bids they made (a softmax over the 11 bid types, mixed with a
 * flat bluff rate). Following the previous face counts as weaker evidence.
 *
 * Move value is your chance of drinking this round (lower is better):
 *   Open: you drink if the bid is true → risk = P(bid true)
 *   Bid:  the next player opens you with chance c (higher when your bid looks
 *         unlikely from the outside) and you drink if it is false. If they raise
 *         instead, you carry a smaller leftover risk L of drinking later in the round
 *         (high with 2 players since it comes straight back, low at a big table).
 *         risk = c·(1 - P(true)) + (1 - c)·L
 * ev = 1 - 2·risk, so ev runs from -1 (certain drink) to +1 (certain safe).
 */
(function () {
  'use strict';
  const LD = window.LD;
  const R = LD.Rules;
  const KEYS = R.KEYS;
  const NK = KEYS.length;
  const NH = 7776;

  const HANDS = new Array(NH);
  for (let i = 0; i < NH; i++) {
    let x = i;
    const h = [];
    for (let d = 0; d < 5; d++) {
      h.push((x % 6) + 1);
      x = Math.floor(x / 6);
    }
    HANDS[i] = h;
  }

  const BETA = 1.1; // how strongly bids reflect hands
  const LAMBDA = 0.25; // share of bids that are pure noise / bluff
  const FOLLOW_WEIGHT = 0.5; // raising the same face as the previous bid is weaker evidence
  const CALL_MID = 0.42; // outside-view truth chance at which the next player calls half the time
  const CALL_SLOPE = 12;

  let tableKey = null;
  let COUNTS, UNIFORM, MEANS, LIK;
  const uniCache = new Map();

  function ensure(rules) {
    const tk = rules.straight + '|' + rules.broken;
    if (tk === tableKey) return;
    tableKey = tk;
    uniCache.clear();
    COUNTS = KEYS.map((k) => {
      const a = new Uint8Array(NH);
      for (let i = 0; i < NH; i++) a[i] = R.countHand(HANDS[i], k.face, k.zai, rules);
      return a;
    });
    UNIFORM = COUNTS.map((a) => {
      const d = new Array(7).fill(0);
      for (let i = 0; i < NH; i++) d[a[i]]++;
      return d.map((x) => x / NH);
    });
    MEANS = UNIFORM.map(mean);
    LIK = KEYS.map(() => new Float64Array(NH));
    const e = new Float64Array(NK);
    for (let i = 0; i < NH; i++) {
      let z = 0;
      for (let k = 0; k < NK; k++) {
        e[k] = Math.exp(BETA * (COUNTS[k][i] - MEANS[k]));
        z += e[k];
      }
      for (let k = 0; k < NK; k++) LIK[k][i] = (1 - LAMBDA) * (e[k] / z) + LAMBDA / NK;
    }
  }

  function mean(d) {
    let s = 0;
    for (let i = 0; i < d.length; i++) s += i * d[i];
    return s;
  }
  function conv(a, b) {
    const out = new Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i++) {
      if (!a[i]) continue;
      for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
    }
    return out;
  }
  function tail(d, need) {
    if (need <= 0) return 1;
    let s = 0;
    for (let i = need; i < d.length; i++) s += d[i];
    return Math.min(1, Math.max(0, s));
  }
  function uniSum(m, k) {
    const key = m + ':' + k;
    if (!uniCache.has(key)) {
      let d = [1];
      for (let j = 0; j < m; j++) d = conv(d, UNIFORM[k]);
      uniCache.set(key, d);
    }
    return uniCache.get(key);
  }

  // Posterior weights over player j's possible hands, given their bids this round.
  function weightsFor(bids, j, read) {
    if (read <= 0) return null;
    let w = null;
    let prevK = -1;
    for (const b of bids) {
      const k = R.keyIndex(b.face, b.zai);
      if (b.by === j) {
        const g = (k === prevK ? FOLLOW_WEIGHT : 1) * read;
        if (!w) w = new Float64Array(NH).fill(1);
        const L = LIK[k];
        if (g === 1) for (let i = 0; i < NH; i++) w[i] *= L[i];
        else for (let i = 0; i < NH; i++) w[i] *= Math.pow(L[i], g);
      }
      prevK = k;
    }
    if (!w) return null;
    let s = 0;
    for (let i = 0; i < NH; i++) s += w[i];
    for (let i = 0; i < NH; i++) w[i] /= s;
    return w;
  }
  function distW(k, w) {
    const d = [0, 0, 0, 0, 0, 0, 0];
    const C = COUNTS[k];
    for (let i = 0; i < NH; i++) d[C[i]] += w[i];
    return d;
  }

  /* view = { me, hand, n, bids:[{by,qty,face,zai}], rules }
   * opts = { read: 0..1 (how much to trust bids), span: extra quantities to consider per face } */
  function analyze(view, opts = {}) {
    const { me, hand, n, bids, rules } = view;
    ensure(rules);
    const read = opts.read == null ? 1 : opts.read;
    const span = opts.span == null ? 4 : opts.span;
    const prev = bids.length ? bids[bids.length - 1] : null;
    const prevK = prev ? R.keyIndex(prev.face, prev.zai) : -1;
    const myCounts = KEYS.map((k) => R.countHand(hand, k.face, k.zai, rules));
    const hidden = (n - 1) * 5;
    const L = n === 2 ? 0.45 : 0.05 + 0.35 / (n - 1);

    // Distribution of the total count among everyone else's dice, per bid type.
    const sums = KEYS.map(() => [1]);
    for (let j = 0; j < n; j++) {
      if (j === me) continue;
      const rj = view.readOf && view.readOf[j] != null ? view.readOf[j] * read : read;
      const w = weightsFor(bids, j, rj);
      for (let k = 0; k < NK; k++) sums[k] = conv(sums[k], w ? distW(k, w) : UNIFORM[k]);
    }
    const pTrue = (k, q) => tail(sums[k], q - myCounts[k]);
    const pTruePure = (k, q) => tail(uniSum(n - 1, k), q - myCounts[k]);

    // How my hand looks to the others if I add a bid of type k.
    const myBase = weightsFor(bids, me, 1);
    const pubSums = new Array(NK);
    function pubSum(k) {
      if (pubSums[k]) return pubSums[k];
      const g = k === prevK ? FOLLOW_WEIGHT : 1;
      const L = LIK[k];
      const C = COUNTS[k];
      const d = [0, 0, 0, 0, 0, 0, 0];
      let s = 0;
      for (let i = 0; i < NH; i++) {
        const wi = (myBase ? myBase[i] : 1 / NH) * (g === 1 ? L[i] : Math.sqrt(L[i]));
        d[C[i]] += wi;
        s += wi;
      }
      for (let c = 0; c < 7; c++) d[c] /= s;
      return (pubSums[k] = conv(sums[k], d));
    }

    function evalBid(bid) {
      const b = R.normalize(bid);
      const k = R.keyIndex(b.face, b.zai);
      const q = b.qty;
      const pT = pTrue(k, q);
      const pPub = tail(pubSum(k), q);
      const c = 1 / (1 + Math.exp(CALL_SLOPE * (pPub - CALL_MID)));
      const q0 = R.minQtyFor(prev, b.face, b.zai, n, rules);
      const risk = c * (1 - pT) + (1 - c) * L;
      return {
        type: 'bid', bid: b, key: k, pTrue: pT, pTruePure: pTruePure(k, q), pPublic: pPub, pCall: c,
        risk, ev: 1 - 2 * risk, myCount: myCounts[k], minQty: q0, extra: q - q0,
        expOthers: mean(sums[k]), expOthersPure: (n - 1) * MEANS[k],
      };
    }

    const res = { prev, myCounts, hidden, n, options: [] };
    if (prev) {
      const p = pTrue(prevK, prev.qty);
      res.open = {
        type: 'open', key: prevK, pTrue: p, pWin: 1 - p, pTruePure: pTruePure(prevK, prev.qty), risk: p, ev: 1 - 2 * p,
        myCount: myCounts[prevK], expOthers: mean(sums[prevK]), expOthersPure: (n - 1) * MEANS[prevK],
      };
      res.options.push(res.open);
    }
    for (let k = 0; k < NK; k++) {
      const { face, zai } = KEYS[k];
      const q0 = R.minQtyFor(prev, face, zai, n, rules);
      const qmax = Math.min(R.maxQty(n), q0 + span);
      for (let q = q0; q <= qmax; q++) res.options.push(evalBid({ qty: q, face, zai }));
    }
    res.options.sort((a, b) => b.ev - a.ev);
    res.best = res.options[0];
    res.evaluate = (action) => {
      if (action.type === 'open') return res.open;
      const b = R.normalize(action.bid);
      return res.options.find((o) => o.type === 'bid' && o.bid.face === b.face && o.bid.zai === b.zai && o.bid.qty === b.qty) || evalBid(b);
    };
    return res;
  }

  const GRADES = [
    { max: 0.02, id: 'best', label: 'Great move' },
    { max: 0.08, id: 'good', label: 'Good' },
    { max: 0.2, id: 'inacc', label: 'Not quite' },
    { max: 0.4, id: 'mistake', label: 'Mistake' },
    { max: Infinity, id: 'blunder', label: 'Big mistake' },
  ];
  const gradeFor = (loss) => GRADES.find((g) => loss <= g.max);
  // Per-move accuracy, 100 for the best move, 0 for a loss of 0.6 EV or worse.
  const accuracyOf = (loss) => Math.max(0, 1 - loss / 0.6) * 100;

  LD.Solver = { analyze, gradeFor, accuracyOf, GRADES };
})();
