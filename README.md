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
- It also "reads" the table: each opponent's hidden hand is re-weighted by how likely a typical player would be to make the bids they made.
- Every option is scored by your **chance of drinking this round**. Opening: the chance the bid is true. Raising: the chance the next player opens you and your bid is false, plus a small leftover risk if they raise instead.
- Moves are graded by how much drink risk you added over the best option: Great move, Good, Not quite, Mistake, Big mistake.

## Files

- `index.html` page and table markup
- `css/style.css` look and animations
- `js/rules.js` counting and bid legality
- `js/solver.js` odds engine and advisor
- `js/ai.js` opponent personalities
- `js/sound.js` synthesized dice sounds
- `js/app.js` game flow, cup peeking, coach cards, summary
