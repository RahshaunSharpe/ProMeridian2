/* ═══════════════════════════════════════════════════════
   PRO MERIDIAN — Deep Space Starfield
   3D perspective warp: stars fly toward the viewer from
   deep space. Layered depth + nebula clouds + shooting stars.
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Inject canvas as first body child ── */
  const canvas = document.createElement('canvas');
  canvas.id = 'starfield-canvas';
  Object.assign(canvas.style, {
    position: 'fixed',
    top: '0', left: '0',
    width: '100%', height: '100%',
    zIndex: '0',
    pointerEvents: 'none',
  });
  document.body.insertBefore(canvas, document.body.firstChild);

  const ctx = canvas.getContext('2d');
  let W, H, CX, CY;

  /* ── Star color palette ── */
  const COLORS = [
    { r: 255, g: 255, b: 255, w: 50 },   // white
    { r: 200, g: 210, b: 255, w: 22 },   // blue-white
    { r: 240, g: 220, b: 255, w: 14 },   // soft purple
    { r: 180, g: 130, b: 255, w: 8  },   // vivid violet
    { r: 255, g: 240, b: 210, w: 6  },   // warm white
  ];

  function randColor() {
    let r = Math.random() * COLORS.reduce((s, c) => s + c.w, 0);
    for (const c of COLORS) { r -= c.w; if (r <= 0) return c; }
    return COLORS[0];
  }

  /* ── Star pool ── */
  const STAR_COUNT = 160;
  const stars = [];

  function resetStar(s, born) {
    // Fly-away: spawn close (small z, spread out) and recede into the void
    s.x  = (Math.random() - 0.5) * 1.6;
    s.y  = (Math.random() - 0.5) * 1.6;
    s.z  = born ? (Math.random() * 1.8) : (0.15 + Math.random() * 0.45);
    s.pz = s.z;  // previous z (for trail)
    const col = randColor();
    s.r  = col.r; s.g = col.g; s.b = col.b;
    s.speed = 0.03 + Math.random() * 0.06;  // z units per second — slow drift
    s.size  = 0.3 + Math.random() * 0.8;
  }

  for (let i = 0; i < STAR_COUNT; i++) {
    const s = {};
    resetStar(s, true);
    // born=true already spreads z across 0–1.8 so they don't all vanish at once
    stars.push(s);
  }

  /* ── Nebula layer — pre-drawn onto offscreen canvas ── */
  let nebulaCache = null;

  function buildNebula() {
    const nc = document.createElement('canvas');
    nc.width = W; nc.height = H;
    const nc_ctx = nc.getContext('2d');

    const blobs = [
      { cx: 0.15, cy: 0.25, rx: 0.42, ry: 0.30, r: 90,  g: 40,  b: 180, a: 0.022 },
      { cx: 0.85, cy: 0.70, rx: 0.40, ry: 0.28, r: 55,  g: 25,  b: 200, a: 0.018 },
      { cx: 0.50, cy: 0.85, rx: 0.55, ry: 0.20, r: 100, g: 20,  b: 155, a: 0.015 },
      { cx: 0.72, cy: 0.12, rx: 0.32, ry: 0.22, r: 45,  g: 55,  b: 210, a: 0.012 },
      { cx: 0.22, cy: 0.72, rx: 0.30, ry: 0.20, r: 135, g: 25,  b: 190, a: 0.010 },
      { cx: 0.60, cy: 0.40, rx: 0.25, ry: 0.18, r: 70,  g: 10,  b: 160, a: 0.008 },
    ];

    blobs.forEach(c => {
      const grd = nc_ctx.createRadialGradient(
        c.cx * W, c.cy * H, 0,
        c.cx * W, c.cy * H, Math.max(c.rx * W, c.ry * H)
      );
      grd.addColorStop(0,    `rgba(${c.r},${c.g},${c.b},${c.a})`);
      grd.addColorStop(0.45, `rgba(${c.r},${c.g},${c.b},${(c.a * 0.4).toFixed(3)})`);
      grd.addColorStop(1,    `rgba(${c.r},${c.g},${c.b},0)`);

      nc_ctx.save();
      const scaleY = c.ry / c.rx;
      nc_ctx.scale(1, scaleY);
      nc_ctx.fillStyle = grd;
      nc_ctx.beginPath();
      nc_ctx.arc(c.cx * W, (c.cy * H) / scaleY, c.rx * W, 0, Math.PI * 2);
      nc_ctx.fill();
      nc_ctx.restore();
    });

    return nc;
  }

  /* ── Shooting stars ── */
  const shooters = [];
  let nextShooterAt = 12 + Math.random() * 20;
  let elapsed = 0;

  function spawnShooter() {
    const angle = (Math.PI * 0.18) + (Math.random() - 0.5) * (Math.PI * 0.25);
    const startX = Math.random() * W * 0.7;
    const startY = Math.random() * H * 0.4;
    const speed  = 280 + Math.random() * 220;
    shooters.push({
      x: startX, y: startY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0,
      maxLife: 0.55 + Math.random() * 0.5,
      tail: 90 + Math.random() * 100,
    });
    nextShooterAt = elapsed + 15 + Math.random() * 30;
  }

  /* ── Resize ── */
  function resize() {
    W  = canvas.width  = window.innerWidth;
    H  = canvas.height = window.innerHeight;
    CX = W / 2;
    CY = H / 2;
    nebulaCache = buildNebula();
  }

  /* ── Project a 3D star onto the 2D canvas ── */
  function project(x, y, z) {
    const fov = 0.75;   // field of view factor — lower = wider
    const scale = fov / z;
    return {
      sx: x * scale * Math.min(W, H) * 0.5 + CX,
      sy: y * scale * Math.min(W, H) * 0.5 + CY,
      scale,
    };
  }

  /* ── Main draw loop ── */
  let lastTime = performance.now();

  function draw(now) {
    requestAnimationFrame(draw);

    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    elapsed += dt;

    ctx.clearRect(0, 0, W, H);

    /* Nebula */
    if (nebulaCache) ctx.drawImage(nebulaCache, 0, 0);

    /* Stars — 3D warp */
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];

      s.pz = s.z;
      s.z += s.speed * dt;   // recede into the distance

      if (s.z >= 2.0) {
        resetStar(s, false);
        continue;
      }

      const cur  = project(s.x, s.y, s.z);
      const prev = project(s.x, s.y, s.pz);

      // Off-screen cull
      if (cur.sx < -20 || cur.sx > W + 20 || cur.sy < -20 || cur.sy > H + 20) {
        resetStar(s, false);
        continue;
      }

      const brightness = Math.pow(Math.max(0, 1 - s.z / 1.8), 1.8) * 0.55;  // bright when close, fade into void
      const radius     = s.size * cur.scale * 1.2;

      // Draw motion trail (line from previous position to current)
      const trailLen = Math.hypot(cur.sx - prev.sx, cur.sy - prev.sy);
      if (trailLen > 0.5) {
        ctx.beginPath();
        ctx.moveTo(prev.sx, prev.sy);
        ctx.lineTo(cur.sx, cur.sy);
        ctx.strokeStyle = `rgba(${s.r},${s.g},${s.b},${(brightness * 0.35).toFixed(2)})`;
        ctx.lineWidth   = Math.max(0.3, radius * 0.4);
        ctx.stroke();
      }

      // Draw star dot
      ctx.beginPath();
      ctx.arc(cur.sx, cur.sy, Math.max(0.4, radius), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${s.r},${s.g},${s.b},${Math.min(brightness * 0.8, 0.55).toFixed(2)})`;
      ctx.fill();
    }

    /* Shooting stars */
    if (elapsed >= nextShooterAt) spawnShooter();

    for (let i = shooters.length - 1; i >= 0; i--) {
      const s = shooters[i];
      s.life += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      const p = s.life / s.maxLife;
      const alpha = p < 0.12 ? p / 0.12 : p > 0.65 ? (1 - p) / 0.35 : 1.0;

      const tailFrac = Math.min(p * 2.5, 1);
      const tx = s.x - (s.vx / Math.hypot(s.vx, s.vy)) * s.tail * tailFrac;
      const ty = s.y - (s.vy / Math.hypot(s.vx, s.vy)) * s.tail * tailFrac;

      const grd = ctx.createLinearGradient(tx, ty, s.x, s.y);
      grd.addColorStop(0, `rgba(190,155,255,0)`);
      grd.addColorStop(1, `rgba(230,210,255,${(alpha * 0.9).toFixed(2)})`);

      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(s.x, s.y);
      ctx.strokeStyle = grd;
      ctx.lineWidth = 1.0;
      ctx.stroke();

      if (s.life >= s.maxLife || s.x > W + 300 || s.y > H + 300) {
        shooters.splice(i, 1);
      }
    }
  }

  /* ── Boot ── */
  window.addEventListener('resize', () => {
    resize();
  });

  resize();
  requestAnimationFrame(draw);

}());
