/* engine.js の検証テスト（node test.js で実行） */
'use strict';
const E = require('./engine.js');

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok -', msg);
  else { fails++; console.error('  FAIL -', msg); }
}

console.log('== 辺エンコーディング / σ ==');
{
  let inv = true;
  for (let v = 0; v <= 16; v++) if (E.partner(E.partner(v)) !== v) inv = false;
  ok(inv, 'partner は対合 (σ∘σ = id)');
  ok(E.partner(0) === 0, 'なし ↔ なし');
  ok(E.matches(0, 0), 'match(なし, なし)');
  ok(E.matches(1, 2) && E.matches(2, 1), 'match((c0,out),(c0,in)) 両向き');
  ok(!E.matches(1, 1) && !E.matches(2, 2), 'out-out / in-in は不整合');
  ok(!E.matches(1, 3) && !E.matches(1, 4), '色違いは不整合');
}

console.log('== 割当て単位の厳密カウント ==');
{
  // 全ピース空白の 3×3: 空白ピースの swap や向き替えも別割当てとして数える → 複数解
  const pieces = Array.from({ length: 9 }, () => [0, 0, 0, 0]);
  const res = E.countSolutions(pieces, 3, 3, { maxCount: 2, nodeCap: 1e6 });
  ok(res.count >= 2, `全空白 3×3 は複数解（退化を許さない） (count=${res.count})`);
}
{
  // 横一列ストライプ（行ごとに向きを反転できる）→ 複数解として検出されるはず
  const m = 3, n = 3;
  const H = [], V = [];
  for (let r = 0; r < m; r++) { H.push([1, 1, 1]); V.push([0, 0, 0]); }
  const pieces = E.buildPieces(m, n, H, V);
  const res = E.countSolutions(pieces, m, n, { maxCount: 2, nodeCap: 1e6 });
  ok(res.count >= 2, `ストライプ盤は複数解と判定 (count=${res.count})`);
}
{
  // 全 seam 同一色の一様盤 → 全ピースが同一になり、swap が別解として数えられるはず
  const m = 3, n = 3;
  const H = [], V = [];
  for (let r = 0; r < m; r++) { H.push([1, 1, 1]); V.push([3, 3, 3]); }
  const pieces = E.buildPieces(m, n, H, V);
  const res = E.countSolutions(pieces, m, n, { maxCount: 2, nodeCap: 1e6 });
  ok(res.count >= 2, `同一ピースの swap は別解として検出 (count=${res.count})`);
}

console.log('== 事前固定（fixed）つきの数え上げ ==');
{
  // 全空白盤で 8/9 を固定しても、残り1枚の向きが区別できず 4 解 → 非一意
  const pieces = Array.from({ length: 9 }, () => [0, 0, 0, 0]);
  const fixed = Array.from({ length: 8 }, (_, i) => ({ cell: i, piece: i, rot: 0 }));
  const res = E.countSolutions(pieces, 3, 3, { fixed, maxCount: 5, nodeCap: 1e6 });
  ok(res.completed && res.count === 4, `空白ピースの残り1枚は回転4通りが全部解 (count=${res.count})`);
}
{
  // 互いに矛盾する固定 → 解は 0
  const puz = E.generateSync(3, 3, 3, 4242, { maxRemove: 0 });
  const wrongRot = E.pieceVariants(puz.pieces[1])[1].rot; // facing が変わる回転を選ぶ
  const fixed = [
    { cell: 0, piece: 0, rot: 0 },
    { cell: 1, piece: 1, rot: wrongRot }, // わざと回転をずらす
  ];
  const res = E.countSolutions(puz.pieces, 3, 3, { fixed, maxCount: 2, nodeCap: 1e6 });
  ok(res.completed && res.count === 0, `矛盾した固定は解なしと判定 (count=${res.count})`);
}

console.log('== 生成器（各サイズ） ==');
const sizes = [[2, 4], [3, 3], [4, 4], [3, 5], [5, 5], [6, 6]];
for (const [m, n] of sizes) {
  const K = E.defaultK(m, n);
  const N = m * n;
  const t0 = Date.now();
  const puz = E.generateSync(m, n, K, 1000 + m * 37 + n, {});
  const ms = Date.now() - t0;
  console.log(`-- ${m}×${n} (K=${K}): 空白辺 ${puz.stats.blankSeams}/${puz.stats.totalSeams}, ` +
    `基礎盤面試行 ${puz.stats.baseAttempts}, 削りチェック ${puz.stats.carveChecks}, ` +
    `局所極小=${puz.stats.locallyMinimal}, ${ms}ms`);

  ok(puz.stats.unique, '最終盤面の一意性を全探索で検証済み');

  const gp = Array.from({ length: N }, (_, i) => i);
  const gr = new Array(N).fill(0);
  ok(E.checkBoard(puz.pieces, m, n, gp, gr).length === 0, 'intended 解は全 seam 整合');

  // トーラス平行移動は全部そのまま解（GUI のクリア判定と同じ条件）
  let allOk = true;
  for (let dr = 0; dr < m; dr++) {
    for (let dc = 0; dc < n; dc++) {
      const g2 = [], r2 = [];
      for (let r = 0; r < m; r++) {
        for (let c = 0; c < n; c++) {
          g2.push(gp[((r - dr + m) % m) * n + ((c - dc + n) % n)]);
          r2.push(0);
        }
      }
      if (E.checkBoard(puz.pieces, m, n, g2, r2).length !== 0) allOk = false;
    }
  }
  ok(allOk, `全 ${m * n} 通りの平行移動も解のまま`);

  // 正方形なら盤全体の 90° 回転も解のまま
  if (m === n) {
    const g2 = new Array(N), r2 = new Array(N);
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < n; c++) {
        g2[c * n + (m - 1 - r)] = gp[r * n + c];
        r2[c * n + (m - 1 - r)] = 1;
      }
    }
    ok(E.checkBoard(puz.pieces, m, n, g2, r2).length === 0, '盤全体の 90° 回転も解のまま');
  }

  // 1ピースだけ回転を変えると必ずどこかの seam が壊れる
  let target = -1;
  for (let i = 0; i < N; i++) {
    if (E.pieceVariants(puz.pieces[i]).length > 1) { target = i; break; }
  }
  if (target >= 0) {
    const r3 = gr.slice();
    r3[target] = E.pieceVariants(puz.pieces[target])[1].rot;
    ok(E.checkBoard(puz.pieces, m, n, gp, r3).length > 0, '1ピースの回転ズレで不整合が出る');
  }

  // solver が見つける解 = intended の盤面状態
  const res = E.countSolutions(puz.pieces, m, n, { maxCount: 2, nodeCap: 4e6 });
  ok(res.completed && res.count === 1, `全探索でも解は厳密に 1 (nodes=${res.nodes})`);
  let same = true;
  const sol = res.solutions[0];
  for (let i = 0; i < N; i++) {
    const f1 = E.facingTuple(puz.pieces[sol.gp[i]], sol.gr[i]).join();
    const f2 = E.facingTuple(puz.pieces[i], 0).join();
    if (f1 !== f2) same = false;
  }
  ok(same, 'solver の解は intended と同じ盤面状態');

  // 局所極小性: 残っている色付き seam をどれか1本消すと一意性が壊れる（収束した場合のみ厳密）
  if (puz.stats.locallyMinimal) {
    let removable = 0, checked = 0;
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < n; c++) {
        for (const grid of [puz.H, puz.V]) {
          if (grid[r][c] === 0) continue;
          const old = grid[r][c];
          grid[r][c] = 0;
          const p2 = E.buildPieces(m, n, puz.H, puz.V);
          const q = E.countSolutions(p2, m, n, { maxCount: 2, nodeCap: 1.5e6 });
          if (q.completed && q.count === 1) removable++;
          grid[r][c] = old;
          checked++;
        }
      }
    }
    ok(removable === 0, `局所極小: 残り ${checked} 本のどの seam も単独では消せない (removable=${removable})`);
  }
}

console.log('== ステージ（手作り面 + 固定シード生成） ==');
const STAGES = require('./stages.js');
for (let i = 0; i < STAGES.length; i++) {
  const st = STAGES[i];
  let puz;
  if (st.type === 'design') {
    puz = E.puzzleFromDesign(st);
    ok(puz.stats.unique,
      `Stage${i + 1}「${st.title}」design ${st.m}×${st.n}: 固定 ${st.locked.length} 枚のもとで完成は一意`);
    // 自由ピースは回転が意味を持つ（4回転の facing が全部違う）こと
    const free = [];
    for (let c = 0; c < st.m * st.n; c++) if (!st.locked.includes(c)) free.push(c);
    ok(free.every((c) => E.pieceVariants(puz.pieces[c]).length === 4),
      `Stage${i + 1}: 自由ピース ${free.length} 枚すべて回転が有意味`);
  } else {
    const t0 = Date.now();
    puz = E.generateSync(st.m, st.n, st.K, st.seed, st.gen);
    const ms = Date.now() - t0;
    ok(puz.stats.unique,
      `Stage${i + 1}「${st.title}」gen ${st.m}×${st.n} K${st.K}: 一意 (空白 ${puz.stats.blankSeams}/${puz.stats.totalSeams}, ${ms}ms)`);
    if (st.gen && st.gen.maxRemove !== undefined) {
      ok(puz.stats.blankSeams <= st.gen.maxRemove, `Stage${i + 1}: 削り上限 (${st.gen.maxRemove}) 遵守`);
    }
    const puz2 = E.generateSync(st.m, st.n, st.K, st.seed, st.gen);
    ok(JSON.stringify(puz.H) === JSON.stringify(puz2.H) && JSON.stringify(puz.V) === JSON.stringify(puz2.V),
      `Stage${i + 1}: 同シードで決定的`);
  }
  const N = st.m * st.n;
  const gp = Array.from({ length: N }, (_, j) => j);
  const gr = new Array(N).fill(0);
  ok(E.checkBoard(puz.pieces, st.m, st.n, gp, gr).length === 0, `Stage${i + 1}: intended 解は全 seam 整合`);
}

console.log(fails ? `\n${fails} 件の失敗` : '\n全テスト成功');
process.exit(fails ? 1 : 0);
