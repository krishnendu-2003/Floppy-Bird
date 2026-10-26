# Flappy Ticket

A Flappy Bird style web game: fly a conference ticket between London phone boxes.

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

Click, tap, or press Space / ↑ / Enter to flap. Best score is kept in
`localStorage`. The speaker button mutes the Web Audio effects.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | Page shell and canvas |
| `src/style.css` | Page chrome, canvas sizing, responsive scaling |
| `src/game.js` | Whole game: physics, pipes, scoring, screens, rendering |

No build step, no dependencies, no external assets. Every sprite — the ticket,
the phone boxes, the skyline, the pavement — is drawn procedurally on a 2D
canvas, so there is nothing to download and nothing copied from another site.

## How it works

The play field is a fixed 360 × 640 logical canvas scaled by CSS, with the
backing store sized to `devicePixelRatio` so it stays crisp on retina screens.

Physics run on a fixed 120 Hz accumulator (`STEP = 1/120`), decoupled from the
render loop, so a 60 Hz and a 144 Hz display produce identical trajectories.
Frames longer than 250 ms (backgrounded tab) are clamped rather than simulated.

Constants, all in pixels and seconds, in `src/game.js`:

| Constant | Value | Meaning |
| --- | --- | --- |
| `GRAVITY` | 1400 px/s² | Downward acceleration |
| `FLAP_IMPULSE` | −430 px/s | Velocity set on each flap |
| `MAX_FALL` | 640 px/s | Terminal velocity |
| `PIPE_SPEED` | 150 px/s | World scroll speed |
| `PIPE_GAP` | 148 px | Vertical opening |
| `PIPE_SPACING` | 212 px | Distance between consecutive boxes |
| `PIPE_W` | 64 px | Phone box width |
| `HIT_INSET` | 4 px | Hitbox shrink, so near-misses forgive |

Rotation is interpolated from vertical velocity between −0.42 rad (climbing)
and 1.45 rad (terminal dive). Pipes are recycled from a pool of four; a gap is
placed uniformly at random, kept 72 px clear of the ceiling and the pavement.

Scoring fires when a box's trailing edge passes the ticket's leading edge.

## Verifying

`window.__flappy` exposes `config`, `state()` and `flap()` for headless
testing. A Playwright autopilot that aims at each gap clears 15+ pipes in a
30 second run and the game-over screen renders correctly when abandoned.
