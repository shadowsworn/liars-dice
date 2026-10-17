/* Rules of 大话骰 (Asian liar dice) as played here.
 *  - Everyone has 5 dice under a cup. Nobody loses dice; the loser of each round drinks.
 *  - 1s are wild ("fly", 飞) unless the bid is "zai" (斋, pure). Bidding 1s is always zai.
 *  - Face order: 2 < 3 < 4 < 5 < 6 < 1.
 *  - Raise: more dice, or same dice with a higher face (same mode).
 *    Fly → zai: same quantity is enough. Zai → fly: quantity must double (house rule, configurable).
 *  - A straight (1-2-3-4-5 or 2-3-4-5-6) counts as 6 of anything; a broken straight
 *    (five different faces that don't run) counts as 0. Both configurable.
 */
(function () {
  'use strict';
  const LD = (window.LD = window.LD || {});

  const DEFAULT_RULES = {
    straight: 'six', // 'six' | 'zero' | 'normal'
    broken: 'zero', // 'zero' | 'normal'
    zaiToFly: 'double', // 'double' | 'never'
    openMin: 'plus1', // 'plus1' = more than the number of players, 'players' = at least the number of players
  };

  // Every distinct thing you can bid on: 1s (always zai), then 2..6 in fly and zai.
  const KEYS = [{ face: 1, zai: true }];
  for (let f = 2; f <= 6; f++) {
    KEYS.push({ face: f, zai: false });
    KEYS.push({ face: f, zai: true });
  }
  const keyIndex = (face, zai) => (face === 1 ? 0 : 1 + (face - 2) * 2 + (zai ? 1 : 0));
  const rank = (face) => (face === 1 ? 7 : face);

  function classify(hand) {
    const s = new Set(hand);
    if (s.size !== 5) return 'normal';
    // Five different faces means exactly one face is missing.
    if (!s.has(6) || !s.has(1)) return 'straight';
    return 'broken';
  }

  function countHand(hand, face, zai, rules) {
    const c = classify(hand);
    if (c === 'straight' && rules.straight !== 'normal') return rules.straight === 'six' ? 6 : 0;
    if (c === 'broken' && rules.broken === 'zero') return 0;
    let n = 0;
    for (const d of hand) if (d === face || (!zai && face !== 1 && d === 1)) n++;
    return n;
  }

  function matchMask(hand, face, zai, rules) {
    const c = classify(hand);
    if (c === 'straight' && rules.straight === 'six') return hand.map(() => true);
    if (c === 'straight' && rules.straight === 'zero') return hand.map(() => false);
    if (c === 'broken' && rules.broken === 'zero') return hand.map(() => false);
    return hand.map((d) => d === face || (!zai && face !== 1 && d === 1));
  }

  function handNote(hand, rules) {
    const c = classify(hand);
    if (c === 'straight' && rules.straight === 'six') return 'Straight: counts as 6 of anything';
    if (c === 'straight' && rules.straight === 'zero') return 'Straight: counts as 0';
    if (c === 'broken' && rules.broken === 'zero') return 'Broken straight: counts as 0';
    return '';
  }

  const minOpen = (n, rules) => n + (rules.openMin === 'plus1' ? 1 : 0);
  const maxQty = (n) => n * 6;

  function normalize(b) {
    return { qty: b.qty, face: b.face, zai: b.face === 1 ? true : !!b.zai };
  }

  // Smallest legal quantity for a bid on (face, zai) after prev. Infinity if impossible.
  function minQtyFor(prev, face, zai, n, rules) {
    if (face === 1) zai = true;
    if (!prev) return minOpen(n, rules);
    if (prev.zai === zai) return prev.qty + (rank(face) > rank(prev.face) ? 0 : 1);
    if (!prev.zai && zai) return prev.qty;
    if (rules.zaiToFly === 'never') return Infinity;
    return prev.qty * 2;
  }

  function isLegal(prev, bid, n, rules) {
    const b = normalize(bid);
    return b.qty >= minQtyFor(prev, b.face, b.zai, n, rules) && b.qty <= maxQty(n);
  }

  const FACE_WORD = { 1: 'ones', 2: 'twos', 3: 'threes', 4: 'fours', 5: 'fives', 6: 'sixes' };
  function bidText(b) {
    const mode = b.face === 1 ? '' : b.zai ? ' zai' : '';
    return `${b.qty} ${FACE_WORD[b.face]}${mode}`;
  }

  LD.Rules = { DEFAULT_RULES, KEYS, keyIndex, rank, classify, countHand, matchMask, handNote, minOpen, maxQty, normalize, minQtyFor, isLegal, bidText, FACE_WORD };
})();
