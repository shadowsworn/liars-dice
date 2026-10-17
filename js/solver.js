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
 *   Bid:  the next player's response is simulated. For each count c of that face they
 *         might hold, work out what they would believe (their own dice plus how the rest
 *         of the table looks to them, including what your bid says about your hand) and
 *         so how likely they are to open. When they open you drink if the bid is false
 *         given they hold c, so a bid that only looks good because they hold none of the
 *         face is punished properly. If they raise instead, you carry a leftover risk L of
 *         drinking later in the round.
 *         risk = Σ_c P(c) · [ open(c)·P(false | c) + (1 - open(c))·L ]
 * ev = 1 - 2·risk, so ev runs from -1 (certain drink) to +1 (certain safe).
 *
 * 1 on 1 uses a simpler outside view instead: the opponent opens more often the less
 * believable your bid looks, and a raised bid leaves a flat 45% risk. In head-to-head
 * self-play that beat the simulation above at 2 players, where the round comes straight
 * back to you and a single leftover number is too crude; at 3+ players the simulation won.
 *
 * The read strength, the next player's opening threshold and the leftover risk L come
 * from self-play calibration (tools/calibrate.sh → js/params.js), with defaults below.
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

  const FOLLOW_WEIGHT = 0.5; // raising the same face as the previous bid is weaker evidence
  const DEFAULTS = {
    beta: 1.1, // how strongly bids reflect hands
    lambda: 0.25, // share of bids that are pure noise / bluff
    reads: {}, // per table size overrides of { beta, lambda }
    open: {}, // per table size: { tau, slope } — the next player opens when their belief the bid is true drops below tau
    leftover: {}, // per table size: leftover drink risk after your bid is raised, by bid height bucket
  };
  let P = { ...DEFAULTS, ...(LD.PARAMS || {}) };
  // Bid height = quantity ÷ what the whole table usually holds; buckets split at these ratios.
  const HEIGHT_EDGES = [0.8, 1.0, 1.2, 1.4];
  const heightBucket = (n, b) => {
    const r = b.qty / (n * 5 * (b.zai ? 1 / 6 : 1 / 3));
    let i = 0;
    while (i < HEIGHT_EDGES.length && r >= HEIGHT_EDGES[i]) i++;
    return i;
  };
  const openParams = (n) => P.open[n] || P.open[Math.min(6, Math.max(2, n))] || { tau: n === 2 ? 0.45 : 0.38, slope: 14 };
  const leftoverRisk = (n, b) => {
    const t = P.leftover[n];
    return t ? t[heightBucket(n, b)] : n === 2 ? 0.45 : 0.05 + 0.35 / (n - 1);
  };

  let tableKey = null;
  let COUNTS, UNIFORM, MEANS, LIK;
  const uniCache = new Map();

  const readParams = (n) => P.reads[n] || { beta: P.beta, lambda: P.lambda };

  function ensure(rules, n) {
    const { beta, lambda } = readParams(n);
    const tk = rules.straight + '|' + rules.broken + '|' + beta + '|' + lambda;
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
        e[k] = Math.exp(beta * (COUNTS[k][i] - MEANS[k]));
        z += e[k];
      }
      for (let k = 0; k < NK; k++) LIK[k][i] = (1 - lambda) * (e[k] / z) + lambda / NK;
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
    ensure(rules, n);
    const read = opts.read == null ? 1 : opts.read;
    const span = opts.span == null ? 4 : opts.span;
    const prev = bids.length ? bids[bids.length - 1] : null;
    const prevK = prev ? R.keyIndex(prev.face, prev.zai) : -1;
    const myCounts = KEYS.map((k) => R.countHand(hand, k.face, k.zai, rules));
    const hidden = (n - 1) * 5;
    const nextJ = (me + 1) % n;

    // Per-player count distributions (after reading their bids), and the total among everyone else.
    const oppD = [];
    const sums = KEYS.map(() => [1]);
    for (let j = 0; j < n; j++) {
      if (j === me) continue;
      const rj = view.readOf && view.readOf[j] != null ? view.readOf[j] * read : read;
      const w = weightsFor(bids, j, rj);
      oppD[j] = KEYS.map((_, k) => (w ? distW(k, w) : UNIFORM[k]));
      for (let k = 0; k < NK; k++) sums[k] = conv(sums[k], oppD[j][k]);
    }
    // Everyone except me and the next player.
    const exJ = new Array(NK);
    function exNext(k) {
      if (exJ[k]) return exJ[k];
      let d = [1];
      for (let j = 0; j < n; j++) if (j !== me && j !== nextJ) d = conv(d, oppD[j][k]);
      return (exJ[k] = d);
    }
    const pTrue = (k, q) => tail(sums[k], q - myCounts[k]);
    const pTruePure = (k, q) => tail(uniSum(n - 1, k), q - myCounts[k]);

    // How my hand looks to the others if I add a bid of type k.
    const myBase = weightsFor(bids, me, 1);
    const pubDists = new Array(NK);
    function pubDist(k) {
      if (pubDists[k]) return pubDists[k];
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
      return (pubDists[k] = d);
    }
    const pubSums = new Array(NK);
    const pubSum = (k) => pubSums[k] || (pubSums[k] = conv(sums[k], pubDist(k)));
    // What the next player sees besides their own dice: the rest of the table plus my hand as my bids paint it.
    const nextViews = new Array(NK);
    const nextView = (k) => nextViews[k] || (nextViews[k] = conv(exNext(k), pubDist(k)));

    function evalBid(bid) {
      const b = R.normalize(bid);
      const k = R.keyIndex(b.face, b.zai);
      const q = b.qty;
      const pT = pTrue(k, q);
      const pPub = tail(pubSum(k), q);
      const q0 = R.minQtyFor(prev, b.face, b.zai, n, rules);
      if (n === 2) {
        const c = 1 / (1 + Math.exp(12 * (pPub - 0.42)));
        const risk = c * (1 - pT) + (1 - c) * 0.45;
        return {
          type: 'bid', bid: b, key: k, pTrue: pT, pTruePure: pTruePure(k, q), pPublic: pPub, pCall: c, leftover: 0.45,
          risk, ev: 1 - 2 * risk, myCount: myCounts[k], minQty: q0, extra: q - q0,
          expOthers: mean(sums[k]), expOthersPure: (n - 1) * MEANS[k],
        };
      }
      const { tau, slope } = openParams(n);
      const L = leftoverRisk(n, b);
      const dJ = oppD[nextJ][k];
      const ex = exNext(k);
      const seen = nextView(k);
      let risk = 0;
      let c = 0;
      for (let cj = 0; cj < dJ.length; cj++) {
        const pc = dJ[cj];
        if (!pc) continue;
        const believe = tail(seen, q - cj); // next player's chance the bid is true, holding cj
        const o = 1 / (1 + Math.exp(slope * (believe - tau)));
        const trueGiven = tail(ex, q - myCounts[k] - cj);
        risk += pc * (o * (1 - trueGiven) + (1 - o) * L);
        c += pc * o;
      }
      return {
        type: 'bid', bid: b, key: k, pTrue: pT, pTruePure: pTruePure(k, q), pPublic: pPub, pCall: c, leftover: L,
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

  // Used by the calibration script to try new parameters.
  function setParams(p) {
    P = { ...DEFAULTS, ...p };
    tableKey = null;
  }

  LD.Solver = { analyze, gradeFor, accuracyOf, GRADES, setParams, heightBucket, HANDS };
})();
