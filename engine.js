/*
 * Torus edge-matching puzzle engine
 * ---------------------------------
 * 盤面: m×n トーラス（上下・左右がループ）。
 * 辺の状態: 0 = なし, 1+2c+d = (色 c, d: 0=out / 1=in)。K 色なら 2K+1 状態。
 * 整合 σ: なし↔なし, (c,out)↔(c,in)。
 *
 * ピース: edges = [N,E,S,W]（ローカル座標）。回転 rot（時計回り 90°×rot）で
 * 世界方向 d に向く辺 = edges[(d - rot + 4) % 4]。
 *
 * 一意性判定: anchor（intended 解でセル0 のピース）をセル0・rot0 に固定した上で、
 * 「残りピースの配置＋向き」の割当てを全探索で数える（assignment 単位の厳密カウント）。
 * ピース実体×回転 0..3 をすべて区別するので、同一ピースの swap・3-cycle・
 * 回転対称ピースの向き替え・行/列シフト等はすべて自動的に別解としてカウントされ、
 * count===1 ⇔ 配置＋向きがちょうど1通り。
 */
(function (global) {
  'use strict';

  // ---------- RNG ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---------- 辺状態 ----------
  const NONE = 0;
  function edgeColor(v) { return (v - 1) >> 1; }
  function edgeDir(v) { return (v - 1) & 1; } // 0=out, 1=in
  function partner(v) { return v === 0 ? 0 : (((v - 1) & 1) === 0 ? v + 1 : v - 1); }
  function matches(a, b) { return b === partner(a); }

  // ---------- ピース ----------
  function facingTuple(edges, rot) {
    const f = new Array(4);
    for (let d = 0; d < 4; d++) f[d] = edges[(d - rot + 4) & 3];
    return f;
  }
  function pieceVariants(edges) {
    const seen = new Set(), out = [];
    for (let r = 0; r < 4; r++) {
      const f = facingTuple(edges, r);
      const k = f.join(',');
      if (!seen.has(k)) { seen.add(k); out.push({ rot: r, f }); }
    }
    return out;
  }
  function canonKey(edges) {
    let best = null;
    for (let r = 0; r < 4; r++) {
      const k = facingTuple(edges, r).join(',');
      if (best === null || k < best) best = k;
    }
    return best;
  }
  function defaultK(m, n) { return Math.max(2, Math.round(Math.sqrt(m * n))); }

  // seam 配列からピースを切り出す。
  // H[r][c] = セル(r,c) の東辺の値（西隣から見れば partner）。
  // V[r][c] = セル(r,c) の南辺の値。
  function buildPieces(m, n, H, V) {
    const pieces = [];
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < n; c++) {
        pieces.push([
          partner(V[(r - 1 + m) % m][c]), // N
          H[r][c],                        // E
          V[r][c],                        // S
          partner(H[r][(c - 1 + n) % n]), // W
        ]);
      }
    }
    return pieces;
  }

  // ---------- solver / 解の数え上げ ----------
  // opts: { maxCount, nodeCap, anchor, fixed }
  //   anchor: ピース番号（セル0・回転0に固定。null で固定なし。既定はピース0）
  //   fixed:  [{cell, piece, rot}, ...] 任意セルの事前固定（指定時は anchor より優先）
  // 割当て（どのピース実体を・どのセルに・どの回転で）を厳密に数える。
  // nodes は「配置に成功した回数」でカウントし nodeCap で打ち切る（capped=true）。
  function countSolutions(pieces, m, n, opts) {
    opts = opts || {};
    const maxCount = opts.maxCount || 2;
    const nodeCap = opts.nodeCap || 2000000;
    const anchor = ('anchor' in opts) ? opts.anchor : 0;
    const N = m * n;
    // 候補インデックス: 要求値（西面 / 北面 / 両方）→ (piece, rot) リスト。
    // 回転 0..3 は facing が同じでもすべて区別して登録する（厳密カウント）。
    let maxV = 0;
    for (let i = 0; i < N; i++) {
      for (let d = 0; d < 4; d++) if (pieces[i][d] > maxV) maxV = pieces[i][d];
    }
    const S = maxV + 2; // partner(v) は v±1 なので +2 で全要求値を覆う
    const all = [];
    const byW = new Array(S), byN = new Array(S), byWN = new Array(S * S);
    for (let k = 0; k < S; k++) { byW[k] = []; byN[k] = []; }
    for (let k = 0; k < S * S; k++) byWN[k] = [];
    for (let pi = 0; pi < N; pi++) {
      for (let rot = 0; rot < 4; rot++) {
        const f = facingTuple(pieces[pi], rot);
        const e = { pi, rot, f };
        all.push(e);
        byW[f[3]].push(e);
        byN[f[0]].push(e);
        byWN[f[3] * S + f[0]].push(e);
      }
    }
    const used = new Array(N).fill(false);
    const gp = new Array(N).fill(-1), gr = new Array(N).fill(0);
    const fN = new Array(N), fE = new Array(N), fS = new Array(N), fW = new Array(N);
    let nodes = 0, count = 0, capped = false;
    const solutions = [];

    function setCell(cell, pi, rot, f) {
      used[pi] = true; gp[cell] = pi; gr[cell] = rot;
      fN[cell] = f[0]; fE[cell] = f[1]; fS[cell] = f[2]; fW[cell] = f[3];
    }

    const fixed = opts.fixed ||
      ((anchor != null && anchor >= 0) ? [{ cell: 0, piece: anchor, rot: 0 }] : []);
    for (const fx of fixed) {
      setCell(fx.cell, fx.piece, ((fx.rot % 4) + 4) % 4,
        facingTuple(pieces[fx.piece], ((fx.rot % 4) + 4) % 4));
    }
    // 事前固定どうしの整合を確認（不整合なら解は 0）
    let fixedOk = true;
    for (const fx of fixed) {
      const cell = fx.cell, r = (cell / n) | 0, c = cell - r * n;
      const e = r * n + ((c + 1) % n), s = ((r + 1) % m) * n + c;
      if (gp[e] !== -1 && !matches(fE[cell], fW[e])) fixedOk = false;
      if (gp[s] !== -1 && !matches(fS[cell], fN[s])) fixedOk = false;
    }

    function rec(cell) {
      while (cell < N && gp[cell] !== -1) cell++;
      if (cell === N) {
        count++;
        if (solutions.length < maxCount) solutions.push({ gp: gp.slice(), gr: gr.slice() });
        return;
      }
      const r = (cell / n) | 0, c = cell - r * n;
      // 置かれている隣接セル（トーラスなので4方向すべて wrap あり）からの要求値。
      // 「なし」(0) も具体的な要求なので、番兵は -1。
      const wIdx = c > 0 ? cell - 1 : cell + n - 1;
      const nIdx = r > 0 ? cell - n : cell + (m - 1) * n;
      const eIdx = c < n - 1 ? cell + 1 : cell - n + 1;
      const sIdx = r < m - 1 ? cell + n : c;
      const reqW = gp[wIdx] !== -1 ? partner(fE[wIdx]) : -1;
      const reqN = gp[nIdx] !== -1 ? partner(fS[nIdx]) : -1;
      const reqE = gp[eIdx] !== -1 ? partner(fW[eIdx]) : -1;
      const reqS = gp[sIdx] !== -1 ? partner(fN[sIdx]) : -1;
      let list;
      if (reqW >= 0 && reqN >= 0) list = byWN[reqW * S + reqN];
      else if (reqW >= 0) list = byW[reqW];
      else if (reqN >= 0) list = byN[reqN];
      else list = all;
      for (let li = 0; li < list.length; li++) {
        const e = list[li];
        if (used[e.pi]) continue;
        const f = e.f;
        if (reqE >= 0 && f[1] !== reqE) continue;
        if (reqS >= 0 && f[2] !== reqS) continue;
        if (++nodes > nodeCap) { capped = true; return; }
        setCell(cell, e.pi, e.rot, f);
        rec(cell + 1);
        used[e.pi] = false; gp[cell] = -1;
        if (capped || count >= maxCount) return;
      }
    }
    if (fixedOk) rec(0);
    return { count, completed: !capped, nodes, solutions };
  }

  // 任意の配置の整合チェック。gp[cell]=ピース番号(-1で空), gr[cell]=回転。
  // 両側が埋まっている seam のうち不整合なものを返す。
  function checkBoard(pieces, m, n, gp, gr) {
    const N = m * n;
    const face = new Array(N);
    for (let i = 0; i < N; i++) {
      face[i] = (gp[i] == null || gp[i] < 0) ? null : facingTuple(pieces[gp[i]], ((gr[i] % 4) + 4) % 4);
    }
    const bad = [];
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const e = r * n + ((c + 1) % n);
        const s = ((r + 1) % m) * n + c;
        if (face[i] && face[e] && !matches(face[i][1], face[e][3])) bad.push({ type: 'H', r, c });
        if (face[i] && face[s] && !matches(face[i][2], face[s][0])) bad.push({ type: 'V', r, c });
      }
    }
    return bad;
  }

  // 手作り盤面（H/V を直接指定）からパズルを作る。
  // d: { m, n, K, H, V, locked: [cell...] }
  // locked セルは intended のピースを回転0で事前固定した上で、残りの
  // 「配置＋向き」がちょうど1通りかを全探索で検証する（locked が空なら anchor 方式）。
  function puzzleFromDesign(d) {
    const m = d.m, n = d.n;
    const pieces = buildPieces(m, n, d.H, d.V);
    const locked = d.locked || [];
    const opts = { maxCount: 2, nodeCap: d.nodeCap || 2000000 };
    if (locked.length) opts.fixed = locked.map((cell) => ({ cell, piece: cell, rot: 0 }));
    const res = countSolutions(pieces, m, n, opts);
    let blank = 0;
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < n; c++) { if (d.H[r][c] === 0) blank++; if (d.V[r][c] === 0) blank++; }
    }
    return {
      m, n, K: d.K, seed: d.seed || 0, H: d.H, V: d.V, pieces,
      locked: locked.slice(),
      stats: {
        blankSeams: blank, totalSeams: 2 * m * n,
        unique: res.completed && res.count === 1,
        designed: true, verifyNodes: res.nodes,
        baseAttempts: 0, carveChecks: 0, removed: 0, locallyMinimal: false, ms: 0,
      },
    };
  }

  // ---------- 生成器 ----------
  // 1) 全 seam をランダムに彩色した「完全な解」を作り、一意性を確認（だめなら作り直し）。
  // 2) seam をランダム順に「なし」へ落とし、一意性が保てるものだけ採用（数独式の削り）。
  //    1パスで何も削れなくなるまで繰り返す（時間予算あり）→ 予算内なら局所極小。
  function* generateSteps(m, n, K, seed, opts) {
    opts = opts || {};
    const nodeCap = opts.nodeCap || 1500000;
    const passesMax = opts.passes || 6;
    const timeBudgetMs = opts.timeBudgetMs || 6000;
    // 削る seam 本数の上限（ステージ用: 0 = 削らない, 未指定 = 無制限）
    const maxRemove = ('maxRemove' in opts && opts.maxRemove != null) ? opts.maxRemove : Infinity;
    const rnd = mulberry32(seed >>> 0);
    const t0 = Date.now();

    let H, V, pieces, baseAttempts = 0, ok = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      baseAttempts++;
      H = []; V = [];
      for (let r = 0; r < m; r++) {
        H.push([]); V.push([]);
        for (let c = 0; c < n; c++) {
          H[r].push(1 + Math.floor(rnd() * 2 * K));
          V[r].push(1 + Math.floor(rnd() * 2 * K));
        }
      }
      pieces = buildPieces(m, n, H, V);
      const res = countSolutions(pieces, m, n, { maxCount: 2, nodeCap });
      if (res.completed && res.count === 1) { ok = true; break; }
      yield { phase: 'base', attempt: attempt + 1 };
    }
    if (!ok) throw new Error('一意な基礎盤面を作れませんでした（色数を増やしてください）');

    const seams = [];
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < n; c++) { seams.push(['H', r, c]); seams.push(['V', r, c]); }
    }
    const total = seams.length;
    let removed = 0, carveChecks = 0, timeUp = false, converged = false, capReached = maxRemove <= 0;
    for (let pass = 0; pass < passesMax && !timeUp && !capReached; pass++) {
      let changed = false;
      shuffle(seams, rnd);
      let idx = 0;
      for (let si = 0; si < seams.length; si++) {
        idx++;
        const t = seams[si][0], r = seams[si][1], c = seams[si][2];
        const grid = t === 'H' ? H : V;
        if (grid[r][c] === 0) continue;
        if (Date.now() - t0 > timeBudgetMs) { timeUp = true; break; }
        const old = grid[r][c];
        grid[r][c] = 0;
        const p2 = buildPieces(m, n, H, V);
        const res = countSolutions(p2, m, n, { maxCount: 2, nodeCap });
        carveChecks++;
        if (res.completed && res.count === 1) { removed++; changed = true; }
        else grid[r][c] = old;
        yield { phase: 'carve', pass: pass + 1, done: idx, total, removed };
        if (removed >= maxRemove) { capReached = true; break; }
      }
      if (!changed && !timeUp && !capReached) { converged = true; break; }
    }

    pieces = buildPieces(m, n, H, V);
    const verify = countSolutions(pieces, m, n, { maxCount: 2, nodeCap: nodeCap * 4 });
    let blank = 0;
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < n; c++) { if (H[r][c] === 0) blank++; if (V[r][c] === 0) blank++; }
    }
    return {
      m, n, K, seed, H, V, pieces,
      stats: {
        blankSeams: blank, totalSeams: 2 * m * n,
        baseAttempts, carveChecks, removed,
        unique: verify.completed && verify.count === 1,
        locallyMinimal: converged,
        verifyNodes: verify.nodes,
        ms: Date.now() - t0,
      },
    };
  }
  function generateSync(m, n, K, seed, opts) {
    const it = generateSteps(m, n, K, seed, opts);
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
    }
  }

  const api = {
    NONE, mulberry32, shuffle,
    edgeColor, edgeDir, partner, matches,
    facingTuple, pieceVariants, canonKey, defaultK,
    buildPieces, countSolutions, checkBoard,
    puzzleFromDesign, generateSteps, generateSync,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.TorusEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
