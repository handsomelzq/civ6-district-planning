import { type BoardState } from "./board.ts";
import { evaluate, type YieldTree } from "./evaluate.ts";
import { type Rules } from "./rules.ts";
import { sub, ZERO, isZero, type Rat } from "./rational.ts";

export type ContributionChange = { yield: string; source: string; position?: string;
  rule: string; explanation: string; before: Rat; after: Rat; delta: Rat };
const leaves = (tree: YieldTree) => {
  const out = new Map<string, Omit<ContributionChange, "before" | "after" | "delta"> & { value: Rat }>();
  for (const y of tree.产出) for (const s of y.来源) for (const leaf of s.叶子) {
    const pos = s.位置 ? `${s.位置.q},${s.位置.r}` : undefined;
    const id = JSON.stringify([y.产出类型, s.来源id, pos, leaf.规则id]);
    out.set(id, { yield: y.产出类型, source: s.来源, position: pos, rule: leaf.规则id,
      explanation: leaf.说明, value: leaf.增量 });
  }
  return out;
};
export const yieldDifference = (a: ReadonlyMap<string, Rat>, b: ReadonlyMap<string, Rat>) =>
  new Map([...new Set([...a.keys(), ...b.keys()])].sort().map(y => [y, sub(b.get(y) ?? ZERO, a.get(y) ?? ZERO)]));

export function compareBoards(rules: Rules, a: BoardState, b: BoardState) {
  const before = evaluate(rules, a), after = evaluate(rules, b);
  const left = leaves(before), right = leaves(after);
  const changes: ContributionChange[] = [];
  for (const id of new Set([...left.keys(), ...right.keys()])) {
    const x = left.get(id), z = right.get(id), delta = sub(z?.value ?? ZERO, x?.value ?? ZERO);
    if (!isZero(delta)) changes.push({ ...(z ?? x)!, before: x?.value ?? ZERO, after: z?.value ?? ZERO, delta });
  }
  const cities = [...new Set([...before.城市合计.keys(), ...after.城市合计.keys()])].map(id => ({ id,
    name: b.城市?.find(c => c.id === id)?.名称 ?? a.城市?.find(c => c.id === id)?.名称 ?? id,
    before: before.城市合计.get(id) ?? new Map(), after: after.城市合计.get(id) ?? new Map(),
    delta: yieldDifference(before.城市合计.get(id) ?? new Map(), after.城市合计.get(id) ?? new Map()) }));
  const geography = (board: BoardState) => JSON.stringify({
    cities: board.城市?.map(c => ({ id: c.id, center: c.中心 })).sort((a,b) => a.id.localeCompare(b.id)),
    center: board.中心,
    rivers: board.河道, tiles: [...board.tiles].sort(([a], [b]) => a.localeCompare(b))
      .map(([id, t]) => [id, t.地形, t.地貌, t.资源, t.湖泊, t.淡水, t.河流边, t.自然奇观]) });
  return { before, after, delta: yieldDifference(before.合计, after.合计), cities, changes,
    sameGeography: geography(a) === geography(b) };
}
