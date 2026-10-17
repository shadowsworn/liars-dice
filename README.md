# Liar's Dice Dojo · 大话骰

A training table for Asian-style liar dice. Play against opponents with hidden playing styles while a coach grades every move you make against the odds.

## Play locally

Double-click `index.html`, or serve the folder:

```bash
python3 -m http.server 8417
```

Then open http://localhost:8417.

## Put it on GitHub Pages

1. Create a new public repository on GitHub, e.g. `liars-dice`.
2. Push this folder to it:
   ```bash
   git init && git add . && git commit -m "Liar's Dice Dojo" && git branch -M main
   git remote add origin https://github.com/<you>/liars-dice.git
   git push -u origin main
   ```
3. On GitHub: Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
4. The game is live at `https://<you>.github.io/liars-dice/` in a minute or two.

No build step. It is plain HTML, CSS and JavaScript.

## Rules as implemented

- 5 dice each; nobody loses dice. The loser of each round drinks and opens the next round.
- **Fly (飞)**: 1s are wild. **Zai (斋)**: 1s are not wild. Bidding 1s is always zai.
- Face order 2 < 3 < 4 < 5 < 6 < 1. Raise with more dice, or the same count of a higher face.
- Fly → zai at the same quantity is allowed. Zai → fly needs double the quantity.
- Straight (1-2-3-4-5 or 2-3-4-5-6) counts as 6 of anything. Broken straight (five different, not a run) counts as 0.
- Opening bid must be more than the number of players.

Straight, broken straight, zai → fly, the opening minimum, difficulty and 1-on-1 can all be changed under **New game**.

## Opponents

Pick Easy, Medium or Hard under New game (Hard is the default). On Hard, opponents use the same odds engine as the coach, read every bid, and learn during the game how honest each player's bids are. Medium reads bids less and plays looser. Easy ignores what others bid and sometimes makes careless moves. Each one also gets a random style (Shark, Rock, Bluffer, Aggressor, Trapper, Mimic). Styles can repeat, and they are revealed at the end.

## How the coach works

- `js/solver.js` enumerates all 7,776 possible hands, so the odds for any bid are exact.
- It "reads" the table: each opponent's hidden hand is re-weighted by how likely a player would be to make the bids they made.
- Every option is scored by your **chance of drinking this round**. Opening: the chance the bid is true.
- Raising, at 3+ players: it simulates the next player. For each count of the face they might hold, it works out what they would believe and how likely they are to open, and whether your bid would be false in that case. If they raise instead, a leftover risk (measured in self-play) covers the rest of the round.
- Raising, 1 on 1: a simpler outside view (the less believable your bid looks, the more often you get opened) tested stronger head-to-head.
- Moves are graded by how much drink risk you added over the best option: Great move, Good, Not quite, Mistake, Big mistake.

### Self-play calibration

The read strength, when players open, and the leftover risk come from self-play rather than guesses (`js/params.js`):

```bash
sh tools/calibrate.sh 15000 3
```

This plays hard bots against each other at 3–6 players, fits the parameters, and repeats so bots and coach settle on matching values. In head-to-head tests the calibrated engine drank less than the previous version at every table size (for example 0.227 vs 0.273 drinks per round at 4 players), and the same at 6.

## Files

- `index.html` page and table markup
- `css/style.css` look and animations
- `js/rules.js` counting and bid legality
- `js/solver.js` odds engine and advisor
- `js/params.js` calibrated parameters (generated)
- `tools/` self-play calibration scripts
- `js/ai.js` opponent personalities
- `js/sound.js` synthesized dice sounds
- `js/app.js` game flow, cup peeking, coach cards, summary
