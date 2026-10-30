// Animated background: floating wireframe globe with flight routes,
// a perspective floor grid, a glowing ring and drifting dust.
(() => {
  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TAU = Math.PI * 2;

  let W = 0, H = 0;
  let targetX = 0, targetY = 0, camX = 0, camY = 0;   // mouse parallax
  let time = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  window.addEventListener("pointermove", (e) => {
    if (reduceMotion) return;
    targetX = e.clientX / W - 0.5;
    targetY = e.clientY / H - 0.5;
  });

  /* ---------- 1. Data: airports (nodes) and routes (edges) ---------- */
  // [latitude, longitude] in degrees
  const AIRPORTS = [
    [40.6, -73.8],   // 0 New York
    [51.5, -0.5],    // 1 London
    [25.2, 55.4],    // 2 Dubai
    [35.5, 139.8],   // 3 Tokyo
    [1.4, 103.9],    // 4 Singapore
    [-33.9, 151.2],  // 5 Sydney
    [-23.4, -46.5],  // 6 Sao Paulo
    [30.1, 31.4],    // 7 Cairo
    [37.6, -122.4],  // 8 San Francisco
    [55.9, 37.4],    // 9 Moscow
    [-26.1, 28.2],   // 10 Johannesburg
    [41.0, 28.8],    // 11 Istanbul
  ];
  // each route is a pair of airport indexes
  const ROUTES = [
    [0, 1], [1, 2], [2, 4], [4, 3], [3, 5], [4, 5], [0, 8], [8, 3],
    [1, 9], [2, 7], [7, 10], [0, 6], [1, 11], [11, 2], [10, 5], [6, 7],
  ];

  /* ---------- 2. Math: lat/lon -> 3D point, great-circle arcs ---------- */
  function toVec(lat, lon) {
    const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
    return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
  }

  // points along the shortest path between a and b, lifted off the surface
  function buildArc(a, b, steps = 48) {
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const omega = Math.acos(dot);
    const s = Math.sin(omega);
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const k1 = Math.sin((1 - t) * omega) / s;
      const k2 = Math.sin(t * omega) / s;
      const lift = 1 + Math.sin(Math.PI * t) * 0.28 * (omega / Math.PI);
      pts.push([
        (a[0] * k1 + b[0] * k2) * lift,
        (a[1] * k1 + b[1] * k2) * lift,
        (a[2] * k1 + b[2] * k2) * lift,
      ]);
    }
    return pts;
  }

  const nodeVecs = AIRPORTS.map(([la, lo]) => toVec(la, lo));
  const arcs = ROUTES.map(([i, j]) => buildArc(nodeVecs[i], nodeVecs[j]));

  // latitude circles and meridians (the wireframe sphere)
  const graticule = [];
  for (let lat = -60; lat <= 60; lat += 20) {
    const line = [];
    for (let lon = 0; lon <= 360; lon += 6) line.push(toVec(lat, lon));
    graticule.push(line);
  }
  for (let lon = 0; lon < 360; lon += 30) {
    const line = [];
    for (let lat = -90; lat <= 90; lat += 6) line.push(toVec(lat, lon));
    graticule.push(line);
  }

  /* ---------- 3. Projection: rotate, then flatten to the screen ---------- */
  let cosY = 1, sinY = 0, cosX = 1, sinX = 0;
  let GX = 0, GY = 0, GR = 1;      // globe centre and radius on screen

  function setView(ry, rx) {
    cosY = Math.cos(ry); sinY = Math.sin(ry);
    cosX = Math.cos(rx); sinX = Math.sin(rx);
  }
  function project(p) {
    const x1 = p[0] * cosY + p[2] * sinY;        // spin around the vertical axis
    const z1 = -p[0] * sinY + p[2] * cosY;
    const y2 = p[1] * cosX - z1 * sinX;          // tilt toward the viewer
    const z2 = p[1] * sinX + z1 * cosX;
    return { x: GX + x1 * GR, y: GY - y2 * GR, z: z2 };   // z > 0 means facing us
  }

  /* ---------- 4. Drawing helpers ---------- */
  function drawGlobe() {
    // soft halo and body
    const halo = ctx.createRadialGradient(GX, GY, GR * 0.9, GX, GY, GR * 1.6);
    halo.addColorStop(0, "rgba(255,255,255,0.06)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(GX, GY, GR * 1.6, 0, TAU); ctx.fill();

    const body = ctx.createRadialGradient(GX - GR * 0.3, GY - GR * 0.35, GR * 0.1, GX, GY, GR);
    body.addColorStop(0, "rgba(255,255,255,0.08)");
    body.addColorStop(1, "rgba(255,255,255,0.005)");
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(GX, GY, GR, 0, TAU); ctx.fill();

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.beginPath(); ctx.arc(GX, GY, GR, 0, TAU); ctx.stroke();

    // grid lines: one batch for the front side, one dimmer batch for the back
    const front = new Path2D(), back = new Path2D();
    for (const line of graticule) {
      let prev = project(line[0]);
      for (let i = 1; i < line.length; i++) {
        const cur = project(line[i]);
        const path = prev.z + cur.z > 0 ? front : back;
        path.moveTo(prev.x, prev.y);
        path.lineTo(cur.x, cur.y);
        prev = cur;
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.stroke(back);
    ctx.strokeStyle = "rgba(255,255,255,0.20)"; ctx.stroke(front);
  }

  function drawRoutes() {
    const front = new Path2D(), back = new Path2D();
    const projected = arcs.map((arc) => arc.map(project));

    for (const pts of projected) {
      for (let i = 1; i < pts.length; i++) {
        const path = pts[i].z + pts[i - 1].z > 0 ? front : back;
        path.moveTo(pts[i - 1].x, pts[i - 1].y);
        path.lineTo(pts[i].x, pts[i].y);
      }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.stroke(back);
    ctx.strokeStyle = "rgba(255,255,255,0.38)"; ctx.stroke(front);

    // a light pulse travelling along every route
    projected.forEach((pts, r) => {
      const phase = (time * 0.11 + r * 0.37) % 1;
      const idx = phase * (pts.length - 1);
      const j = Math.floor(idx), f = idx - j;
      const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
      const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
      const vis = Math.max(0, Math.min(1, (a.z + 0.15) * 3));
      if (vis <= 0) return;

      for (let k = 1; k <= 8; k++) {            // short fading trail
        const p0 = pts[Math.max(j - k + 1, 0)], p1 = pts[Math.max(j - k, 0)];
        ctx.strokeStyle = `rgba(255,255,255,${(0.55 * (1 - k / 8) * vis).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
      ctx.fillStyle = `rgba(255,255,255,${(0.12 * vis).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${(0.95 * vis).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y, 1.8, 0, TAU); ctx.fill();
    });
  }

  function drawAirports() {
    nodeVecs.forEach((v, i) => {
      const p = project(v);
      if (p.z < 0.02) return;                   // hidden behind the globe
      const vis = Math.min(1, p.z * 2.5);
      ctx.fillStyle = `rgba(255,255,255,${(0.9 * vis).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, TAU); ctx.fill();

      const ph = (time * 0.35 + i * 0.21) % 1;  // expanding ring
      ctx.strokeStyle = `rgba(255,255,255,${(0.4 * (1 - ph) * vis).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3 + ph * 12, 0, TAU); ctx.stroke();
    });
  }

  function drawFloor(vx, hy) {
    // soft glow along the horizon
    const hg = ctx.createLinearGradient(0, hy - 80, 0, hy + 80);
    hg.addColorStop(0, "rgba(255,255,255,0)");
    hg.addColorStop(0.5, "rgba(255,255,255,0.035)");
    hg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hg;
    ctx.fillRect(0, hy - 80, W, 160);

    // lines that fan out from the vanishing point, fading in toward us
    const fan = ctx.createLinearGradient(0, hy, 0, H);
    fan.addColorStop(0, "rgba(255,255,255,0)");
    fan.addColorStop(1, "rgba(255,255,255,0.20)");
    ctx.strokeStyle = fan;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const spread = W * 0.16;
    for (let i = -14; i <= 14; i++) {
      ctx.moveTo(vx, hy);
      ctx.lineTo(vx + i * spread, H);
    }
    ctx.stroke();

    // horizontal lines gliding toward the viewer
    const N = 12;
    for (let k = 0; k < N; k++) {
      const f = ((k + time * 0.6) % N) / N;     // 0 = horizon, 1 = near
      const y = hy + (H - hy) * f * f;
      ctx.strokeStyle = `rgba(255,255,255,${(0.03 + f * 0.13).toFixed(3)})`;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }

  function drawRing(cx, cy, rx) {
    const pulse = 0.75 + 0.25 * Math.sin(time * 1.4);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.13);                         // squash a circle into a flat ellipse
    const g = ctx.createRadialGradient(0, 0, rx * 0.2, 0, 0, rx);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.62, `rgba(255,255,255,${(0.05 * pulse).toFixed(3)})`);
    g.addColorStop(0.78, `rgba(255,255,255,${(0.42 * pulse).toFixed(3)})`);
    g.addColorStop(0.86, `rgba(255,255,255,${(0.07 * pulse).toFixed(3)})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
    ctx.restore();
  }

  const motes = Array.from({ length: 90 }, () => ({
    x: Math.random(), y: Math.random(), z: 0.2 + Math.random() * 0.8, s: Math.random() * TAU,
  }));
  function drawMotes(dt) {
    for (const m of motes) {
      m.y -= dt * 0.012 * m.z;
      if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
      const px = m.x * W + Math.sin(time * 0.3 + m.s) * 12 - camX * 60 * m.z;
      const py = m.y * H - camY * 40 * m.z;
      const a = (0.12 + 0.35 * (0.5 + 0.5 * Math.sin(time * 1.2 + m.s))) * m.z;
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(px, py, m.z * 1.4, 0, TAU); ctx.fill();
    }
  }

  /* ---------- 5. Animation loop ---------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!reduceMotion) time += dt;

    camX += (targetX - camX) * 0.05;            // ease toward the mouse position
    camY += (targetY - camY) * 0.05;

    ctx.clearRect(0, 0, W, H);

    GR = Math.min(W * 0.42, H * 0.32);
    GX = W / 2 - camX * 30;
    GY = H * 0.4 + Math.sin(time * 0.6) * 8 - camY * 20;   // gentle float
    setView(time * 0.08 + camX * 0.7, 0.38 + camY * 0.25);

    drawFloor(W / 2 - camX * 40, H * 0.68);
    drawRing(GX, H * 0.84, GR * 1.2);
    drawGlobe();
    drawRoutes();
    drawAirports();
    drawMotes(dt);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();