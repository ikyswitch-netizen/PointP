/* Torus Loops — GUI（Canvas 描画・ドラッグ&ドロップ・回転・クリア判定・ステージ制） */
(function () {
  'use strict';
  const E = window.TorusEngine;
  const STAGES = window.TorusStages;
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const rowsSel = $('rows'), colsSel = $('cols'), colorsSel = $('colors');
  const modeSel = $('mode');
  const newBtn = $('newBtn'), resetBtn = $('resetBtn'), peekBtn = $('peekBtn'), solveBtn = $('solveBtn');
  const stageBar = $('stagebar');
  const stagePrevBtn = $('stagePrev'), stageNextBtn = $('stageNext');
  const stageLabel = $('stageLabel'), lessonEl = $('lesson'), nextStageBtn = $('nextStageBtn');
  const toolMoveBtn = $('toolMove'), toolPenBtn = $('toolPen'), toolEraseBtn = $('toolErase');
  const inkClearBtn = $('inkClear');
  const swatchBtns = Array.from(document.querySelectorAll('#inkbar .swatch'));

  const PALETTE = ['#ff5d5d', '#ffb020', '#3ddc84', '#41b0ff', '#b18cff', '#ff6ad5', '#ffe66d', '#2de1c2'];
  const DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N,E,S,W（ローカル）
  const PERIOD = 3.0; // 中心→隣の中心→中心 の1往復（秒）
  const LS = { mode: 'torusloops.mode', stage: 'torusloops.stage.v3', unlocked: 'torusloops.unlocked.v3' };

  function lsGet(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : v; } catch (_) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (_) { /* ignore */ } }

  const state = {
    m: 4, n: 4, K: 4,
    mode: lsGet(LS.mode, 'stage') === 'free' ? 'free' : 'stage',
    stageIdx: 0,
    puzzle: null,
    pieces: [],        // {id, edges, rot, dispRot, loc:{kind:'cell'|'tray'|'drag', idx}, x,y,size}
    generating: false,
    solving: false,
    solverUsed: false,
    cleared: false,
    clearedAt: 0,
    peek: false,
    drag: null,
    time: 0,
    trayN: null, // トレイのスロット数（= 固定されていないピースの数）
    // お絵描き（思考メモ）
    tool: 'move',            // 'move' | 'pen' | 'erase'
    inkColor: '#f2f5ff',
    globalInk: [],           // 盤座標系のストローク {color, w, pts:[{x,y}]}
    inkStroke: null,         // 描画中: {kind:'global'|'piece', p?, stroke, lastX, lastY}
    erasing: false,
  };
  function unlocked() {
    const v = parseInt(lsGet(LS.unlocked, '0'), 10);
    return isNaN(v) ? 0 : Math.min(v, STAGES.length - 1);
  }
  state.stageIdx = Math.min(
    Math.max(0, parseInt(lsGet(LS.stage, '0'), 10) || 0),
    unlocked());
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
    const tN = Math.max(1, state.trayN != null ? state.trayN : N);
    let st = Math.min(s * 0.8, 84);
    let cols = Math.max(1, Math.floor((tW - 2 * pad) / st));
    let rows = Math.ceil(tN / cols);
    while (rows * st > tH - 2 * pad - 20 && st > 26) {
      st *= 0.92;
      cols = Math.max(1, Math.floor((tW - 2 * pad) / st));
      rows = Math.ceil(tN / cols);
    }
    const tx = tX + (tW - cols * st) / 2;
    const ty = tY + Math.max(pad + 14, (tH - rows * st) / 2);
    return {
      W, H, s, bx, by, st, cols, rows, tx, ty, trayN: tN,
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
  // 点の振幅の基準となるマス間隔（中心→継ぎ目 = pitch/2）
  function pitchOf(p) {
    return p.loc.kind === 'tray' ? L.st : L.s;
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
    const free = [];
    for (let i = 0; i < state.pieces.length; i++) {
      if (!state.pieces[i].locked) free.push(i);
    }
    E.shuffle(free, rnd);
    free.forEach((pi, slot) => {
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
    if (placed === N) {
      const gp = [], gr = [];
      for (let i = 0; i < N; i++) { gp.push(occ[i].id); gr.push(occ[i].rot); }
      if (E.checkBoard(state.puzzle.pieces, m, n, gp, gr).length === 0) {
        state.cleared = true;
        state.clearedAt = state.time;
        if (state.mode === 'stage' && !state.solverUsed) {
          if (state.stageIdx + 1 > unlocked()) lsSet(LS.unlocked, state.stageIdx + 1);
        }
      }
    }
    updateStageUI();
    setStatus();
  }

  // ---------- status / stage UI ----------
  function setStatus(msg) {
    if (msg !== undefined) { statusEl.textContent = msg; return; }
    const p = state.puzzle;
    if (!p) { statusEl.textContent = ''; return; }
    const st = p.stats;
    statusEl.textContent =
      `盤 ${p.m}×${p.n} ／ 色 ${p.K} ／ 空白辺 ${st.blankSeams}/${st.totalSeams}` +
      ` ／ 一意解${st.unique ? '検証済み✓' : '未確定'}` +
      (st.locallyMinimal ? '・局所極小' : '') +
      (state.mode === 'free' ? ` ／ seed ${p.seed}` : '') +
      (state.cleared ? ' ／ 🎉 CLEAR!' : '');
  }
  function updateModeUI() {
    const stage = state.mode === 'stage';
    modeSel.value = state.mode;
    for (const el of [rowsSel, colsSel, colorsSel, newBtn]) {
      el.parentElement.tagName === 'LABEL'
        ? (el.parentElement.style.display = stage ? 'none' : '')
        : (el.style.display = stage ? 'none' : '');
    }
    stageBar.style.display = stage ? '' : 'none';
    updateStageUI();
  }
  function updateStageUI() {
    if (state.mode !== 'stage') return;
    const i = state.stageIdx, stg = STAGES[i];
    const done = i < unlocked();
    stageLabel.textContent = `Stage ${i + 1}/${STAGES.length}${done ? ' ✓' : ''}　${stg.title}`;
    lessonEl.textContent = stg.lesson;
    stagePrevBtn.disabled = i <= 0;
    const nextOk = i + 1 < STAGES.length && i + 1 <= unlocked();
    stageNextBtn.disabled = !nextOk;
    nextStageBtn.style.display = (state.cleared && nextOk) ? '' : 'none';
  }
  function gotoStage(i) {
    state.stageIdx = Math.max(0, Math.min(i, STAGES.length - 1, unlocked()));
    lsSet(LS.stage, state.stageIdx);
    regenerate();
  }

  // ---------- 生成 ----------
  let regenQueued = false;
  // 生成 or 手作り面のパズルを盤に据え付ける（locked セルは盤上に固定）
  function installPuzzle(puzzle, scrambleSeed) {
    state.puzzle = puzzle;
    const lockedSet = new Set(puzzle.locked || []);
    state.pieces = puzzle.pieces.map((edges, i) => ({
      id: i, edges, rot: 0, dispRot: 0,
      locked: lockedSet.has(i),
      loc: lockedSet.has(i) ? { kind: 'cell', idx: i } : { kind: 'tray', idx: i },
      x: 0, y: 0, size: 10, ink: [],
    }));
    state.trayN = state.pieces.length - lockedSet.size;
    scatterToTray(E.mulberry32(scrambleSeed >>> 0));
    L = layout();
    for (const p of state.pieces) {
      const t = targetOf(p);
      p.x = t.x; p.y = t.y; p.size = t.size;
      p.dispRot = p.rot;
    }
    state.generating = false;
    if (regenQueued) { regenQueued = false; setTimeout(regenerate, 0); return; }
    updateStageUI();
    setStatus();
  }
  function regenerate() {
    // 生成中の再要求は捨てずに、完了後に最新の設定で作り直す
    if (state.generating) { regenQueued = true; return; }
    state.generating = true;
    state.cleared = false;
    state.solving = false;
    state.solverUsed = false;
    state.peek = false;
    peekBtn.textContent = '答え';
    state.pieces = [];
    state.puzzle = null;
    state.trayN = null;
    state.globalInk = [];
    state.inkStroke = null;
    state.erasing = false;
    let seed, genOpts;
    if (state.mode === 'stage') {
      const stg = STAGES[state.stageIdx];
      state.m = stg.m; state.n = stg.n; state.K = stg.K;
      updateModeUI();
      if (stg.type === 'design') {
        // 手作り面: 生成不要。スクランブルもステージごとに決定的
        installPuzzle(E.puzzleFromDesign(stg), 0xC0FFEE ^ (state.stageIdx * 2654435761));
        return;
      }
      seed = stg.seed;
      genOpts = stg.gen || {};
    } else {
      state.m = +rowsSel.value;
      state.n = +colsSel.value;
      const kv = colorsSel.value;
      state.K = kv === 'auto' ? E.defaultK(state.m, state.n) : +kv;
      seed = (Math.random() * 0xffffffff) >>> 0;
      genOpts = {};
      updateModeUI();
    }
    const it = E.generateSteps(state.m, state.n, state.K, seed, genOpts);
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
        if (regenQueued) { regenQueued = false; setTimeout(regenerate, 0); return; }
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
      installPuzzle(r.value, seed ^ 0x9e3779b9);
    }
    setTimeout(pump, 0);
  }

  // ---------- solver ----------
  function runSolver() {
    if (state.generating || state.solving || !state.puzzle) return;
    state.cleared = false;
    state.solving = true;
    state.solverUsed = true;
    setStatus('ソルバー実行中…');
    setTimeout(() => {
      // 固定ピースがあるステージでは、その配置を前提に解く
      const fixed = state.pieces
        .filter((p) => p.locked && p.loc.kind === 'cell')
        .map((p) => ({ cell: p.loc.idx, piece: p.id, rot: 0 }));
      const opts = { maxCount: 1, nodeCap: 8e6 };
      if (fixed.length) opts.fixed = fixed;
      const res = E.countSolutions(state.puzzle.pieces, state.m, state.n, opts);
      if (res.count < 1) { state.solving = false; setStatus('解が見つかりませんでした'); return; }
      const sol = res.solutions[0];
      let slot = 0;
      state.pieces.forEach((p) => { if (!p.locked) p.loc = { kind: 'tray', idx: slot++ }; });
      const N = state.m * state.n;
      let i = 0;
      const timer = setInterval(() => {
        while (i < N && state.pieces[sol.gp[i]].locked) i++; // 固定ピースは既に盤上
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

  // ---------- お絵描き（思考メモ） ----------
  // 画面インクは盤座標（セル単位）、ピースインクはピースのローカル座標
  // （回転打ち消し + サイズ正規化）で持つ。どちらも移動・リサイズに追従する。
  function toBoardPt(x, y) {
    return { x: (x - L.bx) / L.s, y: (y - L.by) / L.s };
  }
  function toPieceLocal(p, x, y) {
    const dx = x - p.x, dy = y - p.y;
    const a = -p.dispRot * Math.PI / 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    return { x: (dx * cos - dy * sin) / p.size, y: (dx * sin + dy * cos) / p.size };
  }
  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function strokeHit(s, pt, r) {
    const p = s.pts;
    if (p.length === 1) return Math.hypot(pt.x - p[0].x, pt.y - p[0].y) <= r;
    for (let i = 1; i < p.length; i++) {
      if (distToSeg(pt.x, pt.y, p[i - 1].x, p[i - 1].y, p[i].x, p[i].y) <= r) return true;
    }
    return false;
  }
  function startInk(x, y) {
    const p = pieceAt(x, y, true); // 固定ピースにも書ける
    if (p) {
      const stroke = { color: state.inkColor, w: 0.05, pts: [toPieceLocal(p, x, y)] };
      p.ink.push(stroke);
      state.inkStroke = { kind: 'piece', p, stroke, lastX: x, lastY: y };
    } else {
      const stroke = { color: state.inkColor, w: 0.045, pts: [toBoardPt(x, y)] };
      state.globalInk.push(stroke);
      state.inkStroke = { kind: 'global', stroke, lastX: x, lastY: y };
    }
  }
  function addInkPoint(x, y) {
    const st = state.inkStroke;
    if (!st) return;
    if (Math.hypot(x - st.lastX, y - st.lastY) < 2) return; // 間引き
    st.lastX = x; st.lastY = y;
    st.stroke.pts.push(st.kind === 'piece' ? toPieceLocal(st.p, x, y) : toBoardPt(x, y));
  }
  function eraseAt(x, y) {
    const R = 12; // 画面ピクセルでの消しゴム半径
    const bp = toBoardPt(x, y);
    state.globalInk = state.globalInk.filter((s) => !strokeHit(s, bp, R / L.s));
    for (const p of state.pieces) {
      if (!p.ink || !p.ink.length) continue;
      const lp = toPieceLocal(p, x, y);
      p.ink = p.ink.filter((s) => !strokeHit(s, lp, R / p.size));
    }
  }
  function clearAllInk() {
    state.globalInk = [];
    for (const p of state.pieces) p.ink = [];
  }
  function setTool(tool) {
    state.tool = tool;
    toolMoveBtn.classList.toggle('active', tool === 'move');
    toolPenBtn.classList.toggle('active', tool === 'pen');
    toolEraseBtn.classList.toggle('active', tool === 'erase');
    cv.style.cursor = tool === 'move' ? '' : 'crosshair';
  }

  // ---------- 入力 ----------
  function toCanvas(e) {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function pieceAt(x, y, includeLocked) {
    let best = null;
    for (const p of state.pieces) {
      if (p.locked && !includeLocked) continue;
      const h = p.size / 2;
      if (Math.abs(x - p.x) <= h && Math.abs(y - p.y) <= h) best = p;
    }
    return best;
  }
  cv.addEventListener('pointerdown', (e) => {
    if (state.generating || state.solving || !state.puzzle) return;
    const { x, y } = toCanvas(e);
    // お絵描きはクリア後も可（鑑賞しながらメモできる）
    if (state.tool === 'erase' || e.altKey) {
      state.erasing = true;
      eraseAt(x, y);
      try { cv.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
      return;
    }
    if (state.tool === 'pen' || e.shiftKey) {
      startInk(x, y);
      try { cv.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
      return;
    }
    if (state.cleared) return;
    const p = pieceAt(x, y);
    if (!p) return;
    state.drag = { p, from: { ...p.loc }, sx: x, sy: y, moved: false, dx: p.x - x, dy: p.y - y };
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* 合成イベント等では失敗してよい */ }
  });
  cv.addEventListener('pointermove', (e) => {
    const { x, y } = toCanvas(e);
    if (state.inkStroke) { addInkPoint(x, y); return; }
    if (state.erasing) { eraseAt(x, y); return; }
    const d = state.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(x - d.sx, y - d.sy) > 7) {
      d.moved = true;
      d.p.loc = { kind: 'drag' };
    }
    if (d.moved) { d.p.x = x + d.dx; d.p.y = y + d.dy; }
  });
  function endDrag(e, cancelled) {
    if (state.inkStroke) { state.inkStroke = null; return; }
    if (state.erasing) { state.erasing = false; return; }
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
      let rr_ = Math.floor((y - L.by) / L.s), cc = Math.floor((x - L.bx) / L.s);
      rr_ = ((rr_ % m) + m) % m; cc = ((cc % n) + n) % n;
      const cell = rr_ * n + cc;
      const occ = pieceInCell(cell);
      if (occ && occ.locked) { p.loc = { ...d.from }; return; } // 固定ピースは動かせない
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
      for (let i = 0; i < L.trayN; i++) {
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

  // 盤・ハブのみ（点は drawPieceDots で後から重ねる）
  function drawPieceBody(x, y, size, p, alpha, elevated) {
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
    ctx.fillStyle = p.locked ? '#1e2531' : '#242c3c';
    ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = p.locked ? 'rgba(140,165,210,0.16)' : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (p.locked) {
      // 固定ピースの目印: 四隅の留め具
      ctx.fillStyle = 'rgba(140,165,210,0.28)';
      const q = size * 0.1;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(sx * (h - 1), sy * (h - 1 - q));
        ctx.lineTo(sx * (h - 1), sy * (h - 1));
        ctx.lineTo(sx * (h - 1 - q), sy * (h - 1));
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.07, 0, 7);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // 点: 自分の中心と「隣の中心」の間の単振動（振動中心 = 継ぎ目、振幅 = pitch/2）。
  // 自タイル側（a<=1）にいる間だけ描く。正しい隣接では相手側の点が位相の続きを描くので
  // 「中心 → 隣の中心 → 戻る」が1つの点の連続運動に見える。
  function drawPieceDots(x, y, size, pitch, p, alpha, glow) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.dispRot * Math.PI / 2);
    const reach = pitch / 2;
    const ph = 2 * Math.PI * (state.time / PERIOD);
    for (let d = 0; d < 4; d++) {
      const v = p.edges[d];
      if (!v) continue;
      const dir = E.edgeDir(v); // 0=out, 1=in
      // a: 0=自分の中心, 1=継ぎ目, 2=隣の中心
      const a = dir === 0 ? (1 - Math.cos(ph)) : (1 + Math.cos(ph));
      if (a > 1) continue; // タイル外（隣のテリトリー）では描かない
      const col = PALETTE[E.edgeColor(v) % PALETTE.length];
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col;
      if (glow) { ctx.shadowColor = col; ctx.shadowBlur = size * 0.16; }
      ctx.beginPath();
      ctx.arc(DIR[d][0] * a * reach, DIR[d][1] * a * reach, Math.max(2.5, size * 0.068), 0, 7);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ピースに付いた書き込み（ローカル座標 → ピースと一緒に移動・回転・伸縮）
  function drawPieceInk(x, y, size, p, alpha) {
    if (!p.ink || !p.ink.length) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.dispRot * Math.PI / 2);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = alpha * 0.9;
    for (const s of p.ink) {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = Math.max(2, s.w * size);
      const pts = s.pts;
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x * size, pts[0].y * size, Math.max(1.5, s.w * size * 0.6), 0, 7);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0].x * size, pts[0].y * size);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * size, pts[i].y * size);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  // 盤に描いた書き込み（盤座標 → リサイズしてもセルに張り付く）
  function drawGlobalInk() {
    if (!state.globalInk.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.9;
    for (const s of state.globalInk) {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = Math.max(2, s.w * L.s);
      const pts = s.pts;
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(L.bx + pts[0].x * L.s, L.by + pts[0].y * L.s, Math.max(1.5, s.w * L.s * 0.6), 0, 7);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(L.bx + pts[0].x * L.s, L.by + pts[0].y * L.s);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(L.bx + pts[i].x * L.s, L.by + pts[i].y * L.s);
      ctx.stroke();
    }
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
      for (let i = 0; i < L.trayN; i++) {
        const q = slotCenter(i);
        rr(ctx, q.x - L.st * 0.44, q.y - L.st * 0.44, L.st * 0.88, L.st * 0.88, 8);
        ctx.strokeStyle = 'rgba(255,255,255,0.045)';
        ctx.stroke();
      }
    }

    // wrap ゴースト（マージンにはみ出す写し）: 盤→点 の2パス
    ctx.save();
    ctx.beginPath();
    ctx.rect(o.x, o.y, o.w, o.h);
    ctx.clip();
    const ghosts = [];
    for (const p of state.pieces) {
      if (p.loc.kind !== 'cell') continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const gx = p.x + dc * n * s, gy = p.y + dr * m * s;
          if (gx + s < o.x || gx - s > o.x + o.w) continue;
          if (gy + s < o.y || gy - s > o.y + o.h) continue;
          ghosts.push({ gx, gy, p });
        }
      }
    }
    for (const g of ghosts) drawPieceBody(g.gx, g.gy, g.p.size, g.p, 0.35, false);
    for (const g of ghosts) drawPieceDots(g.gx, g.gy, g.p.size, s, g.p, 0.35, false);
    for (const g of ghosts) drawPieceInk(g.gx, g.gy, g.p.size, g.p, 0.35);
    ctx.restore();

    // ピース: 全部の盤を描いてから全部の点を重ねる
    // （点は継ぎ目を越えて描かれるので、後から描く隣の盤に隠されないように）
    const still = [], drag = [];
    for (const p of state.pieces) (p.loc.kind === 'drag' ? drag : still).push(p);
    for (const p of still) drawPieceBody(p.x, p.y, p.size, p, 1, false);
    for (const p of still) drawPieceDots(p.x, p.y, p.size, pitchOf(p), p, 1, true);
    for (const p of still) drawPieceInk(p.x, p.y, p.size, p, 1);
    // 盤への書き込みは静止ピースの上・ドラッグ中ピースの下
    drawGlobalInk();
    for (const p of drag) {
      drawPieceBody(p.x, p.y, p.size, p, 1, true);
      drawPieceDots(p.x, p.y, p.size, pitchOf(p), p, 1, true);
      drawPieceInk(p.x, p.y, p.size, p, 1);
    }

    // 答えパネル
    if (state.peek && state.puzzle) drawPeek();

    // クリア演出: バナーは数秒で消えて、流れる盤面を鑑賞できるようにする
    if (state.cleared) {
      const t = state.time - state.clearedAt;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3);
      ctx.strokeStyle = `rgba(255,205,110,${0.35 + 0.45 * pulse})`;
      ctx.lineWidth = 3;
      rr(ctx, o.x - 5, o.y - 5, o.w + 10, o.h + 10, 13);
      ctx.stroke();
      const BANNER_END = 3.2, FADE_START = 2.3;
      if (t < BANNER_END) {
        const fade = t < FADE_START ? 1 : 1 - (t - FADE_START) / (BANNER_END - FADE_START);
        ctx.globalAlpha = fade;
        const cx = bx + n * s / 2, cy = by + m * s / 2;
        ctx.fillStyle = 'rgba(10,13,20,0.72)';
        rr(ctx, cx - 160, cy - 52, 320, 96, 14);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,220,140,0.98)';
        ctx.font = `700 ${Math.min(46, s * 0.8)}px system-ui`;
        ctx.fillText('CLEAR!', cx, cy);
        ctx.font = '500 13px system-ui';
        ctx.fillStyle = 'rgba(255,235,190,0.92)';
        let sub = 'すべての継ぎ目が整合しました';
        if (state.mode === 'stage') {
          if (state.solverUsed) sub = 'ソルバー使用のためステージ進行には数えません';
          else if (state.stageIdx + 1 >= STAGES.length) sub = '全ステージ制覇！';
          else sub = '次のステージが解放されました';
        }
        ctx.fillText(sub, cx, cy + 26);
        ctx.textAlign = 'start';
        ctx.globalAlpha = 1;
      }
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
    const minis = [];
    for (let cell = 0; cell < m * n; cell++) {
      const r = (cell / n) | 0, c = cell % n;
      minis.push({
        x: x + 12 + c * ps + ps / 2, y: y + 28 + r * ps + ps / 2,
        p: { edges: state.puzzle.pieces[cell], dispRot: 0 },
      });
    }
    for (const q of minis) drawPieceBody(q.x, q.y, ps * 0.94, q.p, 0.95, false);
    for (const q of minis) drawPieceDots(q.x, q.y, ps * 0.94, ps, q.p, 0.95, false);
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
  modeSel.addEventListener('change', () => {
    state.mode = modeSel.value === 'free' ? 'free' : 'stage';
    lsSet(LS.mode, state.mode);
    regenerate();
  });
  stagePrevBtn.addEventListener('click', () => gotoStage(state.stageIdx - 1));
  stageNextBtn.addEventListener('click', () => gotoStage(state.stageIdx + 1));
  nextStageBtn.addEventListener('click', () => gotoStage(state.stageIdx + 1));
  resetBtn.addEventListener('click', () => {
    if (!state.puzzle || state.generating || state.solving) return;
    state.cleared = false;
    state.solverUsed = false;
    scatterToTray(E.mulberry32((Math.random() * 0xffffffff) >>> 0));
    updateStageUI();
    setStatus();
  });
  peekBtn.addEventListener('click', () => {
    state.peek = !state.peek;
    peekBtn.textContent = state.peek ? '答えを隠す' : '答え';
  });
  solveBtn.addEventListener('click', runSolver);
  toolMoveBtn.addEventListener('click', () => setTool('move'));
  toolPenBtn.addEventListener('click', () => setTool('pen'));
  toolEraseBtn.addEventListener('click', () => setTool('erase'));
  for (const b of swatchBtns) {
    b.addEventListener('click', () => {
      state.inkColor = b.dataset.color;
      for (const o of swatchBtns) o.classList.toggle('active', o === b);
      setTool('pen'); // 色を選んだらそのまま描けるように
    });
  }
  inkClearBtn.addEventListener('click', clearAllInk);

  // デバッグ / 自動テスト用フック
  window.__torus = {
    state,
    layout: () => L,
    cellCenter, slotCenter,
    pieceInCell, pieceInSlot,
    checkCleared, gotoStage,
    unlocked, setTool, clearAllInk,
  };

  updateModeUI();
  regenerate();
  scheduleFrame();
})();
