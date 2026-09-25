/** 轴向坐标的六边形网格。方向顺序与 Tools/prototype_eval.py 的 DIRS 一致，
 *  两份实现必须用同一套邻居定义，否则交叉校验会对不上而且极难查。 */
export type Axial = { readonly q: number; readonly r: number };

export const DIRS: readonly Axial[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

/** 坐标的字符串键。格式与配置表 level_tiles.坐标 一致（`q,r`），
 *  所以它同时是「关卡表的主键」和「内部 Map 的键」，不需要两套。 */
export const key = (p: Axial): string => `${p.q},${p.r}`;

export function parseKey(s: string): Axial {
  const m = /^(-?\d+),(-?\d+)$/.exec(s.trim());
  if (!m) throw new Error(`坐标格式非法（应为 q,r）：${s}`);
  return { q: Number(m[1]), r: Number(m[2]) };
}

export const neighbors = (p: Axial): Axial[] =>
  DIRS.map((d) => ({ q: p.q + d.q, r: p.r + d.r }));

/** 轴向距离。城市 3 格工作范围的判定要用（边界 E16）。 */
export const distance = (a: Axial, b: Axial): number => {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
};

/** 半径 rad 的六边形全集，按 (q, r) 稳定排序。 */
export function disc(rad: number, center: Axial = { q: 0, r: 0 }): Axial[] {
  const out: Axial[] = [];
  for (let q = -rad; q <= rad; q++) {
    for (let r = -rad; r <= rad; r++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= rad) {
        out.push({ q: center.q + q, r: center.r + r });
      }
    }
  }
  return out;
}
