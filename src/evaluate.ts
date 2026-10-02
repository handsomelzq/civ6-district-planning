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
  type BoardState, type Tile, districtPositions, neighborTiles, tileAt, cityFor,
} from "./board.ts";
import { validateBoard } from "./legality.ts";

/** 当前静态求值器能完整结算的政策卡。UI 只开放这组卡，避免出现“装上但没效果”。 */
export const SUPPORTED_POLICY_IDS: ReadonlySet<string> = new Set([
  "POLICY_NATURAL_PHILOSOPHY", "POLICY_SCRIPTURE", "POLICY_AESTHETICS",
  "POLICY_CRAFTSMEN", "POLICY_URBAN_PLANNING",
]);

/** 当前表内的信条均可完整结算；集合导出给 UI，避免展示“选了但不生效”的信条。 */
export const SUPPORTED_BELIEF_IDS: ReadonlySet<string> = new Set([
  "BELIEF_DANCE_OF_THE_AURORA", "BELIEF_DESERT_FOLKLORE", "BELIEF_SACRED_PATH",
  "BELIEF_WORK_ETHIC", "BELIEF_LAY_MINISTRY", "BELIEF_DIVINE_INSPIRATION",
  "BELIEF_CHORAL_MUSIC", "BELIEF_FEED_THE_WORLD",
]);

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
  readonly 城市合计: ReadonlyMap<string, ReadonlyMap<string, Rat>>;
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

/** 区域规划政策卡对相邻加成的倍率。政策卡名称和效果来自 policy_cards.csv。
 *
 * 这里只实现本期求值器能表达的四张「相邻加成」卡；建筑、住房和建造者卡仍
 * 保留在研究系统中，但没有对应的局面变量，不会被伪造为产出数字。
 */
function adjacencyPolicyMultiplier(rules: Rules, board: BoardState, districtId: string): {
  multiplier: number; cards: string[];
} {
  const cards = new Set(board.已装配政策);
  const ids: string[] = [];
  const replaced = rules.districts.get(districtId)?.替换区域id;
  const baseId = replaced && !isNone(replaced) ? replaced : districtId;
  if (baseId === "DISTRICT_CAMPUS" && cards.has("POLICY_NATURAL_PHILOSOPHY")) {
    ids.push("POLICY_NATURAL_PHILOSOPHY");
  }
  if (baseId === "DISTRICT_HOLY_SITE" && cards.has("POLICY_SCRIPTURE")) {
    ids.push("POLICY_SCRIPTURE");
  }
  if (baseId === "DISTRICT_THEATER" && cards.has("POLICY_AESTHETICS")) {
    ids.push("POLICY_AESTHETICS");
  }
  if (baseId === "DISTRICT_INDUSTRIAL_ZONE" && cards.has("POLICY_CRAFTSMEN")) {
    ids.push("POLICY_CRAFTSMEN");
  }
  return { multiplier: ids.length ? 2 : 1, cards: ids };
}

const baseDistrictId = (rules: Rules, districtId: string): string => {
  const replaced = rules.districts.get(districtId)?.替换区域id;
  return replaced && !isNone(replaced) ? replaced : districtId;
};

const selectedBeliefs = (board: BoardState): ReadonlySet<string> =>
  board.已选宗教信条 ?? new Set<string>();

/** 宗教窄表中的 `类别:目标:产出:值`。配置生成器已把通用 Modifier 图压平。 */
const beliefEffect = (raw: string): [string, string, string, Rat] => {
  const [kind, target, yieldType, amount] = raw.split(":");
  if (!kind || !target || !yieldType || amount === undefined)
    throw new Error(`宗教结构化效果格式错误：${raw}`);
  return [kind, target, yieldType, rat(Number(amount))];
};

// ── 目标匹配（SDD §3.4）──────────────────────────────────────────────
/**
 * ⚠️ `自身` 类别的语义仍未实测核实（SDD §10 D10）。
 *
 * 全库唯一一条是韩国书院的 `BaseDistrict_Science`（+4 科技，`Self="true"`）。两种读法：
 *   A（本常量为 true）：`Self` 是「给自己加成」的标记，+4 是无条件常数项。
 *   B（本常量为 false）：字面的「与同类相邻」，即挨着**另一座书院**才 +4，可叠加计数。
 *
 * 曾用「一个区域不可能与自己相邻」否掉 B —— 那个论证是无效的，已撤回：B 说的是
 * 相邻另一座同类型区域（两座书院并排），几何上完全可能。
 *
 * 按 A 实现的依据是提示文本：103 条相邻规则里 102 条点明来源（`相邻X`/`来自X`/
 * `如靠近X`），唯独这一条只说「+{1_Num}点 科技值。」。这是先验而非结论 —— 拆解案
 * §4.3 记过一次文案与算法脱节的先例，所以仍须游戏内实测。
 *
 * 两种读法只在**孤立书院**上分叉（A 给 +4，B 给 0）；挨着 1 座书院时两者都给 +3，
 * 所以实测必须用孤立书院这个局面。受影响的已算数值：L-09 / L-10 的全部读数。
 */
export const SELF_IS_FIXED_VALUE = true;

/** 读法 B 的计数：邻格里有几座**同类型**区域（按替换后的有效 id 比较，见 E10/E15b）。
 *
 *  即便当前按读法 A 实现，这个函数也保持导出且被单测覆盖 —— 否则它就是一段没人
 *  验证过的死代码，等实测真翻盘时才发现写错了。`SELF_IS_FIXED_VALUE` 于是是一个
 *  **真正的二选一开关**，而不是「开」与「关」。
 */
export function countSameTypeNeighbors(
  rules: Rules, board: BoardState, p: Axial,
): number {
  const self = tileAt(board, p)?.区域;
  if (self === undefined) return 0;
  const selfId = rules.effective(self, board.文明);
  let same = 0;
  for (const nb of neighborTiles(board, p)) {
    if (nb.区域 !== undefined && rules.effective(nb.区域, board.文明) === selfId) same++;
  }
  return same;
}

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
  if (rule.目标类别 === "自身")
    return SELF_IS_FIXED_VALUE ? 1 : countSameTypeNeighbors(rules, board, p);
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
  // 合法性只在共享入口中实现一次。求值器仍然结算非法局面，
  // 但把每个结构化问题转成现有的面板诊断格式，不静默丢弃产出。
  for (const legality of validateBoard(rules, board)) {
    诊断.push({
      级别: legality.severity === "错误" ? "错误" : "提示",
      位置: legality.position,
      说明: `${legality.message}（${legality.code}）`,
    });
  }
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
    const d = rules.districts.get(did);
    const srcKey = `${did}@${key(p)}`;
    const baseDid = baseDistrictId(rules, did);
    let faithAdjacency = ZERO;

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
      const baseIncrement = g(计数, rule.所需数量, rule.加成值);
      // Self=true 的书院 +4 在游戏中属于学院相邻加成，也受自然哲学翻倍。
      const policy = adjacencyPolicyMultiplier(rules, board, did);
      const 增量 = policy.multiplier === 1
        ? baseIncrement
        : mul(baseIncrement, rat(policy.multiplier));
      if (rule.产出类型 === "信仰") faithAdjacency = add(faithAdjacency, 增量);
      // ⭐ 即使增量为 0 也记账（边界 E1）：
      //   「为什么没有加成」与「有多少加成」是同等重要的信息。
      push(rule.产出类型, srcKey, dname, p, {
        增量, 规则id: rule.规则id, 计数, 档位,
        说明: `${describeTarget(rules, rule, 计数)}${
          policy.cards.length ? `；政策卡生效：${policy.cards.join("、")}` : ""}`,
      });
    }

    // 日本「明治维新」：游戏 TraitModifiers 的六条区域相邻修正。
    // ExcludedAdjacencies 已摘掉对应的五条通用标准档；此处补上 +1/邻格。
    for (const mod of rules.traitAdjacency.get(board.文明 ?? "") ?? []) {
      if (mod.区域id !== did) continue;
      const n = neighborTiles(board, p).filter((t) => t.区域 !== undefined).length;
      const policy = adjacencyPolicyMultiplier(rules, board, did);
      const baseIncrement = mul(rat(n), mod.每邻格加成);
      const increment = policy.multiplier === 1 ? baseIncrement : mul(baseIncrement, rat(2));
      if (mod.产出类型 === "信仰") faithAdjacency = add(faithAdjacency, increment);
      push(mod.产出类型, srcKey, dname, p, {
        增量: increment,
        规则id: mod.修正id, 计数: n, 档位: "主要档",
        说明: `文明能力：相邻任意区域 ×${n}（+1/个）${
          policy.cards.length ? `；政策卡生效：${policy.cards.join("、")}` : ""}`,
      });
    }


    // 宗教信条：按用户要求不模拟每座城的宗教归属；选中的信条对所有相关区块生效。
    // 万神殿相邻先进入信仰相邻总额，随后职业道德镜像该总额为生产力。
    for (const beliefId of selectedBeliefs(board)) {
      const belief = rules.religionBeliefs.get(beliefId);
      if (!belief) continue;
      for (const raw of belief.结构化效果) {
        const [kind, target, yieldType, amount] = beliefEffect(raw);
        if (baseDid !== "DISTRICT_HOLY_SITE" ||
            (kind !== "圣地地形相邻" && kind !== "圣地地貌相邻")) continue;
        const n = neighborTiles(board, p).filter((tile) =>
          kind === "圣地地形相邻" ? tile.地形 === target : tile.地貌 === target).length;
        const policy = adjacencyPolicyMultiplier(rules, board, did);
        const increment = mul(mul(rat(n), amount), rat(policy.multiplier));
        if (yieldType === "信仰") faithAdjacency = add(faithAdjacency, increment);
        push(yieldType, srcKey, dname, p, {
          增量: increment, 规则id: `${beliefId}@${target}`, 计数: n, 档位: "主要档",
          说明: `宗教信条·${belief.名称}：相邻 ${rules.name(target)} ×${n}（+${amount.n / amount.d}/个）${
            policy.cards.length ? `；政策卡生效：${policy.cards.join("、")}` : ""}`,
        });
      }
    }
    if (baseDid === "DISTRICT_HOLY_SITE" &&
        selectedBeliefs(board).has("BELIEF_WORK_ETHIC")) {
      push("生产力", srcKey, dname, p, {
        增量: faithAdjacency, 规则id: "BELIEF_WORK_ETHIC", 计数: 1, 档位: "固定",
        说明: `宗教信条·职业道德：镜像本圣地的信仰相邻加成（${faithAdjacency.n / faithAdjacency.d}）`,
      });
    }
    for (const beliefId of selectedBeliefs(board)) {
      const belief = rules.religionBeliefs.get(beliefId);
      if (!belief) continue;
      for (const raw of belief.结构化效果) {
        const [kind, target, yieldType, amount] = beliefEffect(raw);
        if (kind !== "区域固定" || baseDid !== target) continue;
        push(yieldType, srcKey, dname, p, {
          增量: amount, 规则id: beliefId, 计数: 1, 档位: "固定",
          说明: `宗教信条·${belief.名称}：${dname} +${amount.n / amount.d} ${yieldType}`,
        });
      }
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
      for (const beliefId of selectedBeliefs(board)) {
        const belief = rules.religionBeliefs.get(beliefId);
        if (!belief) continue;
        for (const raw of belief.结构化效果) {
          const [kind, target, yieldType, amount] = beliefEffect(raw);
          if (kind !== "建筑固定" || bid !== target) continue;
          push(yieldType, `${bid}@${key(p)}`, b.名称, p, {
            增量: amount, 规则id: beliefId, 计数: 1, 档位: "固定",
            说明: `宗教信条·${belief.名称}：${b.名称} +${amount.n / amount.d} ${yieldType}`,
          });
        }
      }
    }
  }

  // 路德维希二世「童话国王」：世界奇观的相邻修正从 TraitModifiers 导出。
  // 世界奇观的建造/完工流程不在本期局面模型里；已放置奇观可以静态求值。
  for (const mod of rules.traitAdjacency.get(board.领袖 ?? "") ?? []) {
    if (mod.区域id !== "DISTRICT_WONDER") continue;
    for (const [k, tile] of board.tiles) {
      if (!tile.世界奇观) continue;
      const p = { q: Number(k.split(",")[0]), r: Number(k.split(",")[1]) };
      const n = neighborTiles(board, p).filter((t) => t.区域 !== undefined).length;
      push(mod.产出类型, `${mod.修正id}@${k}`, "童话国王·世界奇观", p, {
        增量: mul(rat(n), mod.每邻格加成), 规则id: mod.修正id,
        计数: n, 档位: "主要档", 说明: `奇观相邻区域 ×${n}（+${mod.每邻格加成.n / mod.每邻格加成.d}/个）`,
      });
    }
  }

  for (const beliefId of selectedBeliefs(board)) {
    const belief = rules.religionBeliefs.get(beliefId);
    if (!belief) continue;
    for (const raw of belief.结构化效果) {
      const [kind, , yieldType, amount] = beliefEffect(raw);
      if (kind !== "奇观固定") continue;
      for (const [k, tile] of board.tiles) {
        if (!tile.世界奇观) continue;
        const p = { q: Number(k.split(",")[0]), r: Number(k.split(",")[1]) };
        push(yieldType, `${beliefId}@${k}`, belief.名称, p, {
          增量: amount, 规则id: beliefId, 计数: 1, 档位: "固定",
          说明: `宗教信条·${belief.名称}：世界奇观 +${amount.n / amount.d} ${yieldType}`,
        });
      }
    }
  }

  // 城市规划：对当前局面中的每座城市提供 +1 生产力。
  // 城市不是相邻规则的来源，因此单独记为全局政策来源。
  if (board.已装配政策.has("POLICY_URBAN_PLANNING")) {
    const cities = board.城市?.length
      ? board.城市
      : [{ id: "单城", 名称: "本城", 中心: board.中心 }];
    for (const city of cities) {
      push("生产力", `POLICY_URBAN_PLANNING@${city.id}`,
        `城市规划 · ${city.名称}`, city.中心, {
          增量: rat(1), 规则id: "POLICY_URBAN_PLANNING",
          计数: 1, 档位: "固定", 说明: "政策卡：所有城市 +1 生产力",
        });
    }
  }

  // 第 8 步 · 文明/领袖布局修正：日本相邻修正已在第 6 步配合排除表记账；
  //   路德维希二世的奇观文化已在上方记账。贸易/总督/时代等修正暂无对应局面状态。
  // 第 9 步 · 汇总，**不取整**（D4 实测：产出全程按小数累加）。
  const 产出: YieldNode[] = [];
  const 合计 = new Map<string, Rat>();
  const 城市合计 = new Map<string, Map<string, Rat>>();
  for (const y of [...acc.keys()].sort()) {
    const sources: SourceNode[] = [];
    let ytotal = ZERO;
    for (const srcId of [...acc.get(y)!.keys()].sort()) {
      const slot = acc.get(y)!.get(srcId)!;
      let stotal = ZERO;
      for (const l of slot.leaves) stotal = add(stotal, l.增量);
      sources.push({ ...slot.node, 合计: stotal, 叶子: slot.leaves });
      if (slot.node.位置) {
        const cid = cityFor(board, slot.node.位置)?.id;
        if (cid) {
          const ys = 城市合计.get(cid) ?? new Map<string, Rat>();
          ys.set(y, add(ys.get(y) ?? ZERO, stotal));
          城市合计.set(cid, ys);
        }
      }
      ytotal = add(ytotal, stotal);
    }
    产出.push({ 产出类型: y, 合计: ytotal, 来源: sources });
    合计.set(y, ytotal);
  }
  return { 合计, 产出, 诊断, 城市合计 };
}

function describeTarget(rules: Rules, rule: AdjacencyRule, 计数: number): string {
  // 加成值可以是负的（书院每相邻一区域 −1），所以符号要按值算，不能写死 "+"。
  const v = rule.加成值.n / rule.加成值.d;
  const signed = `${v < 0 ? "−" : "+"}${Math.abs(v)}`;
  if (rule.目标类别 === "自身") return `自身固定 ${signed}`;
  if (rule.目标类别 === "河流") return `本格临河（${signed}）`;
  const per = rule.所需数量 === 1 ? `${signed}/个` : `${signed}/${rule.所需数量}个`;
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
 * 九步求值顺序里有两步是空的；文明修正已按可静态求值的部分接入。保留编号，
 * 为的是让「为什么没有这一步」显式可见，而不是让读代码的人以为漏了。
 *
 *   第 4 步 地块基础产出   —— 本期不实现。文明 6 的地块产出要经由「市民分配到
 *                            工作地块」才计入城市，那是另一套系统（人口 → 工作
 *                            地块 → 每市民产出），在立项书的范围外。GDD §5 的
 *                            拆解面板示例也只有区域与建筑两类来源，没有地块。
 *   第 5 步 区域基础产出   —— **不存在**。districts.csv 全部 36 行的 基础产出
 *                            都是「无」，文明 6 的区域自身零产出。
 *   第 8 步 文明修正       —— 日本的 +1/邻格已由游戏 ModifierArguments 生成表
 *                            结构化，在第 6 步与相邻规则一起记账；领袖路德维希
 *                            的奇观修正在第 7 步后记账。其余贸易/总督/时代效果
 *                            仍缺对应局面状态。
 *
 * 地块与区域基础产出两步为空，说明：**文明 6 的区域产出体系几乎完全是
 * 相邻加成 + 建筑两件事**，其余的层要么不存在，要么属于别的子系统。
 * ════════════════════════════════════════════════════════════════════ */
