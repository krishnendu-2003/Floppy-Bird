/*
 * Flappy Ticket — a Flappy Bird style game.
 * Fly a conference ticket between London phone boxes.
 *
 * All art is drawn procedurally on the canvas; no external assets.
 * Physics runs on a fixed 120 Hz accumulator so behaviour is identical
 * regardless of display refresh rate.
 */
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  // --- Logical play field -------------------------------------------------
  var W = 360;
  var H = 640;
  var GROUND_H = 96;          // height of the pavement strip
  var FLOOR = H - GROUND_H;   // y of the pavement surface

  // --- Tuning constants (px, px/s, px/s^2) --------------------------------
  var GRAVITY = 1400;
  var FLAP_IMPULSE = -430;
  var MAX_FALL = 640;
  var PIPE_SPEED = 150;
  var PIPE_W = 64;
  var PIPE_GAP = 148;
  var PIPE_SPACING = 212;     // horizontal distance between pipe centres
  var GAP_MARGIN = 72;        // keeps a gap away from ceiling and pavement
  var TICKET_X = 96;
  var TICKET_W = 46;
  var TICKET_H = 30;
  var HIT_INSET = 4;          // forgiving hitbox, as in the original
  var TILT_UP = -0.42;        // radians when flapping
  var TILT_DOWN = 1.45;       // radians at terminal dive
  var STEP = 1 / 120;

  // --- Palette ------------------------------------------------------------
  var SKY_TOP = '#8275B4';
  var SKY_BOTTOM = '#6C5A9C';
  var INK = '#241B3D';
  var PAPER = '#F7F1E3';
  var BOX_RED = '#C3282D';
  var BOX_RED_DARK = '#8E1B20';
  var BOX_GLASS = '#2E2A4A';
  var PAVEMENT = '#4C4368';
  var PAVEMENT_LINE = '#3B3353';
  var ACCENT = '#F2B544';

  // --- State --------------------------------------------------------------
  var READY = 0, PLAYING = 1, DEAD = 2;
  var state = READY;

  var ticket = { y: 0, vy: 0, rot: 0 };
  var pipes = [];
  var score = 0;
  var best = 0;
  var scrollX = 0;      // pavement / skyline scroll offset
  var bobT = 0;         // idle bob timer
  var flashA = 0;       // white hit flash alpha
  var deadT = 0;        // seconds since death

  try {
    best = parseInt(window.localStorage.getItem('flappyticket.best'), 10) || 0;
  } catch (e) { best = 0; }

  // --- Audio --------------------------------------------------------------
  var audioOn = true;
  var actx = null;

  function beep(freq, dur, type, gain) {
    if (!audioOn) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var o = actx.createOscillator();
      var g = actx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, actx.currentTime);
      g.gain.setValueAtTime(gain || 0.05, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g).connect(actx.destination);
      o.start();
      o.stop(actx.currentTime + dur);
    } catch (e) { /* audio is optional */ }
  }

  var sndFlap = function () { beep(560, 0.07, 'square', 0.04); };
  var sndScore = function () { beep(880, 0.09, 'triangle', 0.05); };
  var sndHit = function () { beep(150, 0.18, 'sawtooth', 0.06); };
  var sndDie = function () { beep(90, 0.32, 'sawtooth', 0.05); };

  // --- Skyline (deterministic, generated once) ----------------------------
  var skyline = (function () {
    var out = [];
    var x = 0;
    var seed = 20260926;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    while (x < W * 2 + 120) {
      var w = 26 + Math.round(rnd() * 34);
      var h = 40 + Math.round(rnd() * 90);
      out.push({ x: x, w: w, h: h, spire: rnd() > 0.78 });
      x += w + 6 + Math.round(rnd() * 10);
    }
    return { buildings: out, width: x };
  })();

  // --- Pipes --------------------------------------------------------------
  function spawnPipe(x) {
    var min = GAP_MARGIN;
    var max = FLOOR - GAP_MARGIN - PIPE_GAP;
    var gapY = min + Math.random() * (max - min);
    pipes.push({ x: x, gapY: gapY, scored: false });
  }

  function resetWorld() {
    pipes.length = 0;
    for (var i = 0; i < 4; i++) spawnPipe(W + 110 + i * PIPE_SPACING);
    ticket.y = H * 0.42;
    ticket.vy = 0;
    ticket.rot = 0;
    score = 0;
    deadT = 0;
    flashA = 0;
  }

  resetWorld();

  // --- Input --------------------------------------------------------------
  function flap() {
    if (state === READY) {
      state = PLAYING;
      ticket.vy = FLAP_IMPULSE;
      sndFlap();
    } else if (state === PLAYING) {
      ticket.vy = FLAP_IMPULSE;
      sndFlap();
    } else if (state === DEAD && deadT > 0.65) {
      state = READY;
      resetWorld();
    }
  }

  canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); flap(); });
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') {
      e.preventDefault();
      flap();
    }
  });

  var soundBtn = document.getElementById('sound');
  if (soundBtn) {
    soundBtn.addEventListener('click', function () {
      audioOn = !audioOn;
      soundBtn.setAttribute('aria-pressed', String(audioOn));
    });
  }

  // --- Simulation ---------------------------------------------------------
  function hitsPipe(p) {
    var bx = TICKET_X - TICKET_W / 2 + HIT_INSET;
    var bw = TICKET_W - HIT_INSET * 2;
    var by = ticket.y - TICKET_H / 2 + HIT_INSET;
    var bh = TICKET_H - HIT_INSET * 2;
    if (bx + bw < p.x || bx > p.x + PIPE_W) return false;
    return by < p.gapY || by + bh > p.gapY + PIPE_GAP;
  }

  function die() {
    if (state !== PLAYING) return;
    state = DEAD;
    deadT = 0;
    flashA = 0.85;
    sndHit();
    window.setTimeout(sndDie, 120);
    if (score > best) {
      best = score;
      try { window.localStorage.setItem('flappyticket.best', String(best)); } catch (e) { /* ignore */ }
    }
  }

  function step(dt) {
    bobT += dt;
    if (flashA > 0) flashA = Math.max(0, flashA - dt * 3.2);

    if (state === READY) {
      ticket.y = H * 0.42 + Math.sin(bobT * 4.2) * 7;
      ticket.rot = Math.sin(bobT * 4.2) * 0.09;
      scrollX = (scrollX + PIPE_SPEED * dt) % 10000;
      return;
    }

    if (state === DEAD) {
      deadT += dt;
      // The ticket keeps falling to the pavement after a hit.
      ticket.vy = Math.min(ticket.vy + GRAVITY * dt, MAX_FALL);
      ticket.y += ticket.vy * dt;
      if (ticket.y > FLOOR - TICKET_H / 2) {
        ticket.y = FLOOR - TICKET_H / 2;
        ticket.vy = 0;
      }
      ticket.rot = Math.min(ticket.rot + dt * 5.5, TILT_DOWN);
      return;
    }

    // PLAYING
    scrollX = (scrollX + PIPE_SPEED * dt) % 10000;
    ticket.vy = Math.min(ticket.vy + GRAVITY * dt, MAX_FALL);
    ticket.y += ticket.vy * dt;

    // Rotation follows vertical velocity, as in the original.
    var t = (ticket.vy - FLAP_IMPULSE) / (MAX_FALL - FLAP_IMPULSE);
    ticket.rot = TILT_UP + Math.max(0, Math.min(1, t)) * (TILT_DOWN - TILT_UP);

    for (var i = 0; i < pipes.length; i++) {
      var p = pipes[i];
      p.x -= PIPE_SPEED * dt;
      if (!p.scored && p.x + PIPE_W < TICKET_X - TICKET_W / 2) {
        p.scored = true;
        score++;
        sndScore();
      }
      if (hitsPipe(p)) { die(); return; }
    }

    while (pipes.length && pipes[0].x + PIPE_W < -40) {
      pipes.shift();
      spawnPipe(pipes[pipes.length - 1].x + PIPE_SPACING);
    }

    if (ticket.y + TICKET_H / 2 > FLOOR) {
      ticket.y = FLOOR - TICKET_H / 2;
      die();
      return;
    }
    if (ticket.y - TICKET_H / 2 < 0) {
      ticket.y = TICKET_H / 2;
      ticket.vy = 0;
    }
  }

  // --- Rendering ----------------------------------------------------------
  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, FLOOR);
    g.addColorStop(0, SKY_TOP);
    g.addColorStop(1, SKY_BOTTOM);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, FLOOR);

    // Slow drifting cloud bands.
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    var off = (scrollX * 0.18) % (W + 200);
    for (var i = -1; i < 3; i++) {
      var cx = i * (W + 200) - off + 60;
      ctx.beginPath();
      ctx.ellipse(cx, 120, 90, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + 130, 72, 64, 19, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSkyline() {
    var off = (scrollX * 0.34) % skyline.width;
    ctx.fillStyle = 'rgba(36,27,61,0.42)';
    for (var pass = 0; pass < 2; pass++) {
      var base = pass * skyline.width - off;
      for (var i = 0; i < skyline.buildings.length; i++) {
        var b = skyline.buildings[i];
        var x = base + b.x;
        if (x > W || x + b.w < 0) continue;
        ctx.fillRect(x, FLOOR - b.h, b.w, b.h);
        if (b.spire) {
          ctx.beginPath();
          ctx.moveTo(x + b.w / 2 - 3, FLOOR - b.h);
          ctx.lineTo(x + b.w / 2, FLOOR - b.h - 22);
          ctx.lineTo(x + b.w / 2 + 3, FLOOR - b.h);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }

  function drawPhoneBox(x, top, height, flipped) {
    if (height <= 0) return;
    ctx.save();
    ctx.translate(x, top);
    if (flipped) {
      ctx.translate(PIPE_W / 2, height / 2);
      ctx.rotate(Math.PI);
      ctx.translate(-PIPE_W / 2, -height / 2);
    }

    // Body
    ctx.fillStyle = BOX_RED;
    ctx.fillRect(0, 0, PIPE_W, height);
    // Shading
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(PIPE_W - 11, 0, 11, height);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(5, 0, 6, height);

    // Glass panes down the shaft
    ctx.fillStyle = BOX_GLASS;
    var paneW = PIPE_W - 26;
    var paneH = 20;
    var y = 34;
    while (y + paneH < height - 6) {
      ctx.fillRect(13, y, paneW, paneH);
      y += paneH + 7;
    }

    // Crown: cornice and lit "TELEPHONE" sign at the mouth of the gap
    ctx.fillStyle = BOX_RED_DARK;
    ctx.fillRect(-5, 0, PIPE_W + 10, 26);
    ctx.fillStyle = BOX_RED;
    ctx.fillRect(-5, 0, PIPE_W + 10, 6);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(7, 9, PIPE_W - 14, 10);
    ctx.fillStyle = BOX_RED_DARK;
    for (var i = 0; i < 7; i++) ctx.fillRect(11 + i * 7, 12, 3, 4);

    ctx.restore();
  }

  function drawPipes() {
    for (var i = 0; i < pipes.length; i++) {
      var p = pipes[i];
      if (p.x > W || p.x + PIPE_W < 0) continue;
      drawPhoneBox(p.x, 0, p.gapY, true);
      drawPhoneBox(p.x, p.gapY + PIPE_GAP, FLOOR - (p.gapY + PIPE_GAP), false);
    }
  }

  function drawGround() {
    ctx.fillStyle = PAVEMENT;
    ctx.fillRect(0, FLOOR, W, GROUND_H);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, FLOOR, W, 4);

    // Scrolling paving slabs
    ctx.fillStyle = PAVEMENT_LINE;
    var slab = 40;
    var off = scrollX % slab;
    for (var x = -off; x < W; x += slab) ctx.fillRect(x, FLOOR + 10, 2, GROUND_H - 10);
    ctx.fillRect(0, FLOOR + 34, W, 2);
  }

  function drawTicket() {
    ctx.save();
    ctx.translate(TICKET_X, ticket.y);
    ctx.rotate(ticket.rot);

    var w = TICKET_W, h = TICKET_H;
    var x = -w / 2, y = -h / 2;
    var flapPhase = state === PLAYING || state === READY
      ? Math.sin(bobT * 18) * (ticket.vy < 0 ? 2.5 : 1)
      : 0;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + 2, y + 3, w, h);

    // Ticket body
    ctx.fillStyle = PAPER;
    ctx.fillRect(x, y, w, h);

    // Stub, separated by a perforation
    ctx.fillStyle = ACCENT;
    ctx.fillRect(x, y, 13, h);
    ctx.fillStyle = 'rgba(36,27,61,0.45)';
    for (var i = 2; i < h; i += 5) ctx.fillRect(x + 13, y + i, 1, 2);

    // Printed lines
    ctx.fillStyle = INK;
    ctx.fillRect(x + 18, y + 7, 22, 3);
    ctx.fillRect(x + 18, y + 13, 16, 2);
    ctx.fillRect(x + 18, y + 18, 20, 2);

    // Border
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    // Wing — flaps as the ticket climbs
    ctx.fillStyle = '#D9CBFF';
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(x + 16, y + 4);
    ctx.quadraticCurveTo(x + 4, y - 12 + flapPhase, x + 30, y - 6 + flapPhase);
    ctx.quadraticCurveTo(x + 26, y + 2, x + 16, y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  function pixelText(text, cx, y, size, color, outline) {
    ctx.font = '700 ' + size + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (outline !== false) {
      ctx.lineWidth = Math.max(3, size * 0.16);
      ctx.strokeStyle = INK;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, cx, y);
    }
    ctx.fillStyle = color || PAPER;
    ctx.fillText(text, cx, y);
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(36,27,61,0.80)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  function drawHud() {
    if (state === PLAYING || state === DEAD) {
      pixelText(String(score), W / 2, 86, 46, PAPER);
    }

    if (state === READY) {
      pixelText('FLAPPY TICKET', W / 2, 132, 28, ACCENT);
      pixelText('tap to flap', W / 2, 172, 15, PAPER);
      pixelText('best ' + best, W / 2, 200, 13, PAPER);
      // Tap prompt arrow
      var a = 0.55 + Math.sin(bobT * 5) * 0.35;
      ctx.globalAlpha = a;
      pixelText('▲', W / 2, 300 + Math.sin(bobT * 5) * 4, 20, PAPER);
      ctx.globalAlpha = 1;
    }

    if (state === DEAD && deadT > 0.35) {
      var medal = score >= 40 ? 'PLATINUM' : score >= 25 ? 'GOLD' : score >= 10 ? 'SILVER' : score >= 3 ? 'BRONZE' : '—';
      panel(48, 220, W - 96, 150);
      pixelText('GAME OVER', W / 2, 252, 24, ACCENT);
      pixelText('score  ' + score, W / 2, 292, 16, PAPER);
      pixelText('best   ' + best, W / 2, 316, 16, PAPER);
      pixelText('medal  ' + medal, W / 2, 342, 13, PAPER);
      if (deadT > 0.65) {
        ctx.globalAlpha = 0.55 + Math.sin(bobT * 5) * 0.35;
        pixelText('tap to retry', W / 2, 400, 14, PAPER);
        ctx.globalAlpha = 1;
      }
    }
  }

  function render() {
    drawSky();
    drawSkyline();
    drawPipes();
    drawGround();
    drawTicket();
    drawHud();
    if (flashA > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + flashA.toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  // --- Main loop (fixed timestep) -----------------------------------------
  var last = 0;
  var acc = 0;

  function frame(now) {
    if (!last) last = now;
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // tab was backgrounded; don't teleport
    acc += dt;
    while (acc >= STEP) {
      step(STEP);
      acc -= STEP;
    }
    render();
    window.requestAnimationFrame(frame);
  }

  // Crisp rendering on high-DPI displays.
  function fitDpr() {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }

  fitDpr();
  window.addEventListener('resize', fitDpr);
  window.requestAnimationFrame(frame);

  // Exposed for the headless verification script.
  window.__flappy = {
    config: {
      W: W, H: H, FLOOR: FLOOR, GRAVITY: GRAVITY, FLAP_IMPULSE: FLAP_IMPULSE,
      MAX_FALL: MAX_FALL, PIPE_SPEED: PIPE_SPEED, PIPE_W: PIPE_W,
      PIPE_GAP: PIPE_GAP, PIPE_SPACING: PIPE_SPACING
    },
    state: function () {
      return {
        state: state, score: score, best: best, y: ticket.y, vy: ticket.vy,
        pipes: pipes.map(function (p) { return { x: p.x, gapY: p.gapY }; })
      };
    },
    flap: flap
  };
})();
