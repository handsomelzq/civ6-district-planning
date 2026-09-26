/** 配置表 → 规则对象。**求值器不硬编码任何规则**（GDD §2 那条边的要求）。
 *
 * 读的是 配置表/*.csv，唯一事实来源见 配置表/字段说明.md。
 */
import { parseCsv, parseKv, parseList, parseLimit, isNone, type Row } from "./csv.ts";
import { parseRat, type Rat } from "./rational.ts";

/** 相邻目标的类别。与 SDD §3.4 的映射表一一对应；`无目标` 当前是空集，
 *  保留为防御性枚举（游戏 SQL 里所有 Adjacent* 列都可空）。 */
export const TARGET_KINDS = [
  "地形", "地貌", "区域", "改良设施", "资源类别", "任意其他区域",
  "海洋资源", "河流", "世界奇观", "自身", "自然奇观", "任意资源", "无目标",
] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export type AdjacencyRule = {
  readonly 规则id: string;        // 区域id@原始标识，全表唯一
  readonly 区域id: string;
  readonly 目标类别: TargetKind;
  readonly 目标id: string;        // 「无」表示布尔型类别
  readonly 产出类型: string;
  readonly 加成值: Rat;
  readonly 所需数量: number;      // 1 = 主要档，2 = 标准档
  readonly 前置科技: string[];
  readonly 前置市政: string[];
  readonly 废弃科技: string[];
  readonly 废弃市政: string[];
  readonly 原始标识: string;      // 裸游戏 id，排除表指向这一列
};

export type District = {
  readonly 区域id: string;
  readonly 名称: string;
  readonly 是否特色区域: boolean;
  readonly 替换区域id: string;    // 「无」表示不替换
  readonly 所属文明id: string[];
  readonly 前置科技: string[];
  readonly 前置市政: string[];
  /** 每城上限 / 每玩家上限。`Infinity` = 配表里的「无限」（游戏侧 OnePerCity=false
   *  与 MaxPerPlayer=-1）。用 Infinity 而不是 -1 或 0 做哨兵，是为了让"不限"在比较
   *  里天然正确（`n < Infinity` 永真），少一处容易写反的分支。 */
  readonly 每城上限: number;
  readonly 每玩家上限: number;
};

export type Resource = {
  readonly 资源id: string;
  readonly 名称: string;
  readonly 资源类别: string;
  readonly 是否海洋资源: boolean;
};

export type Building = {
  readonly 建筑id: string;
  readonly 名称: string;
  readonly 所属区域id: string;
  readonly 基础产出: ReadonlyMap<string, Rat>;
  readonly 替换建筑id: string[];
  readonly 是否宗教建筑: boolean;
  readonly 前置科技: string[];
  readonly 前置市政: string[];
  readonly 前置建筑id: string[];
};

/** 求值器需要的表。浏览器与 Node 各自负责把它们读成文本，`Rules` 只认文本 ——
 *  **核心层零 I/O**，这样同一份代码能跑在 Node、浏览器和将来任何宿主里。 */
export const TABLE_FILES = [
  "adjacency_rules.csv", "districts.csv", "buildings.csv",
  "resources.csv", "terrains.csv", "features.csv", "excluded_adjacencies.csv",
  // 只为把 id 显示成可读名（文明 / 领袖），求值本身用不到
  "civs.csv", "leaders.csv",
] as const;

export type TableTexts = Record<(typeof TABLE_FILES)[number], string>;

export class Rules {
  readonly adjacency: ReadonlyMap<string, readonly AdjacencyRule[]>;  // 区域id → 规则
  readonly districts: ReadonlyMap<string, District>;
  readonly buildings: ReadonlyMap<string, Building>;
  readonly resources: ReadonlyMap<string, Resource>;
  /** 文明id → (基础区域id → 特色区域id)。求值顺序第 1 步用。 */
  readonly replaces: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** 文明id 或 领袖id → 被排除的「原始标识」集合。求值顺序第 2 步用。 */
  readonly excluded: ReadonlyMap<string, ReadonlySet<string>>;
  readonly buildableTerrain: ReadonlySet<string>;
  readonly removedByDistrict: ReadonlySet<string>;
  /** id → 中文名。拆解面板要显示「草原（山脉）」而不是 TERRAIN_GRASS_MOUNTAIN。 */
  readonly names: ReadonlyMap<string, string>;

  /** 从 CSV 文本构造。读文件是宿主的事 —— Node 用 `src/rules_node.ts`，
   *  浏览器用构建期内联的 `web/dist/tables.js`。 */
  constructor(texts: TableTexts) {
    const load = (f: (typeof TABLE_FILES)[number]): Row[] => {
      const t = texts[f];
      if (t === undefined) throw new Error(`缺少配置表：${f}`);
      return parseCsv(t);
    };

    const adj = new Map<string, AdjacencyRule[]>();
    for (const r of load("adjacency_rules.csv")) {
      const kind = r["目标类别"] as TargetKind;
      if (!TARGET_KINDS.includes(kind)) {
        throw new Error(`未知目标类别 ${kind}（规则 ${r["规则id"]}）`);
      }
      const rule: AdjacencyRule = {
        规则id: r["规则id"],
        区域id: r["区域id"],
        目标类别: kind,
        目标id: r["目标id"],
        产出类型: r["产出类型"],
        加成值: parseRat(r["加成值"]),
        所需数量: Number(r["所需数量"]),
        前置科技: parseList(r["前置科技"]),
        前置市政: parseList(r["前置市政"]),
        废弃科技: parseList(r["废弃科技"]),
        废弃市政: parseList(r["废弃市政"]),
        原始标识: r["原始标识"],
      };
      if (!Number.isInteger(rule.所需数量) || rule.所需数量 < 1) {
        throw new Error(`所需数量必须是 ≥1 的整数（规则 ${rule.规则id}）`);
      }
      (adj.get(rule.区域id) ?? adj.set(rule.区域id, []).get(rule.区域id)!).push(rule);
    }

    const districts = new Map<string, District>();
    const replaces = new Map<string, Map<string, string>>();
    for (const r of load("districts.csv")) {
      const d: District = {
        区域id: r["区域id"],
        名称: r["名称"],
        是否特色区域: r["是否特色区域"] === "是",
        替换区域id: r["替换区域id"],
        所属文明id: parseList(r["所属文明id"]),
        前置科技: parseList(r["前置科技"]),
        前置市政: parseList(r["前置市政"]),
        每城上限: parseLimit(r["每城上限"]),
        每玩家上限: parseLimit(r["每玩家上限"]),
      };
      districts.set(d.区域id, d);
      if (d.是否特色区域 && !isNone(d.替换区域id)) {
        for (const civ of d.所属文明id) {
          const m = replaces.get(civ) ?? new Map<string, string>();
          m.set(d.替换区域id, d.区域id);
          replaces.set(civ, m);
        }
      }
    }

    const buildings = new Map<string, Building>();
    for (const r of load("buildings.csv")) {
      const yields = new Map<string, Rat>();
      for (const [y, v] of parseKv(r["基础产出"])) yields.set(y, parseRat(v));
      buildings.set(r["建筑id"], {
        建筑id: r["建筑id"],
        名称: r["名称"],
        所属区域id: r["所属区域id"],
        基础产出: yields,
        替换建筑id: parseList(r["替换建筑id"]),
        是否宗教建筑: r["是否宗教建筑"] === "是",
        前置科技: parseList(r["前置科技"]),
        前置市政: parseList(r["前置市政"]),
        前置建筑id: parseList(r["前置建筑id"]),
      });
    }

    const resources = new Map<string, Resource>();
    for (const r of load("resources.csv")) {
      resources.set(r["资源id"], {
        资源id: r["资源id"],
        名称: r["名称"],
        资源类别: r["资源类别"],
        是否海洋资源: r["是否海洋资源"] === "是",
      });
    }

    const excluded = new Map<string, Set<string>>();
    for (const r of load("excluded_adjacencies.csv")) {
      for (const col of ["所属文明id", "所属领袖id"]) {
        for (const who of parseList(r[col])) {
          const s = excluded.get(who) ?? new Set<string>();
          s.add(r["被排除规则标识"]);
          excluded.set(who, s);
        }
      }
    }

    const names = new Map<string, string>();
    const buildable = new Set<string>();
    for (const r of load("terrains.csv")) {
      names.set(r["地形id"], r["名称"]);
      if (r["是否可建区域"] === "是") buildable.add(r["地形id"]);
    }
    // 建区域会移除的地貌（features.是否需移除）。移除后它不再作为相邻目标被计入，
    // 这是文明 6 的实际行为 —— 原型上曾漏掉这一条，导致森林被重复计入。
    const removed = new Set<string>();
    for (const r of load("features.csv")) {
      names.set(r["地貌id"], r["名称"]);
      if (r["是否需移除"] === "是") removed.add(r["地貌id"]);
    }
    for (const [id, d] of districts) names.set(id, d.名称);
    for (const [id, b] of buildings) names.set(id, b.名称);
    for (const [id, r] of resources) names.set(id, r.名称);
    for (const r of load("civs.csv")) names.set(r["文明id"], r["名称"]);
    for (const r of load("leaders.csv")) names.set(r["领袖id"], r["名称"]);

    this.adjacency = adj;
    this.districts = districts;
    this.buildings = buildings;
    this.resources = resources;
    this.replaces = replaces;
    this.excluded = excluded;
    this.buildableTerrain = buildable;
    this.removedByDistrict = removed;
    this.names = names;
  }

  /** id → 可读名。查不到就原样返回 id —— **绝不留空**，留空会让面板上出现
   *  一个没有出处的数字，那正是本作要消灭的东西。 */
  name(id: string): string {
    return this.names.get(id) ?? id;
  }

  /** 求值顺序第 1 步：应用文明的特色区域替换。 */
  effective(districtId: string, civ?: string): string {
    if (!civ) return districtId;
    return this.replaces.get(civ)?.get(districtId) ?? districtId;
  }

  /** 求值顺序第 2 步：这个文明/领袖组合排除了哪些「原始标识」。 */
  excludedFor(civ?: string, leader?: string): ReadonlySet<string> {
    const a = civ ? this.excluded.get(civ) : undefined;
    const b = leader ? this.excluded.get(leader) : undefined;
    if (!a && !b) return EMPTY;
    const out = new Set<string>(a ?? []);
    for (const x of b ?? []) out.add(x);
    return out;
  }
}

const EMPTY: ReadonlySet<string> = new Set<string>();
