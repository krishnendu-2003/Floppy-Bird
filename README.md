# Flappy Ticket

Fly a ticket between London phone boxes. A faithful rebuild of the game at
[flappyticket.com](https://flappyticket.com/): same physics, timings,
palette, scene and screens, rewritten as a dependency-free static page.

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

Tap, click, or press Space / ↑ / W to flap. **Hold** any of them to keep
climbing; let go and gravity takes over. On the game-over card, Space or
Enter flies again.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | Page shell, ready overlay, game-over card container |
| `src/style.css` | Full-screen stage, overlays, card, board |
| `src/game.js` | Simulation, rendering, input, local scoreboard |
| `assets/fonts/` | Big Shoulders and Hanken Grotesk (SIL OFL 1.1, licences alongside) |

No build step and no image assets: every sprite is drawn on a 2D canvas.

## Mechanics

The world is 640 units tall and at least 280 wide. The canvas scales so 640
units fill the screen height; on tall narrow screens the extra height is
added as sky above the world, so the street always sits at the bottom.

Physics run on a fixed 120 Hz step, with at most 50 ms simulated per frame.

| Constant | Value |
| --- | --- |
| Gravity | 1650 u/s² |
| Flap | velocity set to −470 u/s |
| Terminal fall | 720 u/s |
| Scroll speed | 150 u/s |
| Column spacing | 214 u, first column spawns 30 u past the right edge |
| Phone box width | 66 u |
| Gap | 168 u, shrinking 1.2 u per point to a floor of 138 u |
| Gap bounds | never above y = 70 or below y = 486 |
| Ground / ceiling | y = 556 / y = −40 |
| Ticket | 46 × 28 sprite, circular hitbox radius 11 |
| Ticket x | 27% of the world width, clamped to 80–240 |
| Tilt | velocity / 560 rad, clamped to −0.42…1.25 |
| Death | upward hop to −160 u/s, 0.25 s screen shake, 0.12 s white flash |
| Card delay | 650 ms after death |

### Tap and hold

This is the one deliberate change to the original's feel. A press always
flaps (−470 u/s). If it is still held 0.12 s later, gravity is suspended and
the ticket eases toward a steady −300 u/s climb (10/s exponential ease),
with the wing beating continuously. Releasing hands control back to
gravity. Taps shorter than 0.12 s are therefore exactly the original flap.
Works for mouse, touch (multi-touch counts as held while any finger is
down) and keyboard; keyboard auto-repeat is ignored. Holds are cleared on
blur, tab switch and restart. The ceiling at y = −40 still ends the run, so
holding too long is fatal, as in the original.

Medals: Bronze 10, Silver 25, Gold 50, Platinum 100.

## Differences from the original

- **Tap and hold to climb** (above). The original only reacts to taps.
- **Leaderboard is local.** The original posts scores to its own server. Here
  the board and handle live in `localStorage`, so the card shows this
  device's scores only.
- **No referral or analytics.** The original's discount-code links, ticket
  purchase links, page navigation and tracking beacons are left out.
- **Fonts are self-hosted** from the OFL releases rather than loaded from the
  original site.

## Verifying

`window.__flappy` exposes `state()`, `flap()` and `restart()` for headless
tests. The rebuild was checked frame by frame against the live game in
Playwright with a frozen clock, a seeded `Math.random` and an identical
flap schedule: sky, skyline, phone boxes, road, score and ticket match to
within a pixel of edge noise; the only layout differences are the omitted
referral link and the server-backed board on the game-over card.
