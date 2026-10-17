/* Opponents. Every bot starts from the same odds engine as the coach. The difficulty sets how
 * well it uses it: on hard it reads every bid and learns during the game how honest each
 * player's bids are; easier levels read less, play noisier and sometimes just make a careless move.
 * A style then nudges that base so players feel different and are harder to read.
 * Styles are dealt at random and can repeat; you only find out who was who at the end. */
(function () {
  'use strict';
  const LD = window.LD;
  const R = LD.Rules;

  const PERSONAS = {
    shark: {
      name: 'The Shark', blurb: 'Plays the odds almost perfectly and reads every bid.',
      noise: 0.02,
    },
    rock: {
      name: 'The Rock', blurb: 'Strong and honest. Bids faces they really have and opens a little sooner than most.',
      noise: 0.03, own: 0.06, open: 0.04,
    },
    bluffer: {
      name: 'The Bluffer', blurb: 'Strong, but slips in believable bluffs and hates opening.',
      noise: 0.04, bluff: 0.08, open: -0.05,
    },
    aggressor: {
      name: 'The Aggressor', blurb: 'Pushes the count up fast and loves zai to put you under pressure.',
      noise: 0.04, jump: 0.03, zai: 0.05,
    },
    trapper: {
      name: 'The Trapper', blurb: 'Hides a strong hand behind soft bids on other faces, then pounces.',
      noise: 0.03, trap: 0.08, open: 0.03,
    },
    mimic: {
      name: 'The Mimic', blurb: 'Copies the face already on the table, so you cannot tell what they hold.',
      noise: 0.03, follow: 0.06,
    },
  };

  const LEVELS = {
    easy: { name: 'Easy', read: 0, learn: false, noise: 0.18, slip: 0.15 },
    medium: { name: 'Medium', read: 0.3, learn: false, noise: 0.1, slip: 0.07 },
    hard: { name: 'Hard', read: 1, learn: true, noise: 0, slip: 0 },
  };

  function gauss() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function decide(view, personaId, levelId = 'hard') {
    const P = PERSONAS[personaId];
    const lv = LEVELS[levelId] || LEVELS.hard;
    const A = LD.Solver.analyze(lv.learn ? view : { ...view, readOf: null }, { read: lv.read, span: 3 });
    if (Math.random() < lv.slip) {
      // A careless move: open on a hunch, or the smallest raise on a random face.
      if (A.open && Math.random() < 0.4) return { type: 'open' };
      const mins = A.options.filter((o) => o.type === 'bid' && o.extra === 0);
      if (mins.length) return { type: 'bid', bid: mins[Math.floor(Math.random() * mins.length)].bid };
    }
    const noise = P.noise + lv.noise;
    const prevK = A.prev ? R.keyIndex(A.prev.face, A.prev.zai) : -1;
    const early = view.bids.length < 2;
    let best = null, bs = -Infinity;
    for (const o of A.options) {
      let s = o.ev;
      if (o.type === 'open') {
        s += P.open || 0;
      } else {
        s += (P.own || 0) * (o.myCount / 3);
        if (P.bluff && o.myCount === 0) s += P.bluff * o.pPublic;
        if (P.jump) s += P.jump * Math.min(o.extra, 2);
        if (P.zai && o.bid.zai && o.bid.face !== 1) s += P.zai;
        if (P.follow && o.key === prevK) s += P.follow;
        if (P.trap && early && o.myCount >= 3) s -= P.trap;
        s -= 0.01 * o.extra; // all else equal, prefer the smallest raise
      }
      s += gauss() * noise;
      if (s > bs) { bs = s; best = o; }
    }
    return best.type === 'open' ? { type: 'open' } : { type: 'bid', bid: best.bid };
  }

  LD.AI = { PERSONAS, LEVELS, decide };
})();
