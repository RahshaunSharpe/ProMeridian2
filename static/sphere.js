/* ═══════════════════════════════════════════════════════
   PRO MERIDIAN — 3D Sphere (Three.js)
   Requires Three.js loaded via CDN before this script.
   Exposes:
     window.initSphere3D(containerId)
     window.setSphereMode('IDLE' | 'THINKING' | 'ACTIVE' | 'COMPLETE')
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Mood configurations ──────────────────────────── */
  const MOODS = {
    IDLE: {
      coreHex: 0x9955ff,       // deep violet — calm, watchful
      ringSpeed: [0.003, -0.002, 0.0015],
      pulseRate: 0.7,
      glowScale: 0.65,
      particleOpacity: 0.55,
    },
    THINKING: {
      coreHex: 0x6633dd,       // indigo — concentrated, processing
      ringSpeed: [0.009, -0.007, 0.005],
      pulseRate: 2.2,
      glowScale: 1.0,
      particleOpacity: 0.72,
    },
    ACTIVE: {
      coreHex: 0xcc44ff,       // electric violet — full power, scraping
      ringSpeed: [0.016, -0.013, 0.010],
      pulseRate: 3.2,
      glowScale: 1.4,
      particleOpacity: 0.88,
    },
    COMPLETE: {
      coreHex: 0x44ffcc,       // teal-green — mission done
      ringSpeed: [0.005, -0.003, 0.0022],
      pulseRate: 1.4,
      glowScale: 0.9,
      particleOpacity: 0.65,
    },
  };

  /* ── Module state ─────────────────────────────────── */
  let renderer, scene, camera, clock, animId;
  let coreGroup;          // mouse-tracked group
  let fineWire, coarseWire;
  let glowMeshes = [];
  let ringGroup;
  let rings = [];
  let particleGroup, particleSys;
  let particlePositions;  // Float32Array in local particle space
  let neuralArcs = [];
  let currentMood = 'IDLE';
  let mood = MOODS.IDLE;
  let mouseX = 0, mouseY = 0;
  let _lastFireT = 0;
  let _resizeHandler = null;

  /* ── Public: init ─────────────────────────────────── */
  function initSphere3D(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Teardown any previous instance
    if (renderer) {
      cancelAnimationFrame(animId);
      if (_resizeHandler) window.removeEventListener('resize', _resizeHandler);
      renderer.dispose();
      while (container.firstChild) container.removeChild(container.firstChild);
    }

    const W = container.clientWidth  || 560;
    const H = container.clientHeight || 560;

    /* ── Renderer ── */
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    /* ── Scene / Camera ── */
    scene  = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1000);
    camera.position.z = 3.2;
    clock  = new THREE.Clock();

    /* ── Core group (mouse-tracked) ── */
    coreGroup = new THREE.Group();
    scene.add(coreGroup);

    // Solid dark inner core — blocks the back hemisphere so the sphere reads as solid
    const innerGeo = new THREE.SphereGeometry(0.56, 48, 48);
    const innerMat = new THREE.MeshBasicMaterial({ color: 0x020810, transparent: true, opacity: 0.92 });
    coreGroup.add(new THREE.Mesh(innerGeo, innerMat));

    // Fine geodesic wireframe shell
    const fineGeo = new THREE.IcosahedronGeometry(0.61, 3);
    const fineWireMat = new THREE.MeshBasicMaterial({
      color: 0x9955ff, wireframe: true,
      transparent: true, opacity: 0.20,
    });
    fineWire = new THREE.Mesh(fineGeo, fineWireMat);
    coreGroup.add(fineWire);

    // Coarse geodesic wireframe shell (counter-rotates for depth)
    const coarseGeo = new THREE.IcosahedronGeometry(0.64, 1);
    const coarseWireMat = new THREE.MeshBasicMaterial({
      color: 0x9955ff, wireframe: true,
      transparent: true, opacity: 0.10,
    });
    coarseWire = new THREE.Mesh(coarseGeo, coarseWireMat);
    coreGroup.add(coarseWire);

    /* ── Multi-layer additive glow halos ── */
    const glowSizes  = [0.80, 1.05, 1.38, 1.80];
    const glowAlphas = [0.28, 0.15, 0.075, 0.032];
    glowMeshes = glowSizes.map((r, i) => {
      const geo = new THREE.SphereGeometry(r, 24, 24);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x9955ff,
        transparent: true,
        opacity: glowAlphas[i],
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      return { mesh, baseAlpha: glowAlphas[i] };
    });

    /* ── Orbital rings ── */
    ringGroup = new THREE.Group();
    scene.add(ringGroup);

    const ringDefs = [
      { r: 0.94, tube: 0.0045, tilt: new THREE.Euler(Math.PI / 2, 0, 0),           opacity: 0.48 },
      { r: 1.06, tube: 0.0030, tilt: new THREE.Euler(Math.PI / 2, 0, Math.PI / 5), opacity: 0.30 },
      { r: 1.20, tube: 0.0020, tilt: new THREE.Euler(Math.PI / 2, 0, Math.PI / 3), opacity: 0.19 },
    ];
    rings = ringDefs.map(def => {
      const geo = new THREE.TorusGeometry(def.r, def.tube, 8, 140);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x9955ff,
        transparent: true,
        opacity: def.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.copy(def.tilt);
      ringGroup.add(mesh);
      return { mesh, baseOpacity: def.opacity };
    });

    /* ── Fibonacci particle cloud ── */
    particleGroup = new THREE.Group();
    scene.add(particleGroup);
    _buildParticles(520);

    /* ── Mouse / resize ── */
    renderer.domElement.addEventListener('mousemove', _onMouseMove);
    _resizeHandler = () => _onResize(container);
    window.addEventListener('resize', _resizeHandler);

    /* ── Reset neural arcs ── */
    neuralArcs = [];
    _lastFireT = 0;

    /* ── Go ── */
    clock.start();
    _animate();
  }

  /* ── Build Fibonacci particle sphere ──────────────── */
  function _buildParticles(count) {
    if (particleSys) {
      particleGroup.remove(particleSys);
      particleSys.geometry.dispose();
      particleSys.material.dispose();
    }

    const phi = (1 + Math.sqrt(5)) / 2;
    const pos  = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const theta = Math.acos(1 - 2 * (i + 0.5) / count);
      const phi_i = 2 * Math.PI * i / phi;
      const r = 0.73 + Math.random() * 0.14;
      pos[i * 3]     = r * Math.sin(theta) * Math.cos(phi_i);
      pos[i * 3 + 1] = r * Math.sin(theta) * Math.sin(phi_i);
      pos[i * 3 + 2] = r * Math.cos(theta);
      sizes[i] = 1.6 + Math.random() * 2.8;
    }

    particlePositions = pos;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color: 0x9955ff,
      size: 0.013,
      transparent: true,
      opacity: 0.60,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    particleSys = new THREE.Points(geo, mat);
    particleGroup.add(particleSys);
  }

  /* ── Animation loop ───────────────────────────────── */
  function _animate() {
    animId = requestAnimationFrame(_animate);
    const t = clock.getElapsedTime();

    // ── Breathing: core scale oscillates ──
    const breath = 1.0 + 0.022 * Math.sin(t * mood.pulseRate);
    coreGroup.scale.setScalar(breath);

    // ── Mouse-tracking lazy lerp ──
    coreGroup.rotation.y += (mouseX * 0.55 - coreGroup.rotation.y) * 0.04;
    coreGroup.rotation.x += (mouseY * 0.28 - coreGroup.rotation.x) * 0.04;

    // ── Wireframe shells auto-rotate (independent axes) ──
    fineWire.rotation.y  += mood.ringSpeed[0] * 0.85;
    fineWire.rotation.x  += mood.ringSpeed[1] * 0.50;
    coarseWire.rotation.y -= mood.ringSpeed[0] * 0.45;
    coarseWire.rotation.z += mood.ringSpeed[2] * 0.65;

    // ── Particle cloud slow drift ──
    particleGroup.rotation.y += mood.ringSpeed[0] * 0.22;
    particleGroup.rotation.x += mood.ringSpeed[1] * 0.14;

    // ── Orbital rings ──
    rings[0].mesh.rotation.z += mood.ringSpeed[0];
    rings[1].mesh.rotation.z += mood.ringSpeed[1];
    rings[2].mesh.rotation.z += mood.ringSpeed[2];

    // Slow tilt wobble on outer rings for organic feel
    rings[1].mesh.rotation.x = Math.PI / 2 + 0.11 * Math.sin(t * 0.28);
    rings[2].mesh.rotation.x = Math.PI / 2 + 0.17 * Math.sin(t * 0.19 + 1.1);

    // ── Glow pulse ──
    const glowPulse = 0.82 + 0.18 * Math.sin(t * mood.pulseRate * 0.65);
    glowMeshes.forEach(g => {
      g.mesh.material.opacity  = g.baseAlpha * mood.glowScale * glowPulse;
      g.mesh.material.color.setHex(mood.coreHex);
    });

    // ── Ring / wire color track mood ──
    const moodColor = new THREE.Color(mood.coreHex);
    rings.forEach(r => r.mesh.material.color.copy(moodColor));
    fineWire.material.color.copy(moodColor);
    coarseWire.material.color.copy(moodColor);
    particleSys.material.color.copy(moodColor);
    particleSys.material.opacity = mood.particleOpacity * (0.88 + 0.12 * Math.sin(t * 0.9));

    // ── Neural arc firing ──
    _updateNeuralArcs(t);

    renderer.render(scene, camera);
  }

  /* ── Neural arcs: brief synaptic flashes ─────────── */
  function _updateNeuralArcs(t) {
    // Fade out and remove expired arcs
    neuralArcs = neuralArcs.filter(arc => {
      const age = t - arc.createdAt;
      if (age >= arc.duration) {
        particleGroup.remove(arc.line);
        arc.line.geometry.dispose();
        arc.line.material.dispose();
        return false;
      }
      // Fade: ramp up quickly, hold, then fade out
      const progress = age / arc.duration;
      arc.line.material.opacity = progress < 0.15
        ? (progress / 0.15) * 0.65
        : (1 - progress) * 0.65;
      return true;
    });

    // Fire interval depends on mood activity
    const interval = currentMood === 'ACTIVE' ? 0.10
                   : currentMood === 'THINKING' ? 0.22
                   : currentMood === 'COMPLETE' ? 0.35
                   : 0.70;
    if (t - _lastFireT < interval || !particlePositions) return;
    _lastFireT = t;

    // Pick two random nearby particles
    const n = particlePositions.length / 3;
    const i = Math.floor(Math.random() * n);
    const j = Math.floor(Math.random() * n);

    const ax = particlePositions[i * 3],     ay = particlePositions[i * 3 + 1], az = particlePositions[i * 3 + 2];
    const bx = particlePositions[j * 3],     by = particlePositions[j * 3 + 1], bz = particlePositions[j * 3 + 2];
    const d  = Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2);
    if (d > 0.52) return; // only nearby particles fire

    const pts = [new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz)];
    const geo  = new THREE.BufferGeometry().setFromPoints(pts);
    const mat  = new THREE.LineBasicMaterial({
      color: mood.coreHex,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    // Add as child of particleGroup so it rotates with the particles
    particleGroup.add(line);

    neuralArcs.push({
      line,
      createdAt: t,
      duration: 0.45 + Math.random() * 0.45,
    });
  }

  /* ── Resize ───────────────────────────────────────── */
  function _onResize(container) {
    if (!renderer || !camera) return;
    const W = container.clientWidth;
    const H = container.clientHeight;
    if (!W || !H) return;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
  }

  /* ── Mouse ────────────────────────────────────────── */
  function _onMouseMove(e) {
    if (!renderer) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouseX = ((e.clientX - rect.left) / rect.width  - 0.5) * 1.9;
    mouseY = ((e.clientY - rect.top)  / rect.height - 0.5) * 1.3;
  }

  /* ── Public: set mood ─────────────────────────────── */
  function setSphereMode(modeName) {
    const key = (modeName || 'IDLE').toUpperCase();
    if (!MOODS[key] || key === currentMood) return;
    currentMood = key;
    mood = MOODS[key];
  }

  /* ── Expose globals ───────────────────────────────── */
  window.initSphere3D  = initSphere3D;
  window.setSphereMode = setSphereMode;

}());
