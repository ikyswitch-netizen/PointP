/*
 * ステージ定義（ステージ制ゲームモード）
 * 各ステージは固定シードで決定的に生成される（test.js で一意性を検証済み）。
 * gen.maxRemove: 空白化する seam の本数（0 = 手がかり全部あり、未指定 = 極限まで削る）
 */
(function (global) {
  'use strict';
  const SEED = 87126;
  const STAGES = [
    {
      title: '点の受け渡し',
      m: 2, n: 2, K: 2, seed: SEED, gen: { maxRemove: 0 },
      lesson: 'ピースはドラッグで配置、クリックで90°回転。点は自分の中心と隣の中心の間を往復しようとする。' +
        '隣が正しければ点は継ぎ目を越えて隣の中心まで届き、また帰ってくる。継ぎ目で点が消えたままなら、そこは間違い。',
    },
    {
      title: '出る点・入る点',
      m: 2, n: 3, K: 2, seed: SEED, gen: { maxRemove: 0 },
      lesson: '同じ色でも向きがある。「先に出る点」と「先に迎える点」が対になって初めてつながる。' +
        '2つの点が同時に出て継ぎ目でぶつかって消えるなら向きが逆 ── クリックで回転して合わせよう。',
    },
    {
      title: '世界はループする',
      m: 3, n: 3, K: 2, seed: SEED, gen: { maxRemove: 0 },
      lesson: 'この盤に端はない。右端の東どなりは左端、下端の南どなりは上端。' +
        '外周の薄い写しは反対側の様子。写しへドロップすると回り込んで置ける。',
    },
    {
      title: 'なにもない辺',
      m: 3, n: 3, K: 3, seed: SEED, gen: { maxRemove: 6 },
      lesson: '点のない辺は「点のない辺」としかつながらない。点が来ないことも立派な手がかり。',
    },
    {
      title: '位置は自由、関係は厳密',
      m: 3, n: 3, K: 3, seed: SEED, gen: {},
      lesson: '完成形は盤全体をずらしても回しても正解のまま。最初の1枚はどこに置いてもいい ── ' +
        '大事なのはピースどうしの相対関係だけ。',
    },
    {
      title: '手がかりは最小限',
      m: 3, n: 4, K: 3, seed: SEED, gen: {},
      lesson: '手がかりはこれ以上削れないところまで間引かれている。それでも解はちょうど1通り' +
        '（全体の移動・回転を除く）。確定する継ぎ目から芋づる式に。',
    },
    {
      title: '広い盤',
      m: 4, n: 4, K: 4, seed: SEED, gen: {},
      lesson: '珍しい色は先に確定する。まず色ごとに点を数えてみよう。',
    },
    {
      title: '高密度',
      m: 5, n: 5, K: 5, seed: SEED, gen: { maxRemove: 16, timeBudgetMs: 20000 },
      lesson: '広くなるほど「1周して戻る」制約が効いてくる。行・列の回り込みに注目。',
    },
    {
      title: 'マスター',
      m: 6, n: 6, K: 6, seed: SEED, gen: { maxRemove: 12, timeBudgetMs: 20000 },
      lesson: '集大成。あなたはもう、点の流れだけで盤が読める。',
    },
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = STAGES;
  global.TorusStages = STAGES;
})(typeof window !== 'undefined' ? window : globalThis);
