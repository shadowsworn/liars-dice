/* Self-play: hard bots with random styles play rounds at one table size and we record
 * what happened, for tools/fit.js to turn into parameters.
 *
 *   node tools/selfplay.js <players> <rounds> <params.json | -> <out.json>
 *
 * Records
 *   open:     for every decision facing a bid, the bot's belief the bid was true and whether it opened
 *   leftover: for every bid that was raised rather than opened, whether its bidder still drank, by bid height
 *   reads:    the bidder's hand and what they bid (fresh faces only), to fit how much bids reveal
 */
'use strict';
const fs = require('fs');
const path = require('path');
global.window = global;
for (const f of ['rules', 'solver', 'ai']) require(path.join(__dirname, '..', 'js', f + '.js'));
const { Rules: R, Solver: S, AI } = global.LD;

const [n, rounds, paramsFile, outFile] = [+process.argv[2], +process.argv[3], process.argv[4], process.argv[5]];
if (paramsFile && paramsFile !== '-') S.setParams(JSON.parse(fs.readFileSync(paramsFile, 'utf8')));
const rules = R.DEFAULT_RULES;
const styles = Object.keys(AI.PERSONAS);
const handIndex = (h) => h.reduce((s, d, i) => s + (d - 1) * Math.pow(6, i), 0);

const open = Array.from({ length: 51 }, () => [0, 0]); // belief bin (2% wide) → [decisions, opens]
const leftover = Array.from({ length: 5 }, () => [0, 0]); // height bucket → [raised bids, bidder drank]
const reads = [];

for (let r = 0; r < rounds; r++) {
  const seat = Array.from({ length: n }, () => styles[Math.floor(Math.random() * styles.length)]);
  const hands = seat.map(() => Array.from({ length: 5 }, () => 1 + Math.floor(Math.random() * 6)));
  const bids = [];
  let turn = Math.floor(Math.random() * n);
  let loser = -1;
  for (let step = 0; step < 100; step++) {
    const a = AI.decide({ me: turn, hand: hands[turn], n, bids, rules }, seat[turn], 'hard');
    if (bids.length && a.pFacing != null) {
      const cell = open[Math.round(a.pFacing * 50)];
      cell[0]++;
      if (a.type === 'open') cell[1]++;
    }
    if (a.type === 'open') {
      const last = bids[bids.length - 1];
      const total = hands.reduce((s, h) => s + R.countHand(h, last.face, last.zai, rules), 0);
      loser = total >= last.qty ? turn : last.by;
      break;
    }
    const b = { ...R.normalize(a.bid), by: turn };
    const prev = bids[bids.length - 1];
    if (!prev || R.keyIndex(prev.face, prev.zai) !== R.keyIndex(b.face, b.zai)) reads.push([handIndex(hands[turn]), R.keyIndex(b.face, b.zai)]);
    bids.push(b);
    turn = (turn + 1) % n;
  }
  if (loser < 0) continue;
  bids.slice(0, -1).forEach((b) => {
    const cell = leftover[S.heightBucket(n, b)];
    cell[0]++;
    if (loser === b.by) cell[1]++;
  });
}

fs.writeFileSync(outFile, JSON.stringify({ n, rounds, open, leftover, reads }));
