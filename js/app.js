/* Game controller: table, turns, cup peeking, reveal, coach feedback and the end-of-game summary. */
(function () {
  'use strict';
  const LD = window.LD;
  const R = LD.Rules;
  const S = LD.Solver;
  const AI = LD.AI;
  const SFX = LD.Sound;
  const $ = (id) => document.getElementById(id);

  const NAMES = ['Ah Seng', 'Mei Ling', 'Kenji', 'Priya', 'Wei Jie', 'Siew Lan', 'Marcus', 'Farah', 'Jun', 'Bao', 'Rizal', 'Hana', 'Darren', 'Yuki'];
  const SEAT_COLORS = ['#d9a54a', '#6fb3a6', '#c98bb9', '#8fa8d8', '#e08e5b', '#a3c27a'];
  const SLOTS = [[17, 28], [50, 22], [83, 28], [33, 74], [67, 74]];

  const store = {
    get(k, d) {
      try { const v = localStorage.getItem('ldd:' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('ldd:' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ }
    },
  };

  const DEFAULTS = { opponents: 3, rounds: 10, level: 'hard', learning: true, sound: true, rules: { ...R.DEFAULT_RULES } };
  const saved = store.get('settings', {});
  const settings = { ...DEFAULTS, ...saved, rules: { ...R.DEFAULT_RULES, ...(saved.rules || {}) } };
  const saveSettings = () => store.set('settings', settings);
  SFX.on = settings.sound;

  let G = null;
  let token = 0;
  const sel = { qty: 0, face: 2, zai: false, bumped: false };

  /* ---------------- helpers ---------------- */
  const PIPS = {
    1: [[50, 50]],
    2: [[28, 28], [72, 72]],
    3: [[27, 27], [50, 50], [73, 73]],
    4: [[29, 29], [71, 29], [29, 71], [71, 71]],
    5: [[27, 27], [73, 27], [50, 50], [27, 73], [73, 73]],
    6: [[29, 25], [71, 25], [29, 50], [71, 50], [29, 75], [71, 75]],
  };
  function dieSVG(face, cls = '', style = '') {
    const red = face === 1 || face === 4;
    const r = face === 1 ? 14 : 8.5;
    const pips = PIPS[face].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${red ? '#c4252f' : '#1d1a17'}"/>`).join('');
    return `<svg class="die ${cls}" style="${style}" viewBox="0 0 100 100" role="img" aria-label="${face}"><rect x="3" y="3" width="94" height="94" rx="21" fill="url(#dieFace)" stroke="#bfae88" stroke-width="2"/>${pips}</svg>`;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = (p) => Math.round(p * 100) + '%';
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function later(ms, fn) {
    const t = token;
    setTimeout(() => { if (t === token) fn(); }, ms);
  }
  const initials = (nm) => { const p = nm.split(' '); return (p.length > 1 ? p[0][0] + p[1][0] : nm.slice(0, 2)).toUpperCase(); };
  const lastBid = () => (G.bids.length ? G.bids[G.bids.length - 1] : null);
  const nameOf = (i) => (i === 0 ? 'You' : G.players[i].name);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const FACE_ONE = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six' };
  const faceCount = (n, f) => `${n} ${n === 1 ? FACE_ONE[f] : R.FACE_WORD[f]}`;
  const inTen = (p) => {
    const x = Math.round(p * 10);
    return x <= 0 ? 'almost never' : x >= 10 ? 'almost every time' : `about ${x} in 10 times`;
  };
  const fmt1 = (x) => String(Math.round(x * 10) / 10);
  // Quick-count rule of thumb: compare what you still need with the usual amount from the hidden dice.
  const quickVerdict = (need, usual) => (need <= 0 ? 'sure' : need <= usual ? 'true' : need <= usual + 1 ? 'coin' : 'lie');
  const VERDICT = {
    sure: 'You already have enough: <b>definitely true</b>. Never open this.',
    true: 'You need no more than usual: <b>probably true</b>, so don’t open.',
    coin: 'You need a bit more than usual: <b>close call</b>.',
    lie: 'You need well over the usual amount: <b>probably a lie</b>, so open it.',
  };
  // "2 fours + 1 one = 3", or the straight / broken-straight special case.
  function countBreakdown(hand, bid) {
    const note = R.handNote(hand, G.rules);
    const total = R.countHand(hand, bid.face, bid.zai, G.rules);
    if (note) return `a ${note.split(':')[0].toLowerCase()}, which counts as <b>${total}</b>`;
    const nFace = hand.filter((d) => d === bid.face).length;
    if (bid.zai || bid.face === 1) return `<b>${faceCount(nFace, bid.face)}</b>`;
    const nOnes = hand.filter((d) => d === 1).length;
    return `${faceCount(nFace, bid.face)} + ${nOnes} ${nOnes === 1 ? 'one' : 'ones'} = <b>${total}</b>`;
  }
  const capFirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const likely = (p) => (p >= 0.85 ? 'almost surely true' : p >= 0.6 ? 'probably true' : p > 0.4 ? 'a coin flip' : p > 0.15 ? 'probably a lie' : 'almost surely a lie');

  function bidInline(b) {
    const z = b.face !== 1 && b.zai ? '<span class="z">zai</span>' : '';
    return `<span class="bi"><b>${b.qty}</b>×${dieSVG(b.face)}${z}</span>`;
  }
  function modeTag(b) {
    if (b.zai) return `<span class="mode-tag zai"><span class="cn">斋</span>${b.face === 1 ? 'Ones · zai' : 'Zai'}</span>`;
    return '<span class="mode-tag"><span class="cn">飞</span>Fly</span>';
  }
  function optLabel(o) {
    return o.type === 'open' ? '<b>open</b>' : `bid ${bidInline(o.bid)}`;
  }

  /* ---------------- game setup ---------------- */
  function newGame() {
    token++;
    const k = settings.opponents;
    const names = shuffle(NAMES.slice()).slice(0, k);
    const styles = Object.keys(AI.PERSONAS);
    const personas = Array.from({ length: k }, () => styles[Math.floor(Math.random() * styles.length)]);
    const colors = shuffle(SEAT_COLORS.slice());
    G = {
      n: k + 1,
      players: [{ name: 'You', isHuman: true, color: '#ece4d2', hand: [], layout: [], drinks: 0, seen: { held: 0, base: 0 } }],
      round: 0,
      maxRounds: settings.rounds,
      starter: Math.floor(Math.random() * (k + 1)),
      turn: 0,
      bids: [],
      phase: 'ready',
      decisions: [],
      rounds: [],
      rules: { ...settings.rules },
      level: AI.LEVELS[settings.level] ? settings.level : 'hard',
      hintShown: false,
      revealDone: false,
      recorded: false,
    };
    names.forEach((nm, i) => G.players.push({ name: nm, isHuman: false, persona: personas[i], color: colors[i], hand: [], layout: [], drinks: 0, seen: { held: 0, base: 0 } }));
    buildSeats();
    $('coachFeed').innerHTML = '';
    $('logFeed').innerHTML = '';
    renderCoachIntro();
    startRound();
  }

  function buildSeats() {
    const wrap = $('opponents');
    wrap.innerHTML = '';
    G.players.forEach((p, i) => {
      if (i === 0) return;
      const seat = document.createElement('div');
      seat.className = 'seat';
      seat.style.setProperty('--seat', p.color);
      seat.innerHTML = `
        <div class="seat-head">
          <div class="avatar">${esc(initials(p.name))}</div>
          <div><div class="seat-name">${esc(p.name)}</div><div class="drinks"></div></div>
        </div>
        <div class="tray-wrap small">
          <div class="tray">
            <div class="saucer"></div>
            <div class="dice-cluster"></div>
            <div class="cup-shadow"></div>
            <div class="cup"><svg viewBox="0 0 200 210" aria-hidden="true"><use href="#cupArt"/></svg></div>
          </div>
          <div class="count-badge"></div>
        </div>
        <div class="hand-note"></div>
        <div class="bubble"></div>`;
      wrap.appendChild(seat);
      p.el = {
        seat, tray: seat.querySelector('.tray'), cluster: seat.querySelector('.dice-cluster'), bubble: seat.querySelector('.bubble'),
        badge: seat.querySelector('.count-badge'), note: seat.querySelector('.hand-note'), drinks: seat.querySelector('.drinks'), name: seat.querySelector('.seat-name'),
      };
    });
    const me = G.players[0];
    const bigWrap = document.querySelector('.tray-wrap.big');
    let badge = bigWrap.querySelector('.count-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'count-badge';
      bigWrap.appendChild(badge);
    }
    let note = document.querySelector('.me-left .hand-note');
    if (!note) {
      note = document.createElement('div');
      note.className = 'hand-note';
      $('peekHint').after(note);
    }
    me.el = { seat: $('mySeat'), tray: $('myTray'), cluster: $('myDice'), bubble: $('myBubble'), badge, note, drinks: $('myDrinks'), name: document.querySelector('.me-head .seat-name') };
  }

  /* ---------------- round flow ---------------- */
  function startRound() {
    G.round++;
    G.bids = [];
    G.phase = 'ready';
    G.revealDone = false;
    G.peeked = false;
    G.players.forEach((p) => {
      p.hand = [];
      p.reshook = false;
      p.el.tray.classList.remove('revealed', 'shaking');
      p.el.cluster.innerHTML = '';
      p.el.badge.className = 'count-badge';
      p.el.note.textContent = '';
      p.el.bubble.className = p === G.players[0] ? 'bubble me-bubble' : 'bubble';
      p.el.bubble.innerHTML = '';
      p.el.seat.classList.remove('loser');
    });
    resetMyCup();
    $('peekHint').textContent = 'Tap the cup or the button to shake';
    renderAll();
  }

  function shake() {
    if (!G || G.phase !== 'ready') return;
    G.phase = 'shaking';
    SFX.rattle(0.95);
    G.players.forEach((p, i) => {
      rollHand(p);
      renderDice(i);
      const tray = p.el.tray;
      tray.classList.remove('shaking');
      void tray.offsetWidth;
      tray.querySelector('.cup').style.animationDelay = i === 0 ? '0s' : (Math.random() * 0.15).toFixed(2) + 's';
      tray.classList.add('shaking');
    });
    renderAll();
    later(1150, () => {
      G.players.forEach((p) => p.el.tray.classList.remove('shaking'));
      logRound();
      startBidding();
    });
  }

  function rollHand(p) {
    p.hand = Array.from({ length: 5 }, () => 1 + Math.floor(Math.random() * 6));
    p.layout = shuffle(SLOTS.slice()).map(([x, y]) => ({ x: x + (Math.random() * 6 - 3), y: y + (Math.random() * 6 - 3), r: Math.random() * 40 - 20 }));
  }

  function startBidding() {
    G.players.forEach((p) => p.el.tray.classList.remove('shaking'));
    G.phase = 'bidding';
    G.turn = G.starter;
    $('peekHint').textContent = 'Drag the cup up to peek · tap or hold Space';
    nextTurn();
  }

  function updateMyNote() {
    if (G.phase === 'reveal') return;
    const me = G.players[0];
    if (G.phase !== 'bidding' || !G.peeked) {
      me.el.note.textContent = '';
      return;
    }
    me.el.note.textContent = R.handNote(me.hand, G.rules);
  }

  function renderDice(i, mask) {
    const p = G.players[i];
    p.el.cluster.innerHTML = p.hand
      .map((d, k) => {
        const L = p.layout[k];
        const cls = mask ? (mask[k] ? 'hit' : 'miss') : '';
        return dieSVG(d, cls, `left:${L.x}%;top:${L.y}%;transform:rotate(${L.r}deg)`);
      })
      .join('');
  }

  function nextTurn() {
    renderAll();
    if (G.phase !== 'bidding') return;
    if (G.turn === 0) {
      initSelection();
      renderControls();
      return;
    }
    const persona = G.players[G.turn].persona;
    const delay = 750 + Math.random() * 900 + (persona === 'shark' ? 400 : 0);
    later(delay, botAct);
  }

  function botAct() {
    if (G.phase !== 'bidding' || G.turn === 0) return;
    if (!$('modal').hidden) {
      later(400, botAct);
      return;
    }
    const i = G.turn;
    const action = AI.decide(viewFor(i), G.players[i].persona, G.level);
    apply(i, action);
  }

  // How much to trust a player's bids, learned from revealed hands: 1 is a typical player,
  // lower for someone whose bids rarely match their dice, higher for someone who always bids what they hold.
  function readFor(j) {
    const s = G.players[j].seen;
    if (s.base < 3) return 1;
    return clamp(0.3 + (s.held / s.base - 1) * 1.4, 0.2, 1.6);
  }
  const viewFor = (i) => ({ me: i, hand: G.players[i].hand, n: G.n, bids: G.bids, rules: G.rules, readOf: G.players.map((_, j) => readFor(j)) });

  function apply(i, action) {
    if (action.type === 'open') {
      resolve(i);
      return;
    }
    const b = { ...R.normalize(action.bid), by: i };
    G.bids.push(b);
    showBubble(i, b);
    SFX.tick();
    logBid(i, b);
    G.turn = (i + 1) % G.n;
    nextTurn();
  }

  function humanAct(action) {
    if (!G || G.phase !== 'bidding' || G.turn !== 0) return;
    if (action.type === 'open' && !lastBid()) return;
    if (action.type === 'bid' && !R.isLegal(lastBid(), action.bid, G.n, G.rules)) return;
    const A = S.analyze(viewFor(0), { read: 1, span: 6 });
    const chosen = A.evaluate(action);
    const loss = Math.max(0, A.best.ev - chosen.ev);
    const dec = {
      round: G.round, action, A, chosen, loss, grade: S.gradeFor(loss), hintUsed: G.hintShown,
      nth: G.decisions.filter((d) => d.round === G.round).length + 1,
      hand: G.players[0].hand.slice(),
    };
    G.decisions.push(dec);
    G.hintShown = false;
    $('hintBox').hidden = true;
    if (settings.learning) addCoachCard(dec);
    apply(0, action);
  }

  function resolve(ch) {
    const last = lastBid();
    const bidder = last.by;
    G.phase = 'reveal';
    G.turn = -1;
    const counts = G.players.map((p) => R.countHand(p.hand, last.face, last.zai, G.rules));
    const total = counts.reduce((s, x) => s + x, 0);
    const bidTrue = total >= last.qty;
    const loser = bidTrue ? ch : bidder;
    G.players[loser].drinks++;
    const rec = { round: G.round, bids: G.bids.slice(), last, challenger: ch, bidder, counts, total, bidTrue, loser, hands: G.players.map((p) => p.hand.slice()) };
    G.rounds.push(rec);
    G.bids.forEach((b) => {
      const s = G.players[b.by].seen;
      s.held += R.countHand(G.players[b.by].hand, b.face, b.zai, G.rules);
      s.base += b.zai ? 5 / 6 : 5 / 3;
    });
    annotateDecisions(rec);
    G.starter = loser;

    showOpenBubble(ch);
    resetMyCup();
    stamp();
    SFX.slam();
    logOpen(ch, rec);
    renderAll();

    later(850, () => {
      G.players.forEach((p, i) => later(i * 110, () => { p.el.tray.classList.add('revealed'); if (i % 2 === 0) SFX.lift(); }));
    });
    later(850 + G.n * 110 + 550, () => {
      G.players.forEach((p, i) => {
        renderDice(i, R.matchMask(p.hand, last.face, last.zai, G.rules));
        p.el.badge.textContent = counts[i];
        p.el.badge.className = 'count-badge show' + (counts[i] ? '' : ' zero');
        p.el.note.textContent = R.handNote(p.hand, G.rules);
      });
      G.players[loser].el.seat.classList.add('loser');
      G.revealDone = true;
      if (loser === 0) SFX.lose(); else SFX.win();
      if (settings.learning) addRecap(rec);
      renderAll();
    });
  }

  function annotateDecisions(rec) {
    const mine = G.decisions.filter((d) => d.round === rec.round);
    mine.forEach((d, idx) => {
      if (d.action.type === 'open') {
        d.outcome = rec.loser === 0 ? 'lost' : 'won';
        d.actualTrue = rec.bidTrue;
        return;
      }
      const b = d.action.bid;
      const tot = rec.hands.reduce((s, h) => s + R.countHand(h, b.face, b.zai, G.rules), 0);
      d.actualTrue = tot >= b.qty;
      d.actualCount = tot;
      const isLast = idx === mine.length - 1 && rec.bidder === 0;
      d.outcome = isLast ? (rec.loser === 0 ? 'lost' : 'won') : 'passed';
    });
  }

  function nextRound() {
    if (G.round >= G.maxRounds) {
      showSummary();
      return;
    }
    startRound();
  }

  /* ---------------- rendering ---------------- */
  function renderAll() {
    renderSeats();
    renderPlaque();
    renderHistory();
    renderControls();
    $('roundPill').textContent = `Round ${G.round} of ${G.maxRounds} · ${AI.LEVELS[G.level].name}`;
  }

  function renderSeats() {
    G.players.forEach((p, i) => {
      const active = G.phase === 'bidding' && G.turn === i;
      p.el.seat.classList.toggle('active', active);
      p.el.drinks.innerHTML = p.drinks ? '<i class="shot"></i>'.repeat(p.drinks) : '<span class="none">no drinks yet</span>';
      p.el.drinks.setAttribute('aria-label', plural(p.drinks, 'drink'));
      if (i > 0) p.el.name.innerHTML = esc(p.name) + (active ? '<span class="thinking" aria-label="thinking"><i></i><i></i><i></i></span>' : '');
    });
  }

  function renderPlaque() {
    const el = $('plaque');
    const last = lastBid();
    if (G.phase === 'ready' || G.phase === 'shaking') {
      const who = G.round === 1 ? 'Opener picked at random' : `${nameOf(G.starter)} lost last round and opens`;
      el.innerHTML = `
        <div class="plaque-label">Round ${G.round} of ${G.maxRounds}</div>
        <h2>${G.phase === 'ready' ? 'Shake your cup' : 'Rattling…'}</h2>
        <p>${esc(who)}. Opening bid is at least ${R.minOpen(G.n, G.rules)}.</p>
        ${G.phase === 'ready' ? '<button class="btn primary-btn" id="shakeBtn" type="button"><span class="cn">摇</span> Shake</button>' : ''}`;
      const b = $('shakeBtn');
      if (b) b.onclick = shake;
      return;
    }
    if (G.phase === 'bidding' && !last) {
      el.innerHTML = `
        <div class="plaque-label">Opening bid</div>
        <h2>${G.turn === 0 ? 'You open' : esc(nameOf(G.turn)) + ' opens'}</h2>
        <p>At least ${R.minOpen(G.n, G.rules)} of any face · ${G.n * 5} dice on the table</p>`;
      return;
    }
    const bidBlock = `
      <div class="plaque-bid">
        <span class="plaque-qty">${last.qty}</span><span class="plaque-x">×</span>${dieSVG(last.face)}${modeTag(last)}
      </div>`;
    if (G.phase === 'bidding') {
      el.innerHTML = `
        <div class="plaque-label">Bid to beat</div>${bidBlock}
        <div class="plaque-by">by <b>${esc(nameOf(last.by))}</b> · ${G.turn === 0 ? '<b>your turn</b>' : esc(nameOf(G.turn)) + ' to act'}</div>`;
      return;
    }
    const rec = G.rounds[G.rounds.length - 1];
    if (!G.revealDone) {
      el.innerHTML = `<div class="plaque-label">${esc(nameOf(rec.challenger))} ${rec.challenger === 0 ? 'open' : 'opens'}</div>${bidBlock}
        <div class="plaque-by">Lifting the cups…</div>`;
      return;
    }
    const truth = rec.bidTrue ? 'The bid was <b>true</b>' : 'The bid was <b>false</b>';
    const drinker = rec.loser === 0 ? 'You drink.' : `${esc(nameOf(rec.loser))} drinks.`;
    const lastRound = G.round >= G.maxRounds;
    el.innerHTML = `
      <div class="plaque-label">${esc(nameOf(rec.challenger))} opened ${esc(nameOf(rec.bidder) === 'You' ? 'your' : nameOf(rec.bidder) + '’s')} bid</div>${bidBlock}
      <p class="verdict">Actual count: <b>${rec.total}</b>. ${truth}. ${drinker}</p>
      <button class="btn primary-btn" id="nextBtn" type="button">${lastRound ? 'See game summary' : 'Next round'}</button>`;
    $('nextBtn').onclick = nextRound;
  }

  function renderHistory() {
    $('history').innerHTML = G.bids
      .map((b) => `<li class="${b.zai && b.face !== 1 ? 'zai' : ''}" style="--seat:${G.players[b.by].color}"><span class="dot"></span>${esc(nameOf(b.by))} <b>${b.qty}</b>×${dieSVG(b.face)}${b.zai && b.face !== 1 ? '<b>zai</b>' : ''}</li>`)
      .join('');
  }

  function showBubble(i, b) {
    G.players.forEach((p) => p.el.bubble.classList.add('old'));
    const el = G.players[i].el.bubble;
    el.className = (i === 0 ? 'bubble me-bubble' : 'bubble') + ' show';
    el.innerHTML = `${b.qty} × ${dieSVG(b.face)}${b.zai ? `<span class="tag zai">${b.face === 1 ? '斋' : 'ZAI'}</span>` : ''}`;
  }
  function showOpenBubble(i) {
    G.players.forEach((p) => p.el.bubble.classList.add('old'));
    const el = G.players[i].el.bubble;
    el.className = (i === 0 ? 'bubble me-bubble' : 'bubble') + ' show open-call';
    el.textContent = '开!';
  }
  function stamp() {
    const s = $('stamp');
    s.classList.remove('go');
    void s.offsetWidth;
    s.classList.add('go');
  }

  /* ---------------- controls ---------------- */
  function buildFaceButtons() {
    $('faces').innerHTML = [1, 2, 3, 4, 5, 6]
      .map((f) => `<button type="button" role="radio" data-face="${f}" aria-label="${R.FACE_WORD[f]}">${dieSVG(f)}</button>`)
      .join('');
    $('faces').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-face]');
      if (!btn) return;
      setFace(+btn.dataset.face);
    });
  }
  const minForSel = () => R.minQtyFor(lastBid(), sel.face, sel.zai, G.n, G.rules);
  function snapQty() {
    const m = minForSel();
    if (!isFinite(m)) return;
    if (!sel.bumped || sel.qty < m) sel.qty = Math.min(m, R.maxQty(G.n));
  }
  function setFace(f) {
    sel.face = f;
    if (f === 1) sel.zai = true;
    snapQty();
    SFX.tick();
    renderControls();
  }
  function setZai(z) {
    if (sel.face === 1) return;
    sel.zai = z;
    snapQty();
    renderControls();
  }
  function initSelection() {
    const prev = lastBid();
    if (prev) {
      sel.face = prev.face;
      sel.zai = prev.zai;
    } else if (sel.face === 1) {
      sel.zai = true;
    }
    sel.bumped = false;
    snapQty();
  }

  function renderControls() {
    const myTurn = G.phase === 'bidding' && G.turn === 0;
    const prev = lastBid();
    $('controls').classList.toggle('disabled', !myTurn);
    $('mySeat').classList.toggle('active', myTurn);
    const st = $('ctlStatus');
    if (myTurn) st.innerHTML = prev ? '<b>Your turn.</b> Raise the bid or open it.' : '<b>Your turn.</b> Make the opening bid.';
    else if (G.phase === 'bidding') st.textContent = `${nameOf(G.turn)} is thinking…`;
    else if (G.phase === 'reveal') st.textContent = 'Round over.';
    else st.textContent = 'Shake to start the round.';

    const m = minForSel();
    if (!sel.qty) sel.qty = R.minOpen(G.n, G.rules);
    $('qtyOut').textContent = sel.qty;
    $('qtyDown').disabled = !myTurn || sel.qty <= Math.max(1, isFinite(m) ? m : 1);
    $('qtyUp').disabled = !myTurn || sel.qty >= R.maxQty(G.n);
    document.querySelectorAll('#faces button').forEach((b) => {
      b.setAttribute('aria-checked', String(+b.dataset.face === sel.face));
      b.disabled = !myTurn;
    });
    $('modeFly').setAttribute('aria-checked', String(!sel.zai));
    $('modeZai').setAttribute('aria-checked', String(sel.zai));
    $('modeFly').disabled = !myTurn || sel.face === 1;
    $('modeZai').disabled = !myTurn;
    const legal = R.isLegal(prev, sel, G.n, G.rules);
    $('bidBtn').innerHTML = `Bid ${sel.qty} × ${dieSVG(sel.face)}${sel.zai && sel.face !== 1 ? ' zai' : ''}`;
    $('bidBtn').disabled = !myTurn || !legal;
    $('bidBtn').title = legal ? '' : isFinite(m) ? `Needs at least ${m}` : 'Zai cannot go back to fly under these rules';
    $('openBtn').disabled = !myTurn || !prev;
    updateMyNote();
    $('hintBtn').hidden = !settings.learning;
    $('hintBtn').disabled = !myTurn;
    if (!myTurn) $('hintBox').hidden = true;
  }

  function showHint() {
    if (!G || G.phase !== 'bidding' || G.turn !== 0) return;
    const A = S.analyze(viewFor(0), { read: 1, span: 6 });
    G.hintShown = true;
    const top = A.options.slice(0, 3);
    let lead = 'You are starting the bidding. Pick something that is very likely true.';
    if (A.open) lead = `The bid is <b>${likely(A.open.pTrue)}</b> (true ${inTen(A.open.pTrue)}).${A.open.pTrue >= 0.5 ? ' Don’t open it.' : ''}`;
    const box = $('hintBox');
    box.innerHTML = `<b>Coach says:</b> ${lead}<ol>${top
      .map((o, i) => `<li>${o.type === 'open' ? '<b>Open it</b>' : `Bid ${bidInline(o.bid)}`} — you drink ${inTen(o.risk)}${i === 0 ? ' <span class="safest">safest</span>' : ''}</li>`)
      .join('')}</ol><div class="rule-thumb">Quick count: your matching dice + a third of the hidden dice (a sixth for zai or 1s).</div>`;
    box.hidden = false;
  }

  /* ---------------- my cup: peek ---------------- */
  const peek = { lift: 0, dragging: false, moved: false, held: false, startY: 0 };
  const PEEK_MAX = 150;
  function applyLift(l) {
    const cup = $('myCup');
    peek.lift = l;
    const t = l / PEEK_MAX;
    cup.style.transform = l ? `translate(${(-t * 8).toFixed(1)}px, ${(-l * 0.55).toFixed(1)}px) rotate(${(t * 32).toFixed(1)}deg)` : '';
    const sh = $('myTray').querySelector('.cup-shadow');
    sh.style.opacity = l ? String(1 - t * 0.8) : '';
    if (t > 0.45 && G && G.phase === 'bidding' && !G.peeked) {
      G.peeked = true;
      renderControls();
    }
  }
  function resetMyCup() {
    peek.dragging = false;
    peek.held = false;
    $('myCup').classList.remove('dragging');
    applyLift(0);
  }
  const canPeek = () => G && G.phase === 'bidding';
  function dropCup() {
    const had = peek.lift > 20;
    peek.held = false;
    $('myCup').classList.remove('dragging');
    applyLift(0);
    if (had) setTimeout(() => SFX.clack(), 180);
  }
  function holdCup() {
    peek.held = true;
    applyLift(PEEK_MAX * 0.85);
    SFX.lift();
  }
  function setupPeek() {
    const cup = $('myCup');
    cup.addEventListener('pointerdown', (e) => {
      SFX.ensure();
      if (G.phase === 'ready') { shake(); return; }
      if (!canPeek()) return;
      peek.dragging = true;
      peek.moved = false;
      peek.startY = e.clientY;
      peek.base = peek.held ? peek.lift : 0;
      cup.setPointerCapture(e.pointerId);
      cup.classList.add('dragging');
    });
    cup.addEventListener('pointermove', (e) => {
      if (!peek.dragging) return;
      const dy = peek.startY - e.clientY;
      if (Math.abs(dy) > 6) peek.moved = true;
      if (peek.moved) applyLift(clamp(peek.base + dy, 0, PEEK_MAX));
    });
    const up = (e) => {
      if (!peek.dragging) return;
      peek.dragging = false;
      if (Math.abs(peek.startY - e.clientY) > 6) peek.moved = true;
      cup.classList.remove('dragging');
      if (!peek.moved) {
        if (peek.held) dropCup();
        else holdCup();
      } else dropCup();
    };
    cup.addEventListener('pointerup', up);
    cup.addEventListener('pointercancel', up);
    cup.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (G.phase === 'ready') shake();
        else if (canPeek()) (peek.held ? dropCup : holdCup)();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.repeat || !$('modal').hidden) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag) && document.activeElement !== cup) return;
      e.preventDefault();
      if (G.phase === 'ready') { shake(); return; }
      if (canPeek() && !peek.held) holdCup();
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && peek.held && !peek.dragging) dropCup();
    });
  }

  /* ---------------- coach ---------------- */
  function renderCoachIntro() {
    const feed = $('coachFeed');
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.id = 'coachIntro';
    note.innerHTML = settings.learning
      ? `<h3>Your coach is watching</h3>
         <p>After every move you make, a card shows up here. It tells you how good the move was and what the best move was.</p>
         <ul>
           <li><b>Great move</b> or <b>Good</b>: you did about as well as you could.</li>
           <li><b>Not quite</b>, <b>Mistake</b>, <b>Big mistake</b>: another move would have made you drink less.</li>
           <li>Stuck? Press <b>Coach hint</b> before you move.</li>
         </ul>
         <p><b>Quick count trick:</b> add your matching dice, then add a third of everyone else’s dice (a sixth for zai or 1s). That is roughly how many there usually are.</p>
         <p>Every opponent has a secret style. You find out who was who at the end.</p>`
      : `<h3>Learning mode is off</h3>
         <p>Your moves are still scored quietly for the end-of-game summary. Turn learning mode on to get a card after every move.</p>`;
    feed.prepend(note);
  }

  function explain(dec) {
    const { A, chosen, action } = dec;
    const best = A.best;
    const lines = [];
    const target = A.prev || action.bid;
    const ref = A.open || chosen;
    const fly = !target.zai;
    const need = target.qty - ref.myCount;

    const mine = dec.hand ? countBreakdown(dec.hand, target) : faceCount(ref.myCount, target.face);
    lines.push(`<b>Count it.</b> ${A.prev ? `The bid is ${bidInline(A.prev)}.` : `You are starting with ${bidInline(action.bid)}.`} You have ${mine}.`);
    if (need <= 0) {
      lines.push('That is already enough on your own, so it is <b>definitely true</b>.');
    } else {
      const usual = A.hidden / (fly ? 3 : 6);
      lines.push(`You still need ${target.qty} − ${ref.myCount} = <b>${need}</b>. Usual amount from the ${A.hidden} hidden dice: ${A.hidden} ÷ ${fly ? 3 : 6} = about <b>${fmt1(usual)}</b>. ${VERDICT[quickVerdict(need, usual)].split(':')[0]}.`);
      if (Math.abs(ref.expOthers - ref.expOthersPure) > 0.6)
        lines.push(`But the way ${A.n === 2 ? 'your opponent is' : 'the others are'} bidding hints they have ${ref.expOthers > ref.expOthersPure ? 'more' : 'fewer'} than usual (about ${ref.expOthers.toFixed(1)}).`);
      const p = A.open ? A.open.pTrue : chosen.pTrue;
      lines.push(`So ${A.prev ? 'the bid' : 'your bid'} is <b>${likely(p)}</b> (true ${inTen(p)}).`);
    }

    const yours = action.type === 'open' ? 'Opening' : `Bidding ${bidInline(action.bid)}`;
    const bests = best.type === 'open' ? 'opening' : `bidding ${bidInline(best.bid)}`;
    if (dec.loss <= 0.02) {
      lines.push(`<b>Your move.</b> ${yours} means you drink ${inTen(chosen.risk)}. Nothing was safer. Nice.`);
    } else {
      if (Math.round(chosen.risk * 10) === Math.round(best.risk * 10))
        lines.push(`<b>Your move.</b> ${yours} means you drink ${inTen(chosen.risk)}. ${capFirst(bests)} was a little safer (${pct(best.risk)} vs your ${pct(chosen.risk)}).`);
      else lines.push(`<b>Your move.</b> ${yours} means you drink ${inTen(chosen.risk)}. If you had gone with ${bests}, you would drink ${inTen(best.risk)}.`);
      if (action.type === 'open' && best.type === 'bid')
        lines.push('Why raise instead? You only drink if someone opens you <b>and</b> your bid is wrong. Most of the time they raise again and the danger moves on.');
      if (action.type === 'bid' && best.type === 'open') lines.push('The bid was probably a lie, so this was the time to open it.');
      if (action.type === 'bid') {
        if (chosen.extra >= 2) lines.push(`Tip: you went ${chosen.extra} higher than you needed to. Every extra die makes your bid less likely to be true.`);
        if (chosen.myCount === 0 && chosen.pTrue < 0.45) lines.push('Tip: you have none of that face. If someone opens you, you will probably drink.');
        if (best.type === 'bid' && best.bid.zai && best.bid.face !== 1 && !action.bid.zai)
          lines.push(`Tip: try zai here. Your ${R.FACE_WORD[best.bid.face]} are real (not 1s), so switching off wild 1s hurts the others more than you.`);
      }
    }
    return lines.map((l) => `<span class="why-line">${l}</span>`).join('');
  }

  function optionsTable(dec) {
    const { A, chosen } = dec;
    const rows = A.options.slice(0, 6);
    if (!rows.includes(chosen)) rows.push(chosen);
    return `<table class="opt-table"><thead><tr><th>Move</th><th class="num">True</th><th class="num">Gets opened</th><th>You drink</th></tr></thead><tbody>${rows
      .map((o, i) => {
        const w = Math.max(2, Math.round(o.risk * 50));
        return `<tr class="${o === chosen ? 'mine' : ''} ${i === 0 ? 'top' : ''}"><td>${optLabel(o)}${o === chosen ? ' (you)' : ''}</td>
          <td class="num">${pct(o.pTrue)}</td><td class="num">${o.type === 'open' ? '—' : pct(o.pCall)}</td>
          <td><span class="evbar ${o.risk > 0.4 ? 'neg' : ''}" style="width:${w}px"></span> ${pct(o.risk)}</td></tr>`;
      })
      .join('')}</tbody></table>`;
  }

  function coachCardHTML(dec, compact) {
    const { A, chosen, grade, action } = dec;
    const best = A.best;
    const did = action.type === 'open' ? `You opened ${bidInline(A.prev)}.` : `You bid ${bidInline(action.bid)}.`;
    const bestLine = dec.loss <= 0.02 ? 'That’s the coach’s pick too.' : `Coach’s pick: ${optLabel(best)}.`;
    const stats = [
      A.open ? ['Bid is true', pct(A.open.pTrue)] : ['Your bid is true', pct(chosen.pTrue)],
      ['You drink', pct(chosen.risk)],
      ['With coach’s pick', pct(best.risk)],
    ];
    return `<div class="cc g-${grade.id}">
      <div class="cc-head"><span class="grade">${grade.label}</span><span class="cc-meta">Round ${dec.round} · move ${dec.nth}${dec.hintUsed ? ' · used hint' : ''}</span></div>
      <p>${did} ${bestLine}</p>
      <dl class="stats">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <p class="why">${explain(dec)}</p>
      ${compact ? '' : `<details><summary>Compare all moves</summary>${optionsTable(dec)}</details>`}
    </div>`;
  }

  function addCoachCard(dec) {
    const intro = $('coachIntro');
    if (intro) intro.remove();
    const wrap = document.createElement('div');
    wrap.innerHTML = coachCardHTML(dec);
    $('coachFeed').prepend(wrap.firstElementChild);
    selectTab('coach');
  }

  function addRecap(rec) {
    const intro = $('coachIntro');
    if (intro) intro.remove();
    const mine = G.decisions.filter((d) => d.round === rec.round);
    const ch = nameOf(rec.challenger);
    const bd = nameOf(rec.bidder);
    let line;
    if (rec.challenger === 0) line = `You opened ${esc(bd)}’s ${bidInline(rec.last)}. There were <b>${rec.total}</b>, so you ${rec.loser === 0 ? '<b>drink</b>' : '<b>win</b>'}.`;
    else if (rec.bidder === 0) line = `${esc(ch)} opened your ${bidInline(rec.last)}. There were <b>${rec.total}</b>, so you ${rec.loser === 0 ? '<b>drink</b>' : '<b>win</b>'}.`;
    else line = `${esc(ch)} opened ${esc(bd)}’s ${bidInline(rec.last)}. There were <b>${rec.total}</b>; ${esc(nameOf(rec.loser))} drinks. You were safe.`;

    let luck = '';
    const key = mine.filter((d) => d.outcome === 'won' || d.outcome === 'lost').pop();
    if (key) {
      const goodCall = key.loss <= 0.08;
      if (goodCall && key.outcome === 'won') luck = '<span class="luck good">Right call, and it paid off</span>';
      else if (goodCall && key.outcome === 'lost') luck = '<span class="luck bad">Right call, unlucky dice</span>';
      else if (!goodCall && key.outcome === 'won') luck = '<span class="luck bad">Wrong call, but you got away with it</span>';
      else luck = '<span class="luck bad">Wrong call, and it cost you</span>';
    }
    const avgAcc = mine.length ? Math.round(avg(mine.map((d) => S.accuracyOf(d.loss)))) : null;
    const wrap = document.createElement('div');
    wrap.className = 'recap';
    wrap.innerHTML = `<h4>Round ${rec.round} result</h4><p>${line}</p>${luck}${
      avgAcc != null ? `<p>Your moves this round: <b>${mine.length}</b> · score <b>${avgAcc}</b> out of 100</p>` : '<p>You did not have to move this round.</p>'
    }`;
    $('coachFeed').prepend(wrap);
  }

  /* ---------------- table talk log ---------------- */
  function logLine(html, i) {
    const d = document.createElement('div');
    d.className = 'log-item';
    if (i != null) d.style.setProperty('--seat', G.players[i].color);
    d.innerHTML = (i != null ? '<span class="dot"></span>' : '') + html;
    $('logFeed').prepend(d);
  }
  function logRound() {
    const d = document.createElement('div');
    d.className = 'log-round';
    d.textContent = `Round ${G.round}`;
    $('logFeed').prepend(d);
  }
  function logBid(i, b) {
    logLine(`<b>${esc(nameOf(i))}</b> ${i === 0 ? 'bid' : 'bids'} ${b.qty} × ${dieSVG(b.face)}${b.zai && b.face !== 1 ? ' zai' : ''}`, i);
  }
  function logOpen(i, rec) {
    logLine(`<b>${esc(nameOf(i))}</b> ${i === 0 ? 'open' : 'opens'}! Count was ${rec.total}. ${esc(nameOf(rec.loser))} ${rec.loser === 0 ? 'drink' : 'drinks'}.`, i);
  }

  function selectTab(which) {
    $('tabCoach').setAttribute('aria-selected', String(which === 'coach'));
    $('tabLog').setAttribute('aria-selected', String(which === 'log'));
    $('coachFeed').hidden = which !== 'coach';
    $('logFeed').hidden = which !== 'log';
  }

  /* ---------------- modals ---------------- */
  function openModal(html, onMount) {
    $('modalCard').innerHTML = html;
    $('modal').hidden = false;
    if (onMount) onMount($('modalCard'));
    const f = $('modalCard').querySelector('button, select');
    if (f) f.focus();
  }
  const closeModal = () => { $('modal').hidden = true; };

  function showRules() {
    const r = settings.rules;
    openModal(`
      <h2>How 大话骰 is played here</h2>
      <ul>
        <li>Everyone shakes 5 dice under a cup and peeks at their own. Nobody ever loses dice; the loser of each round <b>drinks</b>. Fewest drinks after ${settings.rounds} rounds wins.</li>
        <li>Players take turns bidding how many of a face are on the whole table, e.g. <b>five 4s</b>. The opening bid must be at least <b>${r.openMin === 'plus1' ? 'one more than the number of players' : 'the number of players'}</b>.</li>
        <li><b>Fly (飞)</b>: 1s are wild and count as any face. This is the default.</li>
        <li><b>Zai (斋)</b>: 1s are not wild; only the face itself counts. Bidding 1s is always zai.</li>
        <li>To raise, bid more dice, or the same number of a higher face. Face order: 2, 3, 4, 5, 6, then <b>1 is highest</b>.</li>
        <li>Switching <b>fly → zai</b>: the same quantity is enough. Switching <b>zai → fly</b>: ${r.zaiToFly === 'double' ? 'the quantity must at least <b>double</b>' : '<b>not allowed</b>'}.</li>
        <li>Instead of raising, the next player can <b>open (开)</b>. All cups lift. If the count is at least the bid, the opener drinks; otherwise the bidder drinks. The loser opens the next round.</li>
        <li><b>Straight</b> (1-2-3-4-5 or 2-3-4-5-6): ${r.straight === 'six' ? 'counts as <b>6 of anything</b>' : r.straight === 'zero' ? 'counts as <b>0</b>' : 'counts normally'}.</li>
        <li><b>Broken straight</b> (five different faces that don't run, like 1-3-4-5-6): ${r.broken === 'zero' ? 'counts as <b>0</b>' : 'counts normally'}.</li>
      </ul>
      <h3>Controls</h3>
      <ul>
        <li>Drag your cup upward to lift the edge and peek. Tap it to hold it up, tap again to drop it. On a keyboard, hold Space.</li>
        <li>Pick a face, a quantity and fly or zai, then Bid. Or press Open.</li>
      </ul>
      <p>House rules differ between groups. You can change these under New game.</p>
      <div class="modal-foot"><button class="btn primary-btn" type="button" data-close>Got it</button></div>`);
  }

  function showNewGame() {
    const s = settings;
    const r = s.rules;
    const opt = (v, cur, label) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${label}</option>`;
    openModal(
      `<h2>New game</h2>
      <div class="form-grid">
        <label class="field"><span>Difficulty</span><select id="fLevel">${opt('easy', s.level, 'Easy: careless, ignores your bids')}${opt('medium', s.level, 'Medium: decent, partly reads bids')}${opt('hard', s.level, 'Hard: reads bids and learns you')}</select></label>
        <label class="field"><span>Opponents</span><select id="fOpp">${[1, 2, 3, 4, 5].map((n) => opt(n, s.opponents, n === 1 ? '1 on 1 (10 dice)' : `${n} opponents (${(n + 1) * 5} dice)`)).join('')}</select></label>
        <label class="field"><span>Rounds</span><select id="fRounds">${[5, 10, 15, 20].map((n) => opt(n, s.rounds, `${n} rounds`)).join('')}</select></label>
        <label class="field"><span>Opening bid</span><select id="fOpen">${opt('plus1', r.openMin, 'More than the number of players')}${opt('players', r.openMin, 'At least the number of players')}</select></label>
        <label class="field"><span>Straight</span><select id="fStraight">${opt('six', r.straight, 'Counts as 6 of anything')}${opt('zero', r.straight, 'Counts as 0')}${opt('normal', r.straight, 'Counts normally')}</select></label>
        <label class="field"><span>Broken straight</span><select id="fBroken">${opt('zero', r.broken, 'Counts as 0')}${opt('normal', r.broken, 'Counts normally')}</select></label>
        <label class="field"><span>Zai back to fly</span><select id="fZai">${opt('double', r.zaiToFly, 'Allowed if quantity doubles')}${opt('never', r.zaiToFly, 'Not allowed')}</select></label>
      </div>
      <p>Each opponent gets a random secret style, and two of them can share the same style.</p>
      <div class="modal-foot">
        <button class="btn hint-btn" type="button" data-close>Cancel</button>
        <button class="btn primary-btn" type="button" id="fStart">Start new game</button>
      </div>`,
      (card) => {
        card.querySelector('#fStart').onclick = () => {
          settings.level = $('fLevel').value;
          settings.opponents = +$('fOpp').value;
          settings.rounds = +$('fRounds').value;
          settings.rules = { openMin: $('fOpen').value, straight: $('fStraight').value, broken: $('fBroken').value, zaiToFly: $('fZai').value };
          saveSettings();
          closeModal();
          newGame();
        };
      }
    );
  }

  /* ---------------- cheat sheet ---------------- */
  function cheatWorkingNow() {
    const last = lastBid();
    if (G.phase !== 'bidding' || !last) return '<p>When there is a bid on the table, the working for it shows up here.</p>';
    if (!G.peeked) return '<p>Peek at your dice first. Then the working for the current bid shows up here.</p>';
    const hand = G.players[0].hand;
    const fly = !last.zai;
    const yours = R.countHand(hand, last.face, last.zai, G.rules);
    const need = last.qty - yours;
    const hidden = (G.n - 1) * 5;
    const usual = hidden / (fly ? 3 : 6);
    const A = S.analyze(viewFor(0), { read: 1, span: 0 });
    return `<details class="working"><summary>Show the working for ${bidInline(last)} (try it in your head first)</summary>
      <ol class="steps">
        <li><b>Count yours:</b> ${countBreakdown(hand, last)}</li>
        <li><b>Still need:</b> ${last.qty} − ${yours} = <b>${need}</b></li>
        <li><b>Usual from hidden:</b> ${hidden} ÷ ${fly ? 3 : 6} = about <b>${fmt1(usual)}</b></li>
        <li><b>Compare:</b> ${need > 0 ? `${need} vs ${fmt1(usual)}. ` : ''}${VERDICT[quickVerdict(need, usual)]}</li>
      </ol>
      <p class="exact">Exact odds: true ${pct(A.open.pTruePure)} of the time. Counting what people have bid so far: ${pct(A.open.pTrue)}.</p>
    </details>`;
  }

  function showCheatSheet() {
    const opp = G.n - 1;
    const rows = [1, 2, 3, 4, 5]
      .map((k) => `<tr class="${k === opp ? 'now' : ''}"><td>${k === 1 ? '1 (1 on 1)' : k}${k === opp ? ' <span class="you-here">this game</span>' : ''}</td><td class="num">${k * 5}</td><td class="num">${fmt1((k * 5) / 3)}</td><td class="num">${fmt1((k * 5) / 6)}</td></tr>`)
      .join('');
    openModal(
      `<h2>Quick count cheat sheet</h2>
      <ol class="steps big">
        <li><b>Count yours.</b> Your dice showing the face, plus your 1s if it is fly.</li>
        <li><b>Still need</b> = the bid − yours.</li>
        <li><b>Usual amount</b> from the hidden dice: fly ÷ 3, zai or 1s ÷ 6. Or read it off the table below.</li>
        <li><b>Compare</b> what you need with the usual amount:</li>
      </ol>
      <div class="verdicts">
        <div class="vd v-true"><b>Need ≤ usual</b><span>Probably true. Don’t open.</span></div>
        <div class="vd v-coin"><b>Need = usual + 1</b><span>Close call.</span></div>
        <div class="vd v-lie"><b>Need ≥ usual + 2</b><span>Probably a lie. Open it.</span></div>
      </div>
      <div class="tbl-wrap"><table class="cheat-table"><thead><tr><th>Opponents</th><th class="num">Hidden dice</th><th class="num">Usual, fly (÷3)</th><th class="num">Usual, zai or 1s (÷6)</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p>At a big table early in the round, only open clear lies: raising is usually safer. In 1 on 1, or when bids are already high, open anything that is probably a lie.</p>
      <h3>Right now</h3>
      ${cheatWorkingNow()}
      <h3>Practice</h3>
      <div class="quiz" id="quiz"></div>
      <div class="modal-foot"><button class="btn primary-btn" type="button" data-close>Back to the table</button></div>`,
      (card) => quizNext(card.querySelector('#quiz'))
    );
  }

  const quiz = { right: 0, asked: 0 };
  const QUIZ_FACE = [2, 2, 3, 3, 6]; // a hand with no 4s and no 1s, used to get exact odds for the hidden dice alone
  function quizNext(el) {
    const opp = Math.random() < 0.5 ? G.n - 1 : 1 + Math.floor(Math.random() * 5);
    const zai = Math.random() < 0.3;
    const hidden = opp * 5;
    const usual = hidden / (zai ? 6 : 3);
    const need = Math.max(1, Math.round(usual) + Math.floor(Math.random() * 6) - 2);
    const yours = Math.floor(Math.random() * (zai ? 3 : 4));
    const qty = yours + need;
    const answer = quickVerdict(need, usual);
    const exact = S.analyze({ me: 0, hand: QUIZ_FACE, n: opp + 1, bids: [{ by: 1, qty: need, face: 4, zai }], rules: G.rules }, { read: 0, span: 0 }).open.pTruePure;
    el.innerHTML = `
      <p class="q">${opp === 1 ? '1 on 1' : `${opp} opponents`} · ${zai ? '<b>zai</b> (1s don’t count)' : '<b>fly</b> (1s are wild)'} · you have <b>${yours}</b> that count · the bid is <b>${qty}</b>. Is it…</p>
      <div class="q-btns">
        <button class="btn hint-btn" type="button" data-a="true">Probably true</button>
        <button class="btn hint-btn" type="button" data-a="coin">Close call</button>
        <button class="btn hint-btn" type="button" data-a="lie">Probably a lie</button>
      </div>
      <div class="q-out" hidden></div>
      <p class="q-score">${quiz.asked ? `${quiz.right} of ${quiz.asked} right so far` : ''}</p>`;
    el.querySelectorAll('[data-a]').forEach((b) => {
      b.onclick = () => {
        if (!el.querySelector('.q-out').hidden) return;
        const ok = b.dataset.a === answer;
        quiz.asked++;
        if (ok) quiz.right++;
        b.classList.add(ok ? 'right' : 'wrong');
        const out = el.querySelector('.q-out');
        out.hidden = false;
        out.innerHTML = `<p><b class="${ok ? 'ok' : 'no'}">${ok ? 'Right!' : 'Not quite.'}</b> Still need ${qty} − ${yours} = <b>${need}</b>. Usual: ${hidden} ÷ ${zai ? 6 : 3} = <b>${fmt1(usual)}</b>. ${VERDICT[answer]}</p>
          <p class="exact">Exact odds: true ${pct(exact)} of the time.</p>
          <button class="btn primary-btn" type="button" id="qNext">Next question</button>`;
        el.querySelector('.q-score').textContent = `${quiz.right} of ${quiz.asked} right so far`;
        el.querySelector('#qNext').onclick = () => quizNext(el);
      };
    });
  }

  /* ---------------- summary ---------------- */
  function showSummary() {
    const decs = G.decisions;
    const acc = decs.length ? Math.round(avg(decs.map((d) => S.accuracyOf(d.loss)))) : 0;
    const ranking = G.players.map((p, i) => ({ i, p })).sort((a, b) => a.p.drinks - b.p.drinks);
    const myRank = ranking.findIndex((x) => x.i === 0) + 1;
    const tiedTop = ranking.filter((x) => x.p.drinks === ranking[0].p.drinks).length;

    const opens = decs.filter((d) => d.action.type === 'open');
    const openWins = opens.filter((d) => d.outcome === 'won').length;
    const myBidsCalled = G.rounds.filter((r) => r.bidder === 0);
    const calledFalse = myBidsCalled.filter((r) => !r.bidTrue).length;

    if (!G.recorded) {
      const hist = store.get('history', []);
      hist.push({ t: Date.now(), acc, drinks: G.players[0].drinks, rank: myRank, n: G.n, level: G.level });
      store.set('history', hist.slice(-30));
      G.recorded = true;
    }
    const hist = store.get('history', []);

    const counts = {};
    S.GRADES.forEach((g) => (counts[g.id] = 0));
    decs.forEach((d) => counts[d.grade.id]++);
    const gradeColors = { best: 'var(--g-best)', good: 'var(--g-good)', inacc: 'var(--g-inacc)', mistake: 'var(--g-mistake)', blunder: 'var(--g-blunder)' };
    const bar = decs.length
      ? S.GRADES.map((g) => `<span style="width:${(counts[g.id] / decs.length) * 100}%;background:${gradeColors[g.id]}" title="${g.label}: ${counts[g.id]}"></span>`).join('')
      : '';
    const legend = S.GRADES.map((g) => `<span><i style="background:${gradeColors[g.id]}"></i>${g.label} ${counts[g.id]}</span>`).join('');

    const worst = decs.filter((d) => d.loss > 0.08).sort((a, b) => b.loss - a.loss).slice(0, 3);

    const reveal = G.players
      .slice(1)
      .map((p, k) => {
        const i = k + 1;
        const P = AI.PERSONAS[p.persona];
        let bids = 0, held = 0, base = 0, opensN = 0;
        G.rounds.forEach((r) => {
          r.bids.filter((b) => b.by === i).forEach((b) => {
            bids++;
            held += R.countHand(r.hands[i], b.face, b.zai, G.rules);
            base += b.zai ? 5 / 6 : 5 / 3;
          });
          if (r.challenger === i) opensN++;
        });
        const ratio = base ? held / base : 1;
        const tell = !bids ? 'Never bid, so there was nothing to read.'
          : ratio >= 1.35 ? '<b>Honest:</b> when they bid a face, they usually had plenty of it.'
          : ratio < 1.1 ? '<b>Tricky:</b> their bids often did not match their dice.'
          : '<b>Mixed:</b> sometimes honest, sometimes not.';
        return `<div class="tile">
          <div class="who"><span class="avatar" style="--seat:${p.color}">${esc(initials(p.name))}</span>${esc(p.name)}</div>
          <div class="persona">${P.name}</div>
          <p>${P.blurb}</p>
          <p>${tell}${bids ? ` They had ${(held / bids).toFixed(1)} of the face they bid on average; a random hand has ${(base / bids).toFixed(1)}.` : ''} Opened ${plural(opensN, 'time')}.</p>
        </div>`;
      })
      .join('');

    const tips = buildTips(decs);
    const spark = sparkline(hist.slice(-10).map((h) => h.acc));

    openModal(`
      <h2>${myRank === 1 ? (tiedTop > 1 ? 'Shared first place' : 'You drank the least') : `You finished ${ordinal(myRank)} of ${G.n}`}</h2>
      <div class="sum-top">
        <div class="tile"><div class="k">Your score</div><div class="v">${decs.length ? acc : '—'}<span class="out-of">/100</span></div><div class="s">100 means every move matched the coach</div></div>
        <div class="tile"><div class="k">Your drinks</div><div class="v">${G.players[0].drinks}</div><div class="s">in ${G.maxRounds} rounds on ${AI.LEVELS[G.level].name.toLowerCase()}</div></div>
        <div class="tile"><div class="k">Opens you won</div><div class="v">${openWins}/${opens.length}</div><div class="s">${opens.length ? 'times you called a lie and were right' : 'you never opened anyone'}</div></div>
        <div class="tile"><div class="k">You got opened</div><div class="v">${myBidsCalled.length}</div><div class="s">${myBidsCalled.length ? `${calledFalse} of those bids were lies` : 'nobody opened you'}</div></div>
      </div>
      <div>
        <h3>How good were your moves?</h3>
        <div class="grade-bar">${bar}</div>
        <div class="legend">${legend}</div>
      </div>
      <div><h3>What to work on</h3><ul class="tips">${tips.map((t) => `<li>${t}</li>`).join('')}</ul></div>
      ${worst.length ? `<div><h3>Your biggest mistakes</h3><div class="mistakes">${worst.map((d) => coachCardHTML(d, true)).join('')}</div></div>` : ''}
      <div><h3>Who was who</h3><div class="reveal-list">${reveal}</div></div>
      <div><h3>Standings</h3><div class="standings">${ranking
        .map((x, r) => `<div class="row ${x.i === 0 ? 'you' : ''}"><span>${r + 1}.</span><span class="name">${esc(nameOf(x.i))}</span><span class="drinks">${x.p.drinks ? '<i class="shot"></i>'.repeat(x.p.drinks) : '<span class="none">no drinks</span>'}</span></div>`)
        .join('')}</div></div>
      ${hist.length > 1 ? `<div><h3>Your score, last ${Math.min(10, hist.length)} games</h3>${spark}</div>` : ''}
      <div class="modal-foot">
        <button class="btn hint-btn" type="button" id="sumSettings">Change settings</button>
        <button class="btn primary-btn" type="button" id="sumAgain">Play again</button>
      </div>`,
      (card) => {
        card.querySelector('#sumAgain').onclick = () => { closeModal(); newGame(); };
        card.querySelector('#sumSettings').onclick = showNewGame;
      }
    );
  }

  function buildTips(decs) {
    const tips = [];
    const opens = decs.filter((d) => d.action.type === 'open');
    const bids = decs.filter((d) => d.action.type === 'bid');
    const eager = opens.filter((d) => d.A.open.pTrue > 0.55);
    if (eager.length >= 2)
      tips.push(`<b>You open too soon.</b> ${eager.length} times you opened a bid that was probably true. Before you open, do the quick count: your matching dice + a third of the hidden dice. If that reaches the bid, don’t open.`);
    const missed = bids.filter((d) => d.A.best.type === 'open' && d.loss > 0.08);
    if (missed.length >= 2)
      tips.push(`<b>You let lies slide.</b> ${missed.length} times the bid was probably a lie and opening was your best move. If the bid is well above the quick count, open it.`);
    const wild = bids.filter((d) => d.chosen.pTrue < 0.35);
    if (wild.length >= 2)
      tips.push(`<b>Your bluffs were too big.</b> ${wild.length} of your bids were true less than 1 in 3 times. Bluff small: raise by one, on a face you have at least one of.`);
    const jumps = bids.filter((d) => d.chosen.extra >= 2 && d.loss > 0.08);
    if (jumps.length >= 2) tips.push('<b>Don’t jump.</b> Raising higher than you need to makes your bid less likely to be true and gets you opened more.');
    const zaiMissed = decs.filter((d) => d.A.best.type === 'bid' && d.A.best.bid.zai && d.A.best.bid.face !== 1 && !(d.action.type === 'bid' && d.action.bid.zai));
    if (zaiMissed.length >= 2)
      tips.push('<b>Try zai more.</b> When you have 3 or more of a face and few 1s, zai switches off everyone else’s wild 1s, but you lose almost nothing.');
    if (!tips.length && decs.length) tips.push('No big habits to fix this game. Nice! Try 1 on 1 next: it is harder to hide.');
    if (!decs.length) tips.push('You never had to make a move. Play another game to get a score.');
    tips.push('Check who was who below. Spotting honest vs tricky players is how you read a real table.');
    return tips;
  }

  function sparkline(vals) {
    if (vals.length < 2) return '';
    const W = 280, H = 44, pad = 4;
    const x = (i) => pad + (i * (W - pad * 2)) / (vals.length - 1);
    const y = (v) => H - pad - (v / 100) * (H - pad * 2);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const lx = x(vals.length - 1), ly = y(vals[vals.length - 1]);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Accuracy trend: ${vals.join(', ')}">
      <line x1="${pad}" x2="${W - pad}" y1="${y(50)}" y2="${y(50)}" stroke="var(--line)" stroke-dasharray="3 4"/>
      <polyline points="${pts}" fill="none" stroke="var(--brass)" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${lx}" cy="${ly}" r="4" fill="var(--brass)"/>
      <text x="${Math.min(lx + 8, W - 20)}" y="${Math.max(ly - 6, 12)}" fill="var(--text)" font-size="12" text-anchor="end">${vals[vals.length - 1]}</text>
    </svg>`;
  }
  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th');

  /* ---------------- wiring ---------------- */
  function init() {
    buildFaceButtons();
    $('qtyUp').onclick = () => { sel.qty = Math.min(R.maxQty(G.n), sel.qty + 1); sel.bumped = true; SFX.tick(); renderControls(); };
    $('qtyDown').onclick = () => { sel.qty = Math.max(1, sel.qty - 1); sel.bumped = true; SFX.tick(); renderControls(); };
    $('modeFly').onclick = () => setZai(false);
    $('modeZai').onclick = () => setZai(true);
    $('bidBtn').onclick = () => humanAct({ type: 'bid', bid: { qty: sel.qty, face: sel.face, zai: sel.zai } });
    $('openBtn').onclick = () => humanAct({ type: 'open' });
    $('hintBtn').onclick = showHint;
    $('cheatBtn').onclick = showCheatSheet;
    $('rulesBtn').onclick = showRules;
    $('newGameBtn').onclick = showNewGame;
    $('tabCoach').onclick = () => selectTab('coach');
    $('tabLog').onclick = () => selectTab('log');
    $('modal').addEventListener('click', (e) => {
      if (e.target === $('modal') || e.target.closest('[data-close]')) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('modal').hidden) closeModal();
    });

    const lt = $('learnToggle');
    lt.checked = settings.learning;
    lt.onchange = () => {
      settings.learning = lt.checked;
      saveSettings();
      const intro = $('coachIntro');
      if (intro) intro.remove();
      if (!$('coachFeed').children.length || !settings.learning) renderCoachIntro();
      renderControls();
    };
    const sb = $('soundBtn');
    const syncSound = () => { sb.setAttribute('aria-pressed', String(settings.sound)); sb.setAttribute('aria-label', settings.sound ? 'Sound on' : 'Sound off'); };
    syncSound();
    sb.onclick = () => { settings.sound = !settings.sound; SFX.on = settings.sound; saveSettings(); syncSound(); };

    setupPeek();
    newGame();
  }

  init();
})();
