/** 剩下 8 个目标类别的定向单测（SDD §3.4）。
 *
 * 为什么不放进 oracle：Python 原型对这些类别一律返回 false（它只建模地形/地貌/
 * 区域），要覆盖就得扩原型 —— 那会让**参照实现本身变成第二个待测对象**，
 * 交叉校验的价值就没了。所以这里的期望值直接从 `adjacency_rules.csv` 的规则行推出。
 *
 * 每个 test 的注释里写着它依据的那一行，改表后若数值变了，这些测试就该跟着改。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluate, total, countSameTypeNeighbors } from "../src/evaluate.ts";
import { fmt } from "../src/rational.ts";
import { R, board, at } from "./helpers.ts";

const y = (spec: Record<string, object>, yieldType: string, opts = {}) =>
  fmt(total(evaluate(R, board(spec as never, opts)), yieldType));

describe("布尔型类别：与邻格数量无关，只记一次", () => {
  test("河流：商业中心临河 +2 金币（DISTRICT_COMMERCIAL_HUB@River_Gold，2/1）", () => {
    assert.equal(y({ "0,0": { 区域: "DISTRICT_COMMERCIAL_HUB", 河流边: true } }, "金币"), "2");
    assert.equal(y({ "0,0": { 区域: "DISTRICT_COMMERCIAL_HUB" } }, "金币"), "0",
      "不临河就是 0");
  });

  test("河流看的是**自己这一格**临不临河，不是邻格", () => {
    // 邻格临河而自己不临河 → 不算。这条容易写错成「邻格临河也算」。
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_COMMERCIAL_HUB" },
      "1,0": { 河流边: true },
    }, "金币"), "0");
  });

  test("自然奇观：圣地相邻 1 个 +2 信仰，2 个 +4（HOLY_SITE@NaturalWonder_Faith，2/1）", () => {
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_HOLY_SITE" }, "1,0": { 自然奇观: "FEATURE_PAMUKKALE" },
    }, "信仰"), "2");
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_HOLY_SITE" },
      "1,0": { 自然奇观: "FEATURE_PAMUKKALE" }, "0,1": { 自然奇观: "FEATURE_ULURU" },
    }, "信仰"), "4", "主要档按个数线性");
  });

  test("世界奇观与自然奇观是**两个不同字段**，不可互串", () => {
    // 剧院广场吃世界奇观（THEATER@Wonder_Culture，2/1），不吃自然奇观
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_THEATER" }, "1,0": { 世界奇观: "BUILDING_PYRAMIDS" },
    }, "文化"), "2");
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_THEATER" }, "1,0": { 自然奇观: "FEATURE_ULURU" },
    }, "文化"), "0", "自然奇观不该被当成世界奇观");
  });

  test("自身：书院固定 +4 科技，与邻格无关（SEOWON@BaseDistrict_Science，4/1）", () => {
    // ⚠️ 这条按**读法 A**（无条件常数）实现，语义仍未经游戏内实测确认（SDD §10 D10）。
    //    开关收在 evaluate.ts 的 SELF_IS_FIXED_VALUE 一处，决定 L-09/L-10 的全部读数。
    //    读法 B 的计数器见下一条测试 —— 它必须被覆盖，否则翻盘那天才发现写错了。
    assert.equal(y({ "0,0": { 区域: "DISTRICT_SEOWON" } }, "科技"), "4");
    // 相邻一个区域：4 − 1 = 3（NegativeDistrict_Science 是主要档 −1）
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_SEOWON" }, "1,0": { 区域: "DISTRICT_HOLY_SITE" },
    }, "科技"), "3");
    // 相邻市政广场：4 − 1 + 1 = 4。市政广场对书院是**净中性**的邻居，
    // 这正是「韩国关卡结构性地不可能让贪心失败」的机理（关卡设计 §1.2）。
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_SEOWON" }, "1,0": { 区域: "DISTRICT_GOVERNMENT" },
    }, "科技"), "4");
  });

  test("自身 · 读法 B 的计数器：数邻格里的同类型区域（SDD §10 D10 的备选实现）", () => {
    // 这条不测当前行为，测的是**翻盘后**要用的那段代码。理由见 evaluate.ts 的注释：
    // 没被覆盖的备选分支等于没有备选。
    const c = (spec: Parameters<typeof board>[0], civ?: string) =>
      countSameTypeNeighbors(R, board(spec, { 文明: civ }), at(0, 0));

    // 孤立：0。这正是两种读法唯一有判别力的局面（A 给 4，B 给 0）。
    assert.equal(c({ "0,0": { 区域: "DISTRICT_SEOWON" } }), 0);
    // 挨 1 座同类：1
    assert.equal(c({
      "0,0": { 区域: "DISTRICT_SEOWON" }, "1,0": { 区域: "DISTRICT_SEOWON" },
    }), 1);
    // 挨 2 座同类：2 —— 按座数叠加，不是布尔
    assert.equal(c({
      "0,0": { 区域: "DISTRICT_SEOWON" }, "1,0": { 区域: "DISTRICT_SEOWON" },
      "0,1": { 区域: "DISTRICT_SEOWON" },
    }), 2);
    // 挨的是别的区域：不算
    assert.equal(c({
      "0,0": { 区域: "DISTRICT_SEOWON" }, "1,0": { 区域: "DISTRICT_HOLY_SITE" },
    }), 0);
    // 本格没有区域：0（防御性分支）
    assert.equal(c({ "0,0": {}, "1,0": { 区域: "DISTRICT_SEOWON" } }), 0);
    // 比较走**替换后的有效 id**：韩国的学院解析成书院，两者应当算同类（E10/E15b）
    assert.equal(c({
      "0,0": { 区域: "DISTRICT_CAMPUS" }, "1,0": { 区域: "DISTRICT_CAMPUS" },
    }, "CIVILIZATION_KOREA"), 1);
  });
});

describe("资源类别", () => {
  test("任意资源：汉萨相邻资源 +1 生产力（HANSA@Resource_Production，1/1）", () => {
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_HANSA" }, "1,0": { 资源: "RESOURCE_CATTLE" },
    }, "生产力"), "1");
  });

  test("资源类别：工业区相邻战略资源 +1，奥皮杜姆 +2", () => {
    // INDUSTRIAL_ZONE@Strategic_Production 1/1；OPPIDUM@Strategic_Production2 2/1
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_INDUSTRIAL_ZONE" }, "1,0": { 资源: "RESOURCE_IRON" },
    }, "生产力"), "1");
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_OPPIDUM" }, "1,0": { 资源: "RESOURCE_IRON" },
    }, "生产力"), "2", "高卢的补偿：奥皮杜姆的战略资源加成是工业区的两倍");
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_INDUSTRIAL_ZONE" }, "1,0": { 资源: "RESOURCE_CATTLE" },
    }, "生产力"), "0", "加成资源不是战略资源");
  });

  test("海洋资源：港口相邻 +1 金币，且**资源必须是海洋资源**", () => {
    // HARBOR@SeaResource_Gold 1/1；是否海洋资源来自 resources 表，不在地块上再存一份
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_HARBOR", 地形: "TERRAIN_COAST" },
      "1,0": { 资源: "RESOURCE_FISH", 地形: "TERRAIN_COAST" },
    }, "金币"), "1");
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_HARBOR", 地形: "TERRAIN_COAST" },
      "1,0": { 资源: "RESOURCE_CATTLE" },
    }, "金币"), "0", "牛不是海洋资源");
  });
});

describe("改良设施", () => {
  test("工业区：采石场 +1/个（主要档），矿场 +1/2个（标准档）", () => {
    // INDUSTRIAL_ZONE@Quarry_Production 1/1；@Mine_Production 1/2
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_INDUSTRIAL_ZONE" },
      "1,0": { 改良设施: "IMPROVEMENT_QUARRY" },
    }, "生产力"), "1");
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_INDUSTRIAL_ZONE" },
      "1,0": { 改良设施: "IMPROVEMENT_MINE" },
    }, "生产力"), "0.5", "一个矿场是半份 —— 与 D4 实测的标准档语义一致");
    assert.equal(y({
      "0,0": { 区域: "DISTRICT_INDUSTRIAL_ZONE" },
      "1,0": { 改良设施: "IMPROVEMENT_MINE" }, "0,1": { 改良设施: "IMPROVEMENT_MINE" },
    }, "生产力"), "1");
  });
});

describe("替换解析与精确匹配（求值顺序第 1 步、边界 E11）", () => {
  test("同一张盘面换德国：差值恰好是汉萨那条专属规则", () => {
    // 这个用例我第一次写时把期望值算错了（写成 2，实际 2.5），错因值得留着：
    // **特色区域的专属规则是叠加在通用档之上的，不是取代它。**
    // 汉萨与工业区都有 District_Production（任意其他区域，1/2 → 每个邻居 +0.5），
    // 汉萨另有 Commerical_Hub_Production（相邻商业中心 +2，主要档）。所以
    //   常规文明：0.5（只有通用档）
    //   德国：    0.5 + 2 = 2.5
    // 差值 2 正好是那条专属规则 —— 这比"有没有命中"更能说明替换真的生效了。
    const spec = {
      "0,0": { 区域: "DISTRICT_INDUSTRIAL_ZONE" },   // 德国下解析为汉萨
      "1,0": { 区域: "DISTRICT_COMMERCIAL_HUB" },
    };
    assert.equal(y(spec, "生产力"), "0.5", "常规文明：只吃通用档");
    assert.equal(y(spec, "生产力", { 文明: "CIVILIZATION_GERMANY" }), "2.5",
      "德国：通用档 0.5 + 汉萨专属的相邻商业中心 +2");
  });

  test("指名某区域的规则按 id 精确匹配，不认它的特色替换版", () => {
    // 工业区有 Bath_Production（相邻罗马浴场 +2）。罗马把浴场替换成……不，
    // 更直接的例子：工业区的 Aqueduct_Production 只认水渠本身。
    // 这里验的是反向：**德国的汉萨没有 Bath_Production**（拆解案记过这处差异），
    // 所以同一个浴场邻居，常规工业区吃 2，德国汉萨只吃通用档 0.5。
    const spec = {
      "0,0": { 区域: "DISTRICT_INDUSTRIAL_ZONE" },
      "1,0": { 区域: "DISTRICT_BATH" },
    };
    assert.equal(y(spec, "生产力"), "2.5", "常规工业区：Bath_Production 2 + 通用档 0.5");
    assert.equal(y(spec, "生产力", { 文明: "CIVILIZATION_GERMANY" }), "0.5",
      "汉萨缺 Bath_Production —— 特色区域的规则集差异是常态，不是漏挂（E10）");
  });
});

describe("建筑（第 7 步）与合法性（第 3 步）", () => {
  test("特色区域沿替换关系**继承**建筑：书院能建图书馆（边界 E15b）", () => {
    const tree = evaluate(R, board({
      "0,0": { 区域: "DISTRICT_CAMPUS", 建筑: ["BUILDING_LIBRARY"] },
    } as never, { 文明: "CIVILIZATION_KOREA" }));
    // 书院 自身 +4，图书馆 +2
    assert.equal(fmt(total(tree, "科技")), "6");
    assert.deepEqual(tree.诊断, [], "不该报「图书馆不能建在书院上」");
  });

  test("建筑建错区域会被诊断拦下，且不计入产出（边界 E15）", () => {
    const tree = evaluate(R, board({
      "0,0": { 区域: "DISTRICT_HOLY_SITE", 建筑: ["BUILDING_LIBRARY"] },
    } as never));
    assert.equal(fmt(total(tree, "科技")), "0");
    assert.equal(tree.诊断.length, 1);
    assert.match(tree.诊断[0].说明, /不能建在/);
  });

  test("超出城市 3 格工作范围会被诊断标记，而不是静默丢弃（边界 E16）", () => {
    const tree = evaluate(R, board({
      "0,0": { 区域: "DISTRICT_CITY_CENTER" },
      "4,0": { 区域: "DISTRICT_CAMPUS" },
    } as never));
    assert.equal(tree.诊断.length, 1);
    assert.match(tree.诊断[0].说明, /超出城市 3 格工作范围/);
  });
});

describe("前置与废弃（边界 E14，当前是防御性分支）", () => {
  test("区域侧 103 条规则里 0 条带前置 —— 这条测试守着这个事实", () => {
    let withPrereq = 0;
    for (const rules of R.adjacency.values()) {
      for (const r of rules) {
        if (r.前置科技.length || r.前置市政.length ||
            r.废弃科技.length || r.废弃市政.length) withPrereq++;
      }
    }
    assert.equal(withPrereq, 0,
      "若这条失败，说明补丁或改良设施相邻进场了，E14 那个分支要开始真正生效");
  });
});

describe("唯一性上限（E17b · SDD §10 D12）", () => {
  const diag = (spec: Parameters<typeof board>[0], civ?: string) =>
    evaluate(R, board(spec, { 文明: civ })).诊断
      .filter((d) => d.级别 === "错误").map((d) => d.说明);

  test("每城上限 1：一座城里放两座学院 → 报错", () => {
    assert.deepEqual(
      diag({ "0,0": { 区域: "DISTRICT_CAMPUS" }, "1,0": { 区域: "DISTRICT_CAMPUS" } }),
      ["学院 放了 2 座，超过每城上限 1（E17b）"]);
  });

  test("每城上限 无限：两座运河合法（OnePerCity=false 的 4 个区域之一）", () => {
    assert.deepEqual(
      diag({ "0,0": { 区域: "DISTRICT_CANAL" }, "1,0": { 区域: "DISTRICT_CANAL" } }), []);
  });

  test("每玩家上限 1：两座市政广场 → 按「每玩家上限」报错，不是「每城上限」", () => {
    // 两列的上限都是 1，措辞必须取更紧的那个（每玩家），否则玩家会以为换座城就行。
    assert.deepEqual(
      diag({ "0,0": { 区域: "DISTRICT_GOVERNMENT" }, "1,0": { 区域: "DISTRICT_GOVERNMENT" } }),
      ["市政广场 放了 2 座，超过每玩家上限 1（E17b）"]);
  });

  test("上限按**替换后**的有效区域计数：韩国的两座学院都解析成书院，仍然违规", () => {
    assert.deepEqual(
      diag({ "0,0": { 区域: "DISTRICT_CAMPUS" }, "1,0": { 区域: "DISTRICT_CAMPUS" } },
           "CIVILIZATION_KOREA"),
      ["书院 放了 2 座，超过每城上限 1（E17b）"]);
  });

  test("一座就不报错（边界：恰好等于上限）", () => {
    assert.deepEqual(diag({ "0,0": { 区域: "DISTRICT_CAMPUS" } }), []);
  });
});
