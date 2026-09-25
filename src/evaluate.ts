/** 局面求值器 —— 本项目唯一的规则实现处（GDD §1）。
 *
 * 契约：`evaluate(rules, board) -> YieldTree`，**纯函数**。
 *   I1 不修改输入、不读全局、无随机、无时间依赖
 *   I2 幂等
 *   I3 顺序无关（产出是局面的函数，与放置历史无关）
 *   I4 加和完备（树的每一层求和等于父节点）
 * 四条不变量都有自动测试，见 tests/invariants.test.ts。
 *
 * 求值顺序见 设计/SDD-局面求值器.md §3.5，**顺序固定不得调整**。
 * 单条规则的求值见同文档 §3.6，`g` 的形态见 §3.3（2026-09-24 游戏内实测）。
 */
import { type Rat, ZERO, add, mul, div, rat, isZero, cmp } from "./rational.ts";
import { type Axial, key } from "./hex.ts";
import { isNone } from "./csv.ts";
import { type AdjacencyRule, type Rules } from "./rules.ts";
import {
  type BoardState, type Tile, districtPositions, neighborTiles, tileAt, inWorkRange,
} from "./board.ts";

// ── 输出：产出明细树（SDD §3.7）────────────────────────────────────────
export type Tier = "主要档" | "标准档" | "固定";

export type Leaf = {
  readonly 增量: Rat;
  readonly 规则id: string;
  readonly 计数: number;
  readonly 档位: Tier;
  readonly 说明: string;
  /** 规则存在但被跳过（前置未满足 / 被 trait 排除）时为真。增量必为 0。 */
  readonly 未生效?: "前置未满足" | "已废弃" | "被文明排除";
};

export type SourceNode = {
  readonly 来源: string;          // 区域名或建筑名
  readonly 来源id: string;
  readonly 位置?: Axial;
  readonly 合计: Rat;
  readonly 叶子: readonly Leaf[];
};

export type YieldNode = {
  readonly 产出类型: string;
  readonly 合计: Rat;
  readonly 来源: readonly SourceNode[];
};

export type Diagnostic = {
  readonly 级别: "错误" | "提示";
  readonly 位置?: Axial;
  readonly 说明: string;
};

export type YieldTree = {
  readonly 合计: ReadonlyMap<string, Rat>;
  readonly 产出: readonly YieldNode[];
  readonly 诊断: readonly Diagnostic[];
};

// ── g：单条规则的增量（SDD §3.3，2026-09-24 实测）────────────────────
/** `增量 = 相邻符合数 × 加成值 ÷ 所需数量`，**全程不取整**。
 *
 * 「所需数量=2」的真实语义是**每个目标各贡献一半**，不是"凑满 2 个才给"。
 * 所以 3 个相邻区域是 +1.5 而不是 +1。这是实测结论，与提示文本的字面意思相反
 * （见 拆解/文明6-产出与相邻加成体系.md §4.3）。 */
export const g = (计数: number, 所需数量: number, 加成值: Rat): Rat =>
  div(mul(rat(计数), 加成值), rat(所需数量));

const tierOf = (r: AdjacencyRule): Tier =>
  r.目标类别 === "自身" ? "固定" : r.所需数量 === 1 ? "主要档" : "标准档";

// ── 目标匹配（SDD §3.4）──────────────────────────────────────────────
/**
 * ⚠️ `自身` 类别的语义仍未核实（SDD §10 D10）。
 *
 * 全库唯一一条是韩国书院的 `BaseDistrict_Science`（+4 科技，`Self="true"`）。
 * 两种读法：「固定 +4」还是「与自己同类相邻则 +4」。后者在文明 6 里永远不成立
 * （一个区域不可能与自己相邻），会让书院恒为 0 —— 与书院实际有 +4 的表现矛盾。
 * **所以这里按「固定值」实现，并把它收在这一个常量里：** 若实测推翻，只改这里。
 * 受影响的已算数值：L-09 / L-10 的全部读数。
 */
export const SELF_IS_FIXED_VALUE = true;

/** 该邻格是否命中这条规则的目标。`自身` 与 `河流` 不走这里（与邻格无关）。 */
function matchesNeighbor(
  rules: Rules, rule: AdjacencyRule, nb: Tile, civ?: string,
): boolean {
  switch (rule.目标类别) {
    case "地形":
      return nb.地形 === rule.目标id;
    case "地貌":
      return nb.地貌 === rule.目标id;
    case "区域":
      // E11：按 id **精确**匹配。「相邻工业区」不匹配汉萨。
      // 所以要先把邻格的区域解析成有效 id，再与目标 id 比。
      return nb.区域 !== undefined &&
        rules.effective(nb.区域, civ) === rule.目标id;
    case "任意其他区域":
      // "other" 指另一个**格子**，不是另一种类型。两个相邻的学院互相各给 +0.5。
      // 同类型语义由独立的 `自身` 字段承担。
      return nb.区域 !== undefined;
    case "改良设施":
      return nb.改良设施 === rule.目标id;
    case "自然奇观":
      return nb.自然奇观 !== undefined;
    case "世界奇观":
      return nb.世界奇观 !== undefined;
    case "任意资源":
      return nb.资源 !== undefined;
    case "海洋资源":
      // 「是否海洋资源」是**资源**的属性，不是地块的 —— 查 resources 表，
      // 不在 Tile 上再存一份。一份数据两处存储，迟早对不上。
      return nb.资源 !== undefined &&
        rules.resources.get(nb.资源)?.是否海洋资源 === true;
    case "资源类别":
      return nb.资源 !== undefined &&
        rules.resources.get(nb.资源)?.资源类别 === rule.目标id;
    case "无目标":
      // 当前是空集（全库没有这种行），保留为防御性分支。
      return false;
    case "自身":
    case "河流":
      return false;               // 与邻格无关，由 countFor 单独处理
  }
}

/** 这条规则在这个位置命中了几次。 */
function countFor(
  rules: Rules, rule: AdjacencyRule, board: BoardState, p: Axial,
): number {
  if (rule.目标类别 === "自身") return SELF_IS_FIXED_VALUE ? 1 : 0;
  if (rule.目标类别 === "河流") return tileAt(board, p)?.河流边 ? 1 : 0;
  const civ = board.文明;
  let n = 0;
  for (const nb of neighborTiles(board, p)) {
    if (matchesNeighbor(rules, rule, nb, civ)) n++;
  }
  return n;
}

/** 前置 / 废弃校验（SDD §3.6 第 1–2 步、边界 E14）。
 *  当前区域侧 103 条规则里 0 条带前置，这是防御性分支。 */
function gateOf(rule: AdjacencyRule, board: BoardState): Leaf["未生效"] | undefined {
  for (const t of rule.前置科技) if (!board.已解锁科技.has(t)) return "前置未满足";
  for (const c of rule.前置市政) if (!board.已解锁市政.has(c)) return "前置未满足";
  for (const t of rule.废弃科技) if (board.已解锁科技.has(t)) return "已废弃";
  for (const c of rule.废弃市政) if (board.已解锁市政.has(c)) return "已废弃";
  return undefined;
}

// ── 求值 ──────────────────────────────────────────────────────────────
export function evaluate(rules: Rules, board: BoardState): YieldTree {
  const 诊断: Diagnostic[] = [];
  // 第 2 步 · 规则排除：按文明/领袖 trait 摘掉被排除的相邻规则。
  //   必须在替换之后、求值之前。不实现这一步，高卢会表现得比实际强很多。
  const excluded = rules.excludedFor(board.文明, board.领袖);

  // 产出类型 → 来源 id → 节点。用 Map 保插入序，再在最后按稳定序输出。
  const acc = new Map<string, Map<string, { node: SourceNode; leaves: Leaf[] }>>();
  const push = (产出类型: string, srcId: string, 来源: string,
                位置: Axial | undefined, leaf: Leaf) => {
    const byYield = acc.get(产出类型) ?? new Map();
    acc.set(产出类型, byYield);
    const slot = byYield.get(srcId) ??
      { node: { 来源, 来源id: srcId, 位置, 合计: ZERO, 叶子: [] }, leaves: [] };
    byYield.set(srcId, slot);
    slot.leaves.push(leaf);
  };

  for (const p of districtPositions(board)) {
    const tile = tileAt(board, p)!;
    // 第 1 步 · 替换解析：把基础区域 id 解析成这个文明下的有效区域 id。
    const did = rules.effective(tile.区域!, board.文明);
    const dname = rules.name(did);
    const srcKey = `${did}@${key(p)}`;

    // 第 3 步 · 合法性校验：标记而不静默丢弃。
    if (!inWorkRange(board, p)) {
      诊断.push({ 级别: "错误", 位置: p, 说明: `${dname} 超出城市 3 格工作范围（E16）` });
    }

    // 第 4 步 · 地块基础产出：**本期不实现**，理由见文件末尾的「三个空步骤」。
    // 第 5 步 · 区域基础产出：**不存在**，文明 6 的区域自身零产出。

    // 第 6 步 · 相邻求值
    for (const rule of rules.adjacency.get(did) ?? []) {
      const 档位 = tierOf(rule);
      if (excluded.has(rule.原始标识)) {
        // 记零叶子而不是跳过：面板要能显示「这条被你的文明排除了」。
        push(rule.产出类型, srcKey, dname, p, {
          增量: ZERO, 规则id: rule.规则id, 计数: 0, 档位,
          说明: `被 ${board.文明 ?? "?"} 排除`, 未生效: "被文明排除",
        });
        continue;
      }
      const gate = gateOf(rule, board);
      if (gate) {
        push(rule.产出类型, srcKey, dname, p, {
          增量: ZERO, 规则id: rule.规则id, 计数: 0, 档位,
          说明: gate === "已废弃" ? "已被科技/市政废弃" : "前置未满足", 未生效: gate,
        });
        continue;
      }
      const 计数 = countFor(rules, rule, board, p);
      const 增量 = g(计数, rule.所需数量, rule.加成值);
      // ⭐ 即使增量为 0 也记账（边界 E1）：
      //   「为什么没有加成」与「有多少加成」是同等重要的信息。
      push(rule.产出类型, srcKey, dname, p, {
        增量, 规则id: rule.规则id, 计数, 档位,
        说明: describeTarget(rules, rule, 计数),
      });
    }

    // 第 7 步 · 建筑增量
    for (const bid of tile.建筑 ?? []) {
      const b = rules.buildings.get(bid);
      if (!b) {
        诊断.push({ 级别: "错误", 位置: p, 说明: `建筑不存在：${bid}（E15）` });
        continue;
      }
      // E15b：特色区域**沿替换关系继承**基础区域的建筑（书院能建图书馆）。
      //   注意这与相邻规则相反（E10：相邻规则不继承）。两套语义必须分别实现。
      const base = rules.districts.get(did)?.替换区域id;
      const ok = b.所属区域id === did ||
        (base !== undefined && !isNone(base) && b.所属区域id === base);
      if (!ok) {
        诊断.push({
          级别: "错误", 位置: p,
          说明: `${b.名称} 属于 ${rules.name(b.所属区域id)}，不能建在 ${dname} 上（E15）`,
        });
        continue;
      }
      for (const [y, v] of b.基础产出) {
        push(y, `${bid}@${key(p)}`, b.名称, p, {
          增量: v, 规则id: bid, 计数: 1, 档位: "固定", 说明: "建筑产出",
        });
      }
    }
  }

  // 第 8 步 · 文明修正：**本期不实现**，理由见文件末尾。
  // 第 9 步 · 汇总，**不取整**（D4 实测：产出全程按小数累加）。
  const 产出: YieldNode[] = [];
  const 合计 = new Map<string, Rat>();
  for (const y of [...acc.keys()].sort()) {
    const sources: SourceNode[] = [];
    let ytotal = ZERO;
    for (const srcId of [...acc.get(y)!.keys()].sort()) {
      const slot = acc.get(y)!.get(srcId)!;
      let stotal = ZERO;
      for (const l of slot.leaves) stotal = add(stotal, l.增量);
      sources.push({ ...slot.node, 合计: stotal, 叶子: slot.leaves });
      ytotal = add(ytotal, stotal);
    }
    产出.push({ 产出类型: y, 合计: ytotal, 来源: sources });
    合计.set(y, ytotal);
  }
  return { 合计, 产出, 诊断 };
}

function describeTarget(rules: Rules, rule: AdjacencyRule, 计数: number): string {
  const per = rule.所需数量 === 1
    ? `+${rule.加成值.n / rule.加成值.d}/个`
    : `+${rule.加成值.n / rule.加成值.d}/${rule.所需数量}个`;
  const what = isNone(rule.目标id)
    ? rule.目标类别
    : `${rule.目标类别} ${rules.name(rule.目标id)}`;
  return `相邻 ${what} ×${计数}（${per}）`;
}

/** 某个产出类型的总值。目标判定与评分都读这个（不另算一套）。 */
export const total = (tree: YieldTree, 产出类型: string): Rat =>
  tree.合计.get(产出类型) ?? ZERO;

/** I4 加和完备自检：每一层求和必须等于父节点。 */
export function checkAdditive(tree: YieldTree): string[] {
  const bad: string[] = [];
  for (const y of tree.产出) {
    let sum = ZERO;
    for (const s of y.来源) {
      let leafSum = ZERO;
      for (const l of s.叶子) leafSum = add(leafSum, l.增量);
      if (cmp(leafSum, s.合计) !== 0) {
        bad.push(`${y.产出类型}/${s.来源id}：叶子和 ≠ 来源合计`);
      }
      sum = add(sum, s.合计);
    }
    if (cmp(sum, y.合计) !== 0) bad.push(`${y.产出类型}：来源和 ≠ 产出合计`);
    const top = tree.合计.get(y.产出类型);
    if (!top || cmp(top, y.合计) !== 0) bad.push(`${y.产出类型}：产出合计 ≠ 根合计`);
  }
  return bad;
}

/* ══════════════════════════════════════════════════════════════════════
 * 九步求值顺序里有**三步是空的**，而且三步各有不同的理由。都保留编号，
 * 为的是让「为什么没有这一步」显式可见，而不是让读代码的人以为漏了。
 *
 *   第 4 步 地块基础产出   —— 本期不实现。文明 6 的地块产出要经由「市民分配到
 *                            工作地块」才计入城市，那是另一套系统（人口 → 工作
 *                            地块 → 每市民产出），在立项书的范围外。GDD §5 的
 *                            拆解面板示例也只有区域与建筑两类来源，没有地块。
 *   第 5 步 区域基础产出   —— **不存在**。districts.csv 全部 36 行的 基础产出
 *                            都是「无」，文明 6 的区域自身零产出。
 *   第 8 步 文明修正       —— 本期不实现。civs.文明能力 是本地化自然语言文本，
 *                            未做结构化建模；而首期五文明的特色**全部**已经由
 *                            替换（第 1 步）与排除（第 2 步）表达完毕。
 *
 * 三步都空，说明了一件值得写进作品集的事：**文明 6 的区域产出体系几乎完全是
 * 相邻加成 + 建筑两件事**，其余的层要么不存在，要么属于别的子系统。
 * ════════════════════════════════════════════════════════════════════ */
