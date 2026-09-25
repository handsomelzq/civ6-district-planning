/** 测试用的小工具。构造局面要简洁，否则测试本身会变成需要调试的东西。 */
import { Rules, DEFAULT_TABLE_DIR } from "../src/rules.ts";
import { type Axial, key, disc } from "../src/hex.ts";
import { type BoardState, type Tile } from "../src/board.ts";

export const R = new Rules(DEFAULT_TABLE_DIR);

export const NO_TECH: ReadonlySet<string> = new Set();

/** 从 {"q,r": Tile} 直接建局面。中心默认 (0,0)，人口默认 4。 */
export function board(
  spec: Record<string, Partial<Tile>>,
  opts: Partial<Pick<BoardState, "中心" | "人口" | "文明" | "领袖">> &
    { 已解锁科技?: string[]; 已解锁市政?: string[] } = {},
): BoardState {
  const tiles = new Map<string, Tile>();
  for (const [k, t] of Object.entries(spec)) {
    tiles.set(k, { 地形: "TERRAIN_GRASS", ...t });
  }
  return {
    tiles,
    中心: opts.中心 ?? { q: 0, r: 0 },
    人口: opts.人口 ?? 4,
    文明: opts.文明,
    领袖: opts.领袖,
    已解锁科技: new Set(opts.已解锁科技 ?? []),
    已解锁市政: new Set(opts.已解锁市政 ?? []),
  };
}

/** 半径 rad 的空盘面（全草原）。 */
export function emptyBoard(rad: number, opts = {}): BoardState {
  const spec: Record<string, Partial<Tile>> = {};
  for (const p of disc(rad)) spec[key(p)] = {};
  return board(spec, opts);
}

export const at = (q: number, r: number): Axial => ({ q, r });
