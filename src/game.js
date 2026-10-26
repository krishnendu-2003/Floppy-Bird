/*
 * Flappy Ticket — fly a conference ticket between London phone boxes.
 *
 * Gameplay, physics constants, palette and scene layout match the game at
 * flappyticket.com. Everything is drawn on a 2D canvas; the only binary
 * assets are the two OFL fonts in assets/fonts.
 *
 * World units: the play field is 640 units tall and at least 280 wide.
 * The canvas is scaled so 640 units fill the stage height, with any extra
 * height added *above* the world (the ground stays at the bottom).
 */
(function () {
  'use strict';

  // --- World geometry ------------------------------------------------------
  var WORLD_H = 640;
  var MIN_W = 280;
  var GROUND_Y = 556;          // top of the kerb
  var SKY_TILE = 360;          // width of one repeating skyline tile
  var BOX_W = 66;              // phone box width

  // --- Physics (units, units/s, units/s^2) --------------------------------
  var STEP = 1 / 120;          // fixed simulation step
  var MAX_FRAME = 0.05;        // longest frame we simulate in one go
  var GRAVITY = 1650;
  var FLAP_V = -470;
  var MAX_FALL = 720;
  var DEATH_HOP = -160;        // upward kick when you hit something
  // Tap and hold: after HOLD_DELAY a held press stops gravity and eases the
  // ticket toward a steady climb. Taps shorter than HOLD_DELAY are plain
  // flaps, identical to the original.
  var HOLD_DELAY = 0.12;
  var HOLD_CLIMB = -300;
  var HOLD_EASE = 10;          // per second, toward HOLD_CLIMB
  var SCROLL = 150;            // world scroll speed
  var COL_SPACING = 214;       // distance between phone box columns
  var COL_SPAWN_PAD = 30;      // columns spawn this far past the right edge
  var GAP_MAX = 168;           // opening at score 0
  var GAP_MIN = 138;           // narrowest opening
  var GAP_SHRINK = 1.2;        // opening shrinks by this per point
  var GAP_TOP = 70;            // opening never starts above this
  var GAP_BOTTOM = 486;        // opening never ends below this
  var CEILING = -40;
  var READY_Y = 250.2;
  var CARD_DELAY_MS = 650;

  // --- Ticket sprite ------------------------------------------------------
  var TICKET = { w: 46, h: 28, hit: 11 };
  var TICKET_LABEL = 'BP26';

  // --- Palette ------------------------------------------------------------
  var INK = '#2A2340';
  var RED = '#C8102E';
  var RED_DARK = '#8E0A20';
  var CREAM = '#FFF4DC';
  var STUB = '#3B2A5C';
  var SKY_TOP = '#7F6BAE';
  var FAR_CITY = '#9A7FA8';
  var NEAR_CITY = '#5A4868';

  // Near skyline: [x, height] of each building in one 360-wide tile.
  var STREET = [
    [0, 44], [34, 56], [64, 48], [98, 62], [128, 46], [164, 58],
    [196, 50], [230, 64], [262, 46], [296, 56], [328, 50]
  ];

  var MEDALS = [
    { at: 100, name: 'Platinum', note: 'Nobody does this. Screenshot it.' },
    { at: 50, name: 'Gold', note: 'Fifty phone boxes. London is impressed.' },
    { at: 25, name: 'Silver', note: '25 boxes. Halfway to gold.' },
    { at: 10, name: 'Bronze', note: "Ten boxes. You're getting the hang of it." }
  ];

  function medalFor(score) {
    for (var i = 0; i < MEDALS.length; i++) if (score >= MEDALS[i].at) return MEDALS[i];
    return null;
  }

  function ticketX(w) {
    return Math.round(Math.max(80, Math.min(240, 0.27 * w)));
  }

  // --- Storage ------------------------------------------------------------
  var KEY_BEST = 'flappyticket.best';
  var KEY_HANDLE = 'flappyticket.handle';
  var KEY_BOARD = 'flappyticket.board';

  function load(key, fallback) {
    try {
      var v = window.localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }
  function forget(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* private mode */ }
  }

  function readBest() { return Number(load(KEY_BEST, 0)) || 0; }

  function readBoard() {
    try {
      var rows = JSON.parse(load(KEY_BOARD, '[]'));
      return Array.isArray(rows) ? rows : [];
    } catch (e) { return []; }
  }

  // Keeps each handle's best, sorted high to low.
  function postScore(handle, score) {
    var rows = readBoard();
    var found = false;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].handle === handle) {
        rows[i].best = Math.max(rows[i].best, score);
        found = true;
      }
    }
    if (!found) rows.push({ handle: handle, best: score });
    rows.sort(function (a, b) { return b.best - a.best; });
    save(KEY_BOARD, JSON.stringify(rows.slice(0, 50)));
    return rows;
  }

  // --- Game state ---------------------------------------------------------
  function freshState(w) {
    return {
      phase: 'ready',
      w: w,
      tx: ticketX(w),
      y: READY_Y,
      v: 0,
      cols: [],
      score: 0,
      t: 0,
      flapAt: -1,
      deadAt: 0,
      held: false
    };
  }

  function makeColumn(x, score, rand) {
    var gap = Math.max(GAP_MIN, GAP_MAX - GAP_SHRINK * score);
    var lo = GAP_TOP + gap / 2;
    var hi = GAP_BOTTOM - gap / 2;
    return { x: x, gapY: lo + rand() * (hi - lo), gap: gap, scored: false };
  }

  // Circle (the ticket's hit radius) against the ground, ceiling and boxes.
  function collides(s) {
    var r = TICKET.hit;
    if (s.y + r >= GROUND_Y || s.y - r <= CEILING) return true;
    for (var i = 0; i < s.cols.length; i++) {
      var c = s.cols[i];
      var spans = [[-1000, c.gapY - c.gap / 2], [c.gapY + c.gap / 2, WORLD_H]];
      for (var j = 0; j < 2; j++) {
        var nx = Math.max(c.x, Math.min(s.tx, c.x + BOX_W));
        var ny = Math.max(spans[j][0], Math.min(s.y, spans[j][1]));
        var dx = s.tx - nx, dy = s.y - ny;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }

  function isClimbing(s) {
    return s.held && s.phase === 'playing' && s.t - s.flapAt >= HOLD_DELAY;
  }

  // Advances one fixed step. Returns true on the step the ticket dies.
  function tick(s, rand) {
    s.t += STEP;

    if (s.phase === 'ready') {
      s.y = READY_Y + 6 * Math.sin(5 * s.t);
      return false;
    }

    if (isClimbing(s)) s.v += (HOLD_CLIMB - s.v) * Math.min(1, HOLD_EASE * STEP);
    else s.v = Math.min(MAX_FALL, s.v + GRAVITY * STEP);
    s.y += s.v * STEP;

    if (s.phase === 'dead') {
      if (s.y > GROUND_Y - TICKET.h / 2) {
        s.y = GROUND_Y - TICKET.h / 2;
        s.v = 0;
      }
      return false;
    }

    for (var i = 0; i < s.cols.length; i++) s.cols[i].x -= SCROLL * STEP;
    if (s.cols.length && s.cols[0].x < -BOX_W) s.cols.shift();

    var last = s.cols[s.cols.length - 1];
    if (!last || last.x < s.w - COL_SPACING) {
      var x = Math.max((last ? last.x : 0) + COL_SPACING, s.w + COL_SPAWN_PAD);
      s.cols.push(makeColumn(x, s.score, rand));
    }

    for (var k = 0; k < s.cols.length; k++) {
      var c = s.cols[k];
      if (!c.scored && c.x + BOX_W < s.tx) {
        c.scored = true;
        s.score++;
      }
    }

    if (collides(s)) {
      s.phase = 'dead';
      s.deadAt = s.t;
      s.v = Math.min(s.v, DEATH_HOP);
      return true;
    }
    return false;
  }

  // --- Drawing ------------------------------------------------------------
  function drawFarCity(ctx, x, variant) {
    var base = 520;
    var hasTower = variant !== 2;

    ctx.fillStyle = FAR_CITY;
    ctx.strokeStyle = FAR_CITY;
    ctx.beginPath();
    ctx.rect(x, base, SKY_TILE, 40);
    ctx.rect(x + 6, base - 34, 70, 34);
    if (hasTower) {
      // Clock tower with its spire.
      ctx.rect(x + 40, base - 128, 16, 128);
      ctx.moveTo(x + 38, base - 128);
      ctx.lineTo(x + 48, base - 160);
      ctx.lineTo(x + 58, base - 128);
    }
    // Domed cathedral.
    ctx.rect(x + 206, base - 40, 56, 40);
    ctx.moveTo(x + 210, base - 40);
    ctx.arc(x + 234, base - 40, 24, Math.PI, 0);
    ctx.rect(x + 231, base - 78, 6, 16);
    if (variant !== 2) {
      // The tall glass spike.
      ctx.moveTo(x + 278, base);
      ctx.lineTo(x + 300, base - 176);
      ctx.lineTo(x + 318, base);
    }
    ctx.fill();

    if (variant !== 1) {
      // The egg-shaped tower.
      ctx.beginPath();
      ctx.ellipse(x + 340, base - 44, 13, 46, 0, 0, Math.PI * 2);
      ctx.fill();

      // Observation wheel: rim, spokes, A-frame legs.
      var cx = x + 140, cy = base - 62;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 52, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var i = 0; i < 12; i++) {
        var a = (i / 12) * Math.PI * 2;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + 52 * Math.cos(a), cy + 52 * Math.sin(a));
      }
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x + 118, base);
      ctx.lineTo(cx, cy);
      ctx.lineTo(x + 162, base);
      ctx.stroke();
    }

    if (hasTower) {
      ctx.fillStyle = '#F3DDB8';
      ctx.beginPath();
      ctx.arc(x + 48, base - 110, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawStreet(ctx, x) {
    ctx.fillStyle = NEAR_CITY;
    ctx.beginPath();
    for (var i = 0; i < STREET.length; i++) {
      var bx = STREET[i][0], bh = STREET[i][1];
      var bw = (STREET[i + 1] ? STREET[i + 1][0] : SKY_TILE) - bx;
      ctx.rect(x + bx, GROUND_Y - bh, bw + 0.5, bh);
      ctx.rect(x + bx + bw - 10, GROUND_Y - bh - 9, 5, 9); // chimney
    }
    ctx.fill();

    ctx.fillStyle = '#FFD58A';
    for (var j = 0; j < STREET.length; j++) {
      if (j % 3 === 1) continue;
      var wx = STREET[j][0], wh = STREET[j][1];
      ctx.fillRect(x + wx + 8, GROUND_Y - wh + 12, 6, 8);
      if (wh > 50) ctx.fillRect(x + wx + 18, GROUND_Y - wh + 26, 6, 8);
    }
  }

  // One phone box stack, from the gap edge `edge` out to `end`.
  // dir = 1 grows downwards (bottom stack), -1 upwards (top stack).
  function drawPhoneBoxes(ctx, x, edge, end, dir, font) {
    var top = Math.min(edge, end);
    var height = Math.abs(end - edge);
    var down = dir === 1;

    ctx.fillStyle = RED;
    ctx.fillRect(x, top, BOX_W, height);

    // Roof cornice at the gap.
    ctx.fillStyle = RED_DARK;
    ctx.fillRect(x - 3, edge + (down ? 0 : -6), 72, 6);

    // TELEPHONE sign.
    var signY = edge + 10 * dir;
    ctx.fillStyle = '#1F1A26';
    ctx.fillRect(x + 6, down ? signY : signY - 11, 54, 11);
    ctx.fillStyle = CREAM;
    ctx.font = '700 8px ' + font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TELEPHONE', x + 33, down ? signY + 5.5 : signY - 5.5);

    // Stacked boxes: a divider band and a 3 x 5 grid of lit panes each.
    var first = edge + 26 * dir;
    for (var n = 0; n < 12; n++) {
      var by = down ? first + 92 * n : first - (n + 1) * 92;
      if (down ? by > end : by + 92 < end) break;
      ctx.fillStyle = RED_DARK;
      ctx.fillRect(x, by + (down ? 86 : 0), BOX_W, 6);
      ctx.fillStyle = '#F3D9A8';
      for (var row = 0; row < 5; row++) {
        for (var col = 0; col < 3; col++) {
          ctx.fillRect(x + 10 + 16 * col, by + 10 + 14 * row, 12, 10);
        }
      }
    }

    ctx.fillStyle = 'rgba(0,0,0,.16)';
    ctx.fillRect(x + BOX_W - 6, top, 6, height);
  }

  function drawTicket(ctx, s, font) {
    var w = TICKET.w, h = TICKET.h;
    var tilt = s.phase === 'ready' ? 0 : Math.max(-0.42, Math.min(1.25, s.v / 560));
    var sinceFlap = s.t - (s.flapAt < 0 ? -10 : s.flapAt);
    if (isClimbing(s)) sinceFlap %= 0.3; // keep beating while held
    var beat = sinceFlap < 0.3
      ? Math.sin((sinceFlap / 0.3) * Math.PI * 2)
      : 0.35 * Math.sin(7 * s.t);
    var wingBeat = s.phase === 'dead' ? 0.2 : beat;

    ctx.save();
    ctx.translate(s.tx, s.y);
    ctx.rotate(tilt);

    function wing(fill, x, squash) {
      ctx.save();
      ctx.translate(x, -h / 2 + 3);
      ctx.rotate(-0.5 - 0.7 * wingBeat);
      ctx.scale(1, squash);
      ctx.fillStyle = fill;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-6, -26, -30, -30);
      ctx.quadraticCurveTo(-24, -22, -28, -18);
      ctx.quadraticCurveTo(-20, -14, -24, -9);
      ctx.quadraticCurveTo(-14, -6, -14, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    wing('#E4DDF0', 4, 0.9);

    // Ticket body.
    ctx.fillStyle = CREAM;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 4);
    ctx.fill();
    ctx.stroke();

    // Stub with perforation.
    ctx.fillStyle = STUB;
    ctx.beginPath();
    ctx.roundRect(-w / 2 + 1, -h / 2 + 1, 12, h - 2, [3, 0, 0, 3]);
    ctx.fill();
    ctx.fillStyle = CREAM;
    for (var i = 0; i < 5; i++) ctx.fillRect(-w / 2 + 13, -h / 2 + 3 + 5 * i, 1.5, 2.5);

    // Printed label, underline and hole punch.
    ctx.fillStyle = INK;
    ctx.font = '900 11px ' + font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(TICKET_LABEL, 6, -2);
    ctx.fillStyle = RED;
    ctx.fillRect(-4, 6, 20, 2.5);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(17, -6, 2, 0, Math.PI * 2);
    ctx.fill();

    wing('#FFFFFF', -2, 1);
    ctx.restore();
  }

  // --- Boot ---------------------------------------------------------------
  var stage = document.getElementById('stage');
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var readyEl = document.getElementById('ready');
  var bestEl = document.getElementById('ready-best');
  var fullBtn = document.getElementById('full');
  var cardEl = document.getElementById('card');

  var css = getComputedStyle(document.documentElement);
  var signFont = css.getPropertyValue('--f-sign').trim() || 'sans-serif';
  var uiFont = css.getPropertyValue('--f-ui').trim() || 'sans-serif';
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var state = freshState(MIN_W);
  var best = readBest();
  var handle = load(KEY_HANDLE, '');
  var lastRun = null;         // { score, best, record } once the card is up
  var cardTimer = 0;
  var skyGradient = null;
  var topPad = 0;             // world units of extra sky above y = 0

  // --- Layout -------------------------------------------------------------
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var cw = stage.clientWidth;
    var ch = stage.clientHeight;
    var scale = ch / WORLD_H;
    var worldW = cw / scale;
    if (worldW < MIN_W) {
      scale = cw / MIN_W;
      worldW = MIN_W;
    }
    topPad = ch / scale - WORLD_H;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, dpr * scale * topPad);
    state.w = Math.max(MIN_W, worldW);
    if (state.phase !== 'playing') state.tx = ticketX(state.w);
  }

  // --- Overlays -----------------------------------------------------------
  function setPhase(phase) {
    stage.setAttribute('data-phase', phase);
    readyEl.hidden = phase !== 'ready';
    bestEl.hidden = !(best > 0);
    bestEl.textContent = 'Your best: ' + best;
    fullBtn.hidden = !document.fullscreenEnabled || phase === 'playing';
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'on') {
          for (var ev in attrs.on) node.addEventListener(ev, attrs.on[ev]);
        } else node.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function shareUrl() {
    return window.location.origin + window.location.pathname;
  }

  function renderCard() {
    cardEl.textContent = '';
    if (!lastRun) {
      cardEl.hidden = true;
      return;
    }
    var run = lastRun;
    var medal = medalFor(run.score);
    var board = readBoard();
    var me = handle;

    var rows = board.slice(0, 5).map(function (r, i) {
      return el('li', r.handle === me ? { class: 'is-you' } : null, [
        el('span', { class: 'fl-board-n', text: String(i + 1) }),
        el('span', { class: 'fl-board-h', text: '@' + r.handle }),
        el('b', { text: String(r.best) })
      ]);
    });
    var rank = -1;
    for (var i = 0; i < board.length; i++) if (board[i].handle === me) rank = i + 1;

    var boardEl = el('div', { class: 'fl-board', 'aria-label': 'Top scores' }, [
      rows.length
        ? el('ol', null, rows)
        : el('p', { class: 'fl-board-empty', text: "Nobody's on the board yet. Score one and you're first." }),
      rank > 5
        ? el('p', { class: 'fl-board-me', text: "You're #" + rank + ' of ' + board.length + ' with ' + board[rank - 1].best + '.' })
        : null
    ]);

    var join = null;
    if (run.score > 0 && !me) {
      var input = el('input', {
        id: 'fl-handle', placeholder: 'your X handle', autocomplete: 'off',
        autocapitalize: 'off', spellcheck: 'false', maxlength: '16'
      });
      var addBtn = el('button', { type: 'submit', class: 'fl-btn', text: 'Add', disabled: '' });
      input.addEventListener('input', function () { addBtn.disabled = !input.value.trim(); });
      join = el('form', {
        class: 'fl-join',
        on: {
          submit: function (e) {
            e.preventDefault();
            var h = input.value.trim().replace(/^@/, '');
            if (!h) return;
            handle = h;
            save(KEY_HANDLE, h);
            postScore(h, run.score);
            renderCard();
          }
        }
      }, [
        el('label', { for: 'fl-handle', text: 'Put this score on the board' }),
        el('div', null, [input, addBtn])
      ]);
    }

    var posting = me
      ? el('p', { class: 'fl-posting' }, [
        document.createTextNode('Playing as @' + me + '. '),
        el('button', {
          type: 'button', text: 'Not you?',
          on: { click: function () { handle = ''; forget(KEY_HANDLE); renderCard(); } }
        })
      ])
      : null;

    var tweet = 'I flew a Breakpoint ticket through ' + run.score + ' London phone ' +
      (run.score === 1 ? 'box' : 'boxes') + '.\n\nYour turn: ' + shareUrl();

    var again = el('button', { type: 'button', class: 'fl-btn fl-btn-go', text: 'Fly again', on: { click: restart } });

    cardEl.appendChild(el('div', { class: 'fl-card-stub' }, [
      el('span', {
        class: 'fl-card-medal',
        'data-medal': medal ? medal.name.toLowerCase() : 'none',
        text: medal ? medal.name : 'No medal'
      })
    ]));
    cardEl.appendChild(el('div', { class: 'fl-card-body' }, [
      el('p', { class: 'fl-card-k', text: run.record && run.score > 0 ? 'New best' : 'Grounded' }),
      el('div', { class: 'fl-card-scores' }, [
        el('div', null, [el('b', { text: String(run.score) }), el('span', { text: run.score === 1 ? 'box' : 'boxes' })]),
        el('div', null, [el('b', { text: String(run.best) }), el('span', { text: 'best' })])
      ]),
      el('p', { class: 'fl-card-note', text: medal ? medal.note : 'Ten boxes gets you bronze.' }),
      boardEl,
      join,
      posting,
      el('div', { class: 'fl-card-actions' }, [
        again,
        el('a', {
          class: 'fl-btn',
          href: 'https://x.com/intent/tweet?text=' + encodeURIComponent(tweet),
          target: '_blank',
          rel: 'noreferrer',
          text: 'Post on X'
        })
      ])
    ]));
    cardEl.hidden = false;
    if (me || run.score === 0) again.focus({ preventScroll: true });
  }

  // --- Input --------------------------------------------------------------
  function flap() {
    if (state.phase === 'dead') return;
    if (state.phase === 'ready') {
      state.phase = 'playing';
      state.cols = [makeColumn(state.w + COL_SPAWN_PAD, 0, Math.random)];
      setPhase('playing');
    }
    state.v = FLAP_V;
    state.flapAt = state.t;
  }

  // Every pointer or key currently held down. The ticket climbs while any
  // of them is still down; a press that only restarts the game is not added.
  var pressed = {};

  function press(id) {
    if (pressed[id]) return;
    if (state.phase === 'dead') return;
    pressed[id] = true;
    flap();
    state.held = true;
  }

  function release(id) {
    delete pressed[id];
    state.held = Object.keys(pressed).length > 0;
  }

  function releaseAll() {
    pressed = {};
    state.held = false;
  }

  function restart() {
    window.clearTimeout(cardTimer);
    releaseAll();
    state = freshState(state.w);
    lastRun = null;
    renderCard();
    resize();
    setPhase('ready');
  }

  function onDeath() {
    var prevBest = readBest();
    var record = state.score > prevBest;
    if (record) save(KEY_BEST, String(state.score));
    best = Math.max(prevBest, state.score);
    setPhase('dead');
    var score = state.score;
    cardTimer = window.setTimeout(function () {
      if (score > 0 && handle) postScore(handle, score);
      lastRun = { score: score, best: best, record: record };
      renderCard();
    }, CARD_DELAY_MS);
  }

  stage.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || e.target.closest('.fl-card, a, button')) return;
    e.preventDefault();
    press('p' + e.pointerId);
  });
  // Listen on window so a finger or cursor that slides off the stage
  // still ends the hold.
  window.addEventListener('pointerup', function (e) { release('p' + e.pointerId); });
  window.addEventListener('pointercancel', function (e) { release('p' + e.pointerId); });
  // A long press must not open the touch context menu.
  stage.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) releaseAll();
  });

  window.addEventListener('keydown', function (e) {
    if (e.target instanceof HTMLElement && e.target.closest('a, button, input, textarea')) return;
    if (['Space', 'ArrowUp', 'KeyW', 'Enter'].indexOf(e.code) < 0) return;
    e.preventDefault();
    if (e.repeat) return; // auto-repeat while held is not a new flap
    if (state.phase === 'dead') {
      if (lastRun && e.code !== 'ArrowUp' && e.code !== 'KeyW') restart();
      return;
    }
    if (e.code !== 'Enter') press('k' + e.code);
  });
  window.addEventListener('keyup', function (e) { release('k' + e.code); });

  fullBtn.addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    else document.documentElement.requestFullscreen().catch(function () {});
  });
  document.addEventListener('fullscreenchange', function () {
    var on = !!document.fullscreenElement;
    fullBtn.setAttribute('aria-pressed', String(on));
    fullBtn.textContent = on ? 'Exit full screen' : 'Full screen';
  });

  // --- Render -------------------------------------------------------------
  var scrolled = 0;           // total world scroll, drives parallax

  function render() {
    var s = state;
    var w = s.w;
    var sinceDeath = s.phase === 'dead' ? s.t - s.deadAt : 1;

    ctx.save();
    if (!reducedMotion && sinceDeath < 0.25) {
      var amp = 8 * (1 - 4 * sinceDeath);
      ctx.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
    }

    // Sky, including any extra height above the world.
    ctx.fillStyle = SKY_TOP;
    ctx.fillRect(-10, -topPad - 10, w + 20, topPad + 10);
    ctx.fillStyle = skyGradient;
    ctx.fillRect(-10, 0, w + 20, GROUND_Y);

    // Setting sun.
    var sunX = Math.min(0.72 * w, w - 60);
    ctx.fillStyle = 'rgba(255, 232, 186, .55)';
    ctx.beginPath();
    ctx.arc(sunX, 452, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFE7B8';
    ctx.beginPath();
    ctx.arc(sunX, 452, 30, 0, Math.PI * 2);
    ctx.fill();

    var far = 0.18 * scrolled;
    for (var x = -(far % SKY_TILE); x < w; x += SKY_TILE) {
      var idx = Math.round((far + x) / SKY_TILE);
      drawFarCity(ctx, x, ((idx % 3) + 3) % 3);
    }
    for (var nx = -((0.45 * scrolled) % SKY_TILE); nx < w; nx += SKY_TILE) drawStreet(ctx, nx);

    for (var i = 0; i < s.cols.length; i++) {
      var c = s.cols[i];
      drawPhoneBoxes(ctx, c.x, c.gapY - c.gap / 2, -20, -1, uiFont);
      drawPhoneBoxes(ctx, c.x, c.gapY + c.gap / 2, GROUND_Y, 1, uiFont);
    }

    // Kerb, road and lane markings.
    ctx.fillStyle = '#9A93A6';
    ctx.fillRect(-10, GROUND_Y, w + 20, 8);
    ctx.fillStyle = '#34303E';
    ctx.fillRect(-10, GROUND_Y + 8, w + 20, 94);
    ctx.fillStyle = '#F2EBDD';
    for (var d = -(scrolled % 48); d < w; d += 48) ctx.fillRect(d, 600, 26, 4);

    drawTicket(ctx, s, signFont);

    if (s.phase !== 'ready') {
      ctx.font = '900 60px ' + signFont;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 8;
      ctx.strokeStyle = INK;
      ctx.strokeText(String(s.score), w / 2, 34);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(String(s.score), w / 2, 34);
    }

    if (s.phase === 'dead' && sinceDeath < 0.12) {
      ctx.fillStyle = 'rgba(255,255,255,' + 0.7 * (1 - sinceDeath / 0.12) + ')';
      ctx.fillRect(-10, -topPad - 10, w + 20, WORLD_H + topPad + 20);
    }
    ctx.restore();
  }

  // --- Main loop ----------------------------------------------------------
  var acc = 0;
  var lastNow = performance.now();

  function frame(now) {
    window.requestAnimationFrame(frame);
    acc += Math.min(MAX_FRAME, (now - lastNow) / 1000);
    lastNow = now;
    while (acc >= STEP) {
      acc -= STEP;
      if (state.phase !== 'dead') scrolled += SCROLL * STEP;
      if (tick(state, Math.random)) onDeath();
    }
    render();
  }

  skyGradient = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  skyGradient.addColorStop(0, SKY_TOP);
  skyGradient.addColorStop(0.62, '#D99AA6');
  skyGradient.addColorStop(1, '#F6C08A');

  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  else window.addEventListener('resize', resize);
  setPhase('ready');
  window.requestAnimationFrame(frame);

  // Hooks for headless tests.
  window.__flappy = {
    state: function () { return state; },
    flap: flap,
    press: press,
    release: release,
    restart: restart
  };
})();
