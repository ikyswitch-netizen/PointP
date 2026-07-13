/* Torus Loops — GUI（Canvas 描画・ドラッグ&ドロップ・回転・クリア判定） */
(function () {
  'use strict';
  const E = window.TorusEngine;
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const rowsSel = $('rows'), colsSel = $('cols'), colorsSel = $('colors');
  const newBtn = $('newBtn'), resetBtn = $('resetBtn'), peekBtn = $('peekBtn'), solveBtn = $('solveBtn');

  const PALETTE = ['#ff5d5d', '#ffb020', '#3ddc84', '#41b0ff', '#b18cff', '#ff6ad5', '#ffe66d', '#2de1c2'];
  const DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N,E,S,W（ローカル）
  const PERIOD = 2.6; // 点の往復周期（秒）

  const state = {
    m: 4, n: 4, K: 4,
    puzzle: null,
    pieces: [],        // {id, edges, rot, dispRot, loc:{kind:'cell'|'tray'|'drag', idx}, x,y,size}
    generating: false,
    solving: false,
    cleared: false,
    clearedAt: 0,
    peek: false,
    drag: null,
    time: 0,
  };
  let L = null; // layout cache

  // ---------- layout ----------
  function layout() {
    const W = cv.clientWidth, H = cv.clientHeight;
    const m = state.m, n = state.n, N = m * n;
    const pad = 14;
    const vertical = W < 720;
    let bX, bY, bW, bH, tX, tY, tW, tH;
    if (!vertical) {
      bW = Math.min(W * 0.62, W - 250); bH = H; bX = 0; bY = 0;
      tX = bW; tY = 0; tW = W - bW; tH = H;
    } else {
      bW = W; bH = H * 0.62; bX = 0; bY = 0;
      tX = 0; tY = bH; tW = W; tH = H - bH;
    }
    const s = Math.max(30, Math.min((bW - 2 * pad) / (n + 1), (bH - 2 * pad) / (m + 1), 120));
    const bx = bX + (bW - s * n) / 2;
    const by = bY + (bH - s * m) / 2;
    let st = Math.min(s * 0.8, 84);
    let cols = Math.max(1, Math.floor((tW - 2 * pad) / st));
    let rows = Math.ceil(N / cols);
    while (rows * st > tH - 2 * pad - 20 && st > 26) {
      st *= 0.92;
      cols = Math.max(1, Math.floor((tW - 2 * pad) / st));
      rows = Math.ceil(N / cols);
    }
    const tx = tX + (tW - cols * st) / 2;
    const ty = tY + Math.max(pad + 14, (tH - rows * st) / 2);
    return {
      W, H, s, bx, by, st, cols, rows, tx, ty,
      outer: { x: bx - s / 2, y: by - s / 2, w: n * s + s, h: m * s + s },
    };
  }
  function cellCenter(cell) {
    const r = (cell / state.n) | 0, c = cell % state.n;
    return { x: L.bx + c * L.s + L.s / 2, y: L.by + r * L.s + L.s / 2 };
  }
  function slotCenter(i) {
    return { x: L.tx + (i % L.cols) * L.st + L.st / 2, y: L.ty + ((i / L.cols) | 0) * L.st + L.st / 2 };
  }
  function targetOf(p) {
    if (p.loc.kind === 'cell') { const q = cellCenter(p.loc.idx); return { x: q.x, y: q.y, size: L.s * 0.94 }; }
    if (p.loc.kind === 'tray') { const q = slotCenter(p.loc.idx); return { x: q.x, y: q.y, size: L.st * 0.88 }; }
    return { x: p.x, y: p.y, size: L.s * 0.98 };
  }

  // ---------- pieces ----------
  function pieceInCell(cell) {
    for (const p of state.pieces) if (p.loc.kind === 'cell' && p.loc.idx === cell) return p;
    return null;
  }
  function pieceInSlot(i) {
    for (const p of state.pieces) if (p.loc.kind === 'tray' && p.loc.idx === i) return p;
    return null;
  }
  function scatterToTray(rnd) {
    const idx = state.pieces.map((_, i) => i);
    E.shuffle(idx, rnd);
    idx.forEach((pi, slot) => {
      const p = state.pieces[pi];
      p.loc = { kind: 'tray', idx: slot };
      const r = Math.floor(rnd() * 4);
      p.rot += ((r - (((p.rot % 4) + 4) % 4)) + 4) % 4;
    });
  }

  // ---------- クリア判定 ----------
  function checkCleared() {
    const m = state.m, n = state.n, N = m * n;
    if (!state.puzzle) return;
    const occ = new Array(N).fill(null);
    let placed = 0;
    for (const p of state.pieces) {
      if (p.loc.kind === 'cell') { occ[p.loc.idx] = p; placed++; }
    }
    state.cleared = false;
    if (placed < N) { setStatus(); return; }
    const gp = [], gr = [];
    for (let i = 0; i < N; i++) { gp.push(occ[i].id); gr.push(occ[i].rot); }
    if (E.checkBoard(state.puzzle.pieces, m, n, gp, gr).length === 0) {
      state.cleared = true;
      state.clearedAt = state.time;
    }
    setStatus();
  }

  // ---------- status ----------
  function setStatus(msg) {
    if (msg !== undefined) { statusEl.textContent = msg; return; }
    const p = state.puzzle;
    if (!p) { statusEl.textContent = ''; return; }
    const st = p.stats;
    statusEl.textContent =
      `盤 ${p.m}×${p.n} ／ 色 ${p.K} ／ 空白辺 ${st.blankSeams}/${st.totalSeams}` +
      ` ／ 一意解${st.unique ? '検証済み✓' : '未確定'}` +
      (st.locallyMinimal ? '・局所極小' : '') +
      ` ／ seed ${p.seed}` +
      (state.cleared ? ' ／ 🎉 CLEAR!' : '');
  }

  // ---------- 生成 ----------
  function regenerate() {
    if (state.generating) return;
    state.generating = true;
    state.cleared = false;
    state.solving = false;
    state.peek = false;
    peekBtn.textContent = '答え';
    state.pieces = [];
    state.puzzle = null;
    state.m = +rowsSel.value;
    state.n = +colsSel.value;
    const kv = colorsSel.value;
    state.K = kv === 'auto' ? E.defaultK(state.m, state.n) : +kv;
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const it = E.generateSteps(state.m, state.n, state.K, seed, {});
    setStatus('生成中…');
    function pump() {
      // タブ非表示中はタイマーが間引かれるので、1回あたり大きめに進める
      const chunkMs = document.visibilityState === 'hidden' ? 400 : 14;
      const t0 = performance.now();
      let r;
      try {
        do { r = it.next(); } while (!r.done && performance.now() - t0 < chunkMs);
      } catch (err) {
        state.generating = false;
        setStatus('生成失敗: ' + err.message);
        return;
      }
      if (!r.done) {
        const pr = r.value;
        if (pr.phase === 'carve') setStatus(`手がかりを間引き中… ${pr.done}/${pr.total}（pass ${pr.pass}・${pr.removed}本削除）`);
        else setStatus(`基礎盤面を生成中… (試行 ${pr.attempt})`);
        setTimeout(pump, 0);
        return;
      }
      const puzzle = r.value;
      state.puzzle = puzzle;
      state.pieces = puzzle.pieces.map((edges, i) => ({
        id: i, edges, rot: 0, dispRot: 0,
        loc: { kind: 'tray', idx: i }, x: 0, y: 0, size: 10,
      }));
      scatterToTray(E.mulberry32(seed ^ 0x9e3779b9));
      L = layout();
      for (const p of state.pieces) {
        const t = targetOf(p);
        p.x = t.x; p.y = t.y; p.size = t.size;
        p.dispRot = p.rot;
      }
      state.generating = false;
      setStatus();
    }
    setTimeout(pump, 0);
  }

  // ---------- solver ----------
  function runSolver() {
    if (state.generating || state.solving || !state.puzzle) return;
    state.cleared = false;
    state.solving = true;
    setStatus('ソルバー実行中…');
    setTimeout(() => {
      const res = E.countSolutions(state.puzzle.pieces, state.m, state.n, { maxCount: 1, nodeCap: 8e6 });
      if (res.count < 1) { state.solving = false; setStatus('解が見つかりませんでした'); return; }
      const sol = res.solutions[0];
      state.pieces.forEach((p, i) => { p.loc = { kind: 'tray', idx: i }; });
      const N = state.m * state.n;
      let i = 0;
      const timer = setInterval(() => {
        if (i >= N) {
          clearInterval(timer);
          state.solving = false;
          checkCleared();
          return;
        }
        const p = state.pieces[sol.gp[i]];
        p.rot += ((sol.gr[i] - (((p.rot % 4) + 4) % 4)) + 4) % 4;
        p.loc = { kind: 'cell', idx: i };
        i++;
      }, 90);
    }, 30);
  }

  // ---------- 入力 ----------
  function toCanvas(e) {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function pieceAt(x, y) {
    let best = null;
    for (const p of state.pieces) {
      const h = p.size / 2;
      if (Math.abs(x - p.x) <= h && Math.abs(y - p.y) <= h) best = p;
    }
    return best;
  }
  cv.addEventListener('pointerdown', (e) => {
    if (state.generating || state.solving || state.cleared || !state.puzzle) return;
    const { x, y } = toCanvas(e);
    const p = pieceAt(x, y);
    if (!p) return;
    state.drag = { p, from: { ...p.loc }, sx: x, sy: y, moved: false, dx: p.x - x, dy: p.y - y };
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* 合成イベント等では失敗してよい */ }
  });
  cv.addEventListener('pointermove', (e) => {
    const d = state.drag;
    if (!d) return;
    const { x, y } = toCanvas(e);
    if (!d.moved && Math.hypot(x - d.sx, y - d.sy) > 7) {
      d.moved = true;
      d.p.loc = { kind: 'drag' };
    }
    if (d.moved) { d.p.x = x + d.dx; d.p.y = y + d.dy; }
  });
  function endDrag(e, cancelled) {
    const d = state.drag;
    if (!d) return;
    state.drag = null;
    if (cancelled) { d.p.loc = { ...d.from }; return; }
    if (!d.moved) { d.p.rot += 1; checkCleared(); return; } // クリック = 90° 回転
    const { x, y } = toCanvas(e);
    drop(d, x, y);
    checkCleared();
  }
  cv.addEventListener('pointerup', (e) => endDrag(e, false));
  cv.addEventListener('pointercancel', (e) => endDrag(e, true));

  function drop(d, x, y) {
    const p = d.p;
    const o = L.outer, m = state.m, n = state.n, N = m * n;
    if (x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h) {
      // トーラスなので外周マージンへのドロップは反対側に回り込む
      let rr = Math.floor((y - L.by) / L.s), cc = Math.floor((x - L.bx) / L.s);
      rr = ((rr % m) + m) % m; cc = ((cc % n) + n) % n;
      const cell = rr * n + cc;
      const occ = pieceInCell(cell);
      if (occ && occ !== p) occ.loc = { ...d.from };
      p.loc = { kind: 'cell', idx: cell };
      return;
    }
    // トレイ領域: 最寄りスロットへ（占有されていれば入替え）
    const trayRect = {
      x: L.tx - 20, y: L.ty - 20,
      w: L.cols * L.st + 40, h: L.rows * L.st + 40,
    };
    if (x >= trayRect.x && x < trayRect.x + trayRect.w && y >= trayRect.y && y < trayRect.y + trayRect.h) {
      let bi = -1, bd = Infinity;
      for (let i = 0; i < N; i++) {
        const sc = slotCenter(i);
        const dd = (x - sc.x) ** 2 + (y - sc.y) ** 2;
        if (dd < bd) { bd = dd; bi = i; }
      }
      const occ = pieceInSlot(bi);
      if (occ && occ !== p) occ.loc = { ...d.from };
      p.loc = { kind: 'tray', idx: bi };
      return;
    }
    p.loc = { ...d.from };
  }

  // ---------- 描画 ----------
  function rr(c, x, y, w, h, rad) {
    c.beginPath();
    if (c.roundRect) { c.roundRect(x, y, w, h, rad); return; }
    c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad);
    c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad);
    c.arcTo(x, y, x + w, y, rad);
    c.closePath();
  }

  function drawChevron(cx, cy, dx, dy, dir, size, col, alpha) {
    const o = dir === 0 ? 1 : -1; // out: 外向き / in: 内向き
    const len = size * 0.07;
    const tx = cx + dx * o * len, ty = cy + dy * o * len;
    const px = -dy, py = dx;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1.5, size * 0.028);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tx - dx * o * len * 1.5 + px * len, ty - dy * o * len * 1.5 + py * len);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx - dx * o * len * 1.5 - px * len, ty - dy * o * len * 1.5 - py * len);
    ctx.stroke();
  }

  // p: {edges, dispRot} を (x,y) に size で描く
  function drawPiece(x, y, size, p, alpha, glow, elevated) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.dispRot * Math.PI / 2);
    const h = size / 2;
    if (elevated) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 5;
    }
    ctx.globalAlpha = alpha;
    rr(ctx, -h, -h, size, size, size * 0.15);
    ctx.fillStyle = '#242c3c';
    ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const ph = 2 * Math.PI * (state.time / PERIOD);
    for (let d = 0; d < 4; d++) {
      const v = p.edges[d];
      if (!v) continue;
      const col = PALETTE[E.edgeColor(v) % PALETTE.length];
      const dir = E.edgeDir(v); // 0=out, 1=in
      const dx = DIR[d][0], dy = DIR[d][1];
      const ex = dx * (h - 1), ey = dy * (h - 1);
      // 軌道
      ctx.globalAlpha = alpha * 0.26;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(2, size * 0.05);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      // out/in の静的ヒント（外向き / 内向きの山括弧）
      drawChevron(ex * 0.62, ey * 0.62, dx, dy, dir, size, col, alpha * 0.5);
      // 往復する点: out は t=0 で中心、in は t=0 で辺（位相が半周期ズレ）
      const a = dir === 0 ? (1 - Math.cos(ph)) / 2 : (1 + Math.cos(ph)) / 2;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col;
      if (glow) { ctx.shadowColor = col; ctx.shadowBlur = size * 0.16; }
      ctx.beginPath();
      ctx.arc(ex * a, ey * a, Math.max(2.5, size * 0.068), 0, 7);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    // 中心ハブ
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.07, 0, 7);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function draw() {
    const W = L.W, H = L.H, s = L.s, bx = L.bx, by = L.by;
    const m = state.m, n = state.n, N = m * n;
    ctx.fillStyle = '#0f131b';
    ctx.fillRect(0, 0, W, H);
    const o = L.outer;

    // 盤 + wrap マージン
    rr(ctx, o.x, o.y, o.w, o.h, 10);
    ctx.fillStyle = '#141a26';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= n; c++) {
      ctx.beginPath(); ctx.moveTo(bx + c * s, o.y); ctx.lineTo(bx + c * s, o.y + o.h); ctx.stroke();
    }
    for (let r = 0; r <= m; r++) {
      ctx.beginPath(); ctx.moveTo(o.x, by + r * s); ctx.lineTo(o.x + o.w, by + r * s); ctx.stroke();
    }
    // 実盤の境界（破線）— この外は反対側の写し
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(130,170,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx, by, n * s, m * s);
    ctx.setLineDash([]);
    // 空セルの受け皿
    for (let cell = 0; cell < N; cell++) {
      const q = cellCenter(cell);
      rr(ctx, q.x - s * 0.44, q.y - s * 0.44, s * 0.88, s * 0.88, s * 0.1);
      ctx.fillStyle = 'rgba(255,255,255,0.018)';
      ctx.fill();
    }

    // トレイ
    if (state.pieces.length) {
      const tp = { x: L.tx - 12, y: L.ty - 12, w: L.cols * L.st + 24, h: L.rows * L.st + 24 };
      rr(ctx, tp.x, tp.y, tp.w, tp.h, 10);
      ctx.fillStyle = '#12161f';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '11px system-ui';
      ctx.fillText('手駒（ドラッグで配置・クリックで回転）', tp.x + 8, tp.y - 6);
      for (let i = 0; i < N; i++) {
        const q = slotCenter(i);
        rr(ctx, q.x - L.st * 0.44, q.y - L.st * 0.44, L.st * 0.88, L.st * 0.88, 8);
        ctx.strokeStyle = 'rgba(255,255,255,0.045)';
        ctx.stroke();
      }
    }

    // wrap ゴースト（マージンにはみ出す写し）
    ctx.save();
    ctx.beginPath();
    ctx.rect(o.x, o.y, o.w, o.h);
    ctx.clip();
    for (const p of state.pieces) {
      if (p.loc.kind !== 'cell') continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const gx = p.x + dc * n * s, gy = p.y + dr * m * s;
          if (gx + p.size / 2 < o.x || gx - p.size / 2 > o.x + o.w) continue;
          if (gy + p.size / 2 < o.y || gy - p.size / 2 > o.y + o.h) continue;
          drawPiece(gx, gy, p.size, p, 0.35, false, false);
        }
      }
    }
    ctx.restore();

    // ピース（ドラッグ中のものは最前面）
    const order = [...state.pieces].sort(
      (a, b) => (a.loc.kind === 'drag' ? 1 : 0) - (b.loc.kind === 'drag' ? 1 : 0));
    for (const p of order) {
      drawPiece(p.x, p.y, p.size, p, 1, true, p.loc.kind === 'drag');
    }

    // 答えパネル
    if (state.peek && state.puzzle) drawPeek();

    // クリア演出
    if (state.cleared) {
      const t = state.time - state.clearedAt;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3);
      ctx.strokeStyle = `rgba(255,205,110,${0.35 + 0.45 * pulse})`;
      ctx.lineWidth = 3;
      rr(ctx, o.x - 5, o.y - 5, o.w + 10, o.h + 10, 13);
      ctx.stroke();
      const cx = bx + n * s / 2, cy = by + m * s / 2;
      ctx.fillStyle = 'rgba(10,13,20,0.72)';
      rr(ctx, cx - 150, cy - 52, 300, 96, 14);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,220,140,0.98)';
      ctx.font = `700 ${Math.min(46, s * 0.8)}px system-ui`;
      ctx.fillText('CLEAR!', cx, cy);
      ctx.font = '500 13px system-ui';
      ctx.fillStyle = 'rgba(255,235,190,0.92)';
      ctx.fillText('すべての継ぎ目が整合しました', cx, cy + 26);
      ctx.textAlign = 'start';
    }

    if (state.generating) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(220,227,240,0.75)';
      ctx.font = '500 15px system-ui';
      ctx.fillText('パズル生成中…（一意性を全探索で検証しています）', bx + n * s / 2, by + m * s / 2);
      ctx.textAlign = 'start';
    }
  }

  function drawPeek() {
    const m = state.m, n = state.n;
    const ps = Math.max(20, Math.min(36, (L.W * 0.28) / n));
    const w = n * ps + 24, h = m * ps + 44;
    const x = L.W - w - 12, y = L.H - h - 12;
    rr(ctx, x, y, w, h, 10);
    ctx.fillStyle = 'rgba(9,12,19,0.93)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(200,212,235,0.8)';
    ctx.font = '11px system-ui';
    ctx.fillText('答え（平行移動・回転も正解）', x + 10, y + 17);
    for (let cell = 0; cell < m * n; cell++) {
      const r = (cell / n) | 0, c = cell % n;
      drawPiece(
        x + 12 + c * ps + ps / 2, y + 28 + r * ps + ps / 2, ps * 0.94,
        { edges: state.puzzle.pieces[cell], dispRot: 0 }, 0.95, false, false);
    }
  }

  // ---------- main loop ----------
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    state.time = now / 1000;
    resizeCanvas();
    L = layout();
    const k = 1 - Math.exp(-dt * 14);
    for (const p of state.pieces) {
      const t = targetOf(p);
      if (p.loc.kind !== 'drag') {
        p.x += (t.x - p.x) * k;
        p.y += (t.y - p.y) * k;
      }
      p.size += (t.size - p.size) * k;
      p.dispRot += (p.rot - p.dispRot) * Math.min(1, dt * 11);
    }
    draw();
    scheduleFrame();
  }
  // タブが非表示だと rAF は止まるので setTimeout で低頻度描画を続ける
  function scheduleFrame() {
    if (document.visibilityState === 'hidden') {
      setTimeout(() => frame(performance.now()), 100);
    } else {
      requestAnimationFrame(frame);
    }
  }

  // ---------- UI wiring ----------
  newBtn.addEventListener('click', regenerate);
  rowsSel.addEventListener('change', regenerate);
  colsSel.addEventListener('change', regenerate);
  colorsSel.addEventListener('change', regenerate);
  resetBtn.addEventListener('click', () => {
    if (!state.puzzle || state.generating || state.solving) return;
    state.cleared = false;
    scatterToTray(E.mulberry32((Math.random() * 0xffffffff) >>> 0));
    setStatus();
  });
  peekBtn.addEventListener('click', () => {
    state.peek = !state.peek;
    peekBtn.textContent = state.peek ? '答えを隠す' : '答え';
  });
  solveBtn.addEventListener('click', runSolver);

  // デバッグ / 自動テスト用フック
  window.__torus = {
    state,
    layout: () => L,
    cellCenter, slotCenter,
    pieceInCell, pieceInSlot,
    checkCleared,
  };

  regenerate();
  scheduleFrame();
})();
