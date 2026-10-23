import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  validateBoard,
  validateDistrictPlacement,
  type LegalityIssue,
} from "../src/legality.ts";
import { evaluate, total } from "../src/evaluate.ts";
import { fmt } from "../src/rational.ts";
import { R, at, board } from "./helpers.ts";
import {
  moveCityCenter, withoutResource, type BoardState,
} from "../src/board.ts";
import {
  cityCenterPlacementConstraint, resourceClearanceConstraint,
} from "../src/placement.ts";

const codes = (issues: readonly LegalityIssue[]): string[] =>
  issues.map((issue) => issue.code);

const first = (issues: readonly LegalityIssue[], code: string): LegalityIssue => {
  const issue = issues.find((candidate) => candidate.code === code);
  assert.ok(issue, `应该返回 ${code}，实际返回 ${codes(issues).join(", ")}`);
  return issue;
};

const placedBoard = (
  spec: Record<string, object>,
  opts: Parameters<typeof board>[1] = {},
): BoardState => board(spec as never, opts);

describe("共享区域合法性入口", () => {
  test("目标坐标不存在时返回 E00，并保留位置与区域 id", () => {
    const issues = validateDistrictPlacement(
      R, placedBoard({ "0,0": {} }, { 已解锁科技: ["TECH_WRITING"] }),
      at(2, 0), "DISTRICT_CAMPUS",
    );
    const issue = first(issues, "E00");
    assert.equal(issue.layer, "地块");
    assert.deepEqual(issue.position, at(2, 0));
    assert.equal(issue.districtId, "DISTRICT_CAMPUS");
    assert.match(issue.message, /不存在|盘面/);
  });

  test("目标地块已有区域时返回 E01", () => {
    const issues = validateDistrictPlacement(
      R,
      placedBoard({ "0,0": { 区域: "DISTRICT_CITY_CENTER" } },
        { 已解锁科技: ["TECH_WRITING"] }),
      at(0, 0), "DISTRICT_CAMPUS",
    );
    const issue = first(issues, "E01");
    assert.equal(issue.layer, "地块");
    assert.deepEqual(issue.position, at(0, 0));
    assert.equal(issue.districtId, "DISTRICT_CAMPUS");
    assert.match(issue.message, /已有区域/);
  });

  test("全局不可建地形返回 E02", () => {
    const issues = validateDistrictPlacement(
      R,
      placedBoard({ "0,0": { 地形: "TERRAIN_OCEAN" } },
        { 已解锁科技: ["TECH_WRITING"] }),
      at(0, 0), "DISTRICT_CAMPUS",
    );
    const issue = first(issues, "E02");
    assert.equal(issue.layer, "地块");
    assert.equal(issue.districtId, "DISTRICT_CAMPUS");
    assert.match(issue.message, /不可建/);
  });

  test("区域专属地形返回 E03", () => {
    const issues = validateDistrictPlacement(
      R,
      placedBoard({ "0,0": { 地形: "TERRAIN_GRASS" } },
        { 已解锁科技: ["TECH_CELESTIAL_NAVIGATION"] }),
      at(0, 0), "DISTRICT_HARBOR",
    );
    const issue = first(issues, "E03");
    assert.equal(issue.layer, "地块");
    assert.equal(issue.districtId, "DISTRICT_HARBOR");
    assert.match(issue.message, /港口.*草原/);
  });

  test("不可建地貌返回 E04", () => {
    const issues = validateDistrictPlacement(
      R,
      placedBoard({ "0,0": {
        地貌: "FEATURE_PAMUKKALE",
      } }, { 已解锁科技: ["TECH_WRITING"] }),
      at(0, 0), "DISTRICT_CAMPUS",
    );
    const issue = first(issues, "E04");
    assert.equal(issue.layer, "地块");
    assert.equal(issue.districtId, "DISTRICT_CAMPUS");
    assert.match(issue.message, /棉花堡/);
  });

  test("军营不可紧邻城市中心返回 E05", () => {
    const issues = validateDistrictPlacement(
      R,
      placedBoard({
        "0,0": { 地形: "TERRAIN_GRASS" },
        "1,0": { 区域: "DISTRICT_CITY_CENTER" },
      }, { 已解锁科技: ["TECH_BRONZE_WORKING"] }),
      at(0, 0), "DISTRICT_ENCAMPMENT",
    );
    const issue = first(issues, "E05");
    assert.equal(issue.layer, "地块");
    assert.equal(issue.districtId, "DISTRICT_ENCAMPMENT");
    assert.match(issue.message, /紧邻城市中心/);
  });

  test("水渠没有同时邻接城市中心与淡水时返回 E06", () => {
    const issues = validateDistrictPlacement(
      R,
      placedBoard({
        "0,0": { 地形: "TERRAIN_GRASS" },
        "1,0": { 区域: "DISTRICT_CITY_CENTER" },
      }, { 已解锁科技: ["TECH_ENGINEERING"] }),
      at(0, 0), "DISTRICT_AQUEDUCT",
    );
    const issue = first(issues, "E06");
    assert.equal(issue.layer, "地块");
    assert.equal(issue.districtId, "DISTRICT_AQUEDUCT");
    assert.match(issue.message, /城市中心.*淡水/);
  });

  test("区域超出所选城市三格工作范围时返回 E16", () => {
    const issues = validateDistrictPlacement(
      R,
      placedBoard({
        "0,0": { 区域: "DISTRICT_CITY_CENTER" },
        "4,0": {},
      }, { 已解锁科技: ["TECH_WRITING"] }),
      at(4, 0), "DISTRICT_CAMPUS",
    );
    const issue = first(issues, "E16");
    assert.equal(issue.layer, "城市");
    assert.equal(issue.districtId, "DISTRICT_CAMPUS");
    assert.equal(issue.cityId, "单城");
    assert.match(issue.message, /3 格工作范围/);
  });

  test("区域前置科技与市政分别返回 E14t 和 E14c", () => {
    const techIssues = validateDistrictPlacement(
      R, placedBoard({ "0,0": {} }), at(0, 0), "DISTRICT_CAMPUS",
    );
    const civicIssues = validateDistrictPlacement(
      R, placedBoard({ "0,0": {} }), at(0, 0), "DISTRICT_GOVERNMENT",
    );
    assert.equal(first(techIssues, "E14t").layer, "研究");
    assert.equal(first(civicIssues, "E14c").layer, "研究");
    assert.match(first(techIssues, "E14t").message, /科技/);
    assert.match(first(civicIssues, "E14c").message, /市政/);
  });

  test("同一座城市重复区域返回 E17c", () => {
    const issues = validateDistrictPlacement(
      R,
      placedBoard({
        "0,0": { 区域: "DISTRICT_CAMPUS" },
        "1,0": {},
      }, { 已解锁科技: ["TECH_WRITING"] }),
      at(1, 0), "DISTRICT_CAMPUS",
    );
    const issue = first(issues, "E17c");
    assert.equal(issue.layer, "城市");
    assert.equal(issue.districtId, "DISTRICT_CAMPUS");
    assert.match(issue.message, /每城上限/);
  });

  test("玩家唯一区域在不同城市重复时返回 E17b 而不返回 E17c", () => {
    const b = placedBoard({
      "0,0": { 区域: "DISTRICT_CITY_CENTER" },
      "1,0": { 区域: "DISTRICT_GOVERNMENT", 所属城市: "c1" },
      "3,0": {},
      "4,0": { 区域: "DISTRICT_CITY_CENTER" },
    }, {
      已解锁市政: ["CIVIC_STATE_WORKFORCE"],
    });
    const withCities: BoardState = {
      ...b,
      城市: [
        { id: "c1", 名称: "西城", 中心: at(0, 0), 人口: 4 },
        { id: "c2", 名称: "东城", 中心: at(4, 0), 人口: 4 },
      ],
    };
    const issues = validateDistrictPlacement(
      R, withCities, at(3, 0), "DISTRICT_GOVERNMENT",
      { selectedCityId: "c2" },
    );
    assert.deepEqual(codes(issues).filter((code) => code === "E17c"), []);
    const issue = first(issues, "E17b");
    assert.equal(issue.layer, "玩家");
    assert.equal(issue.districtId, "DISTRICT_GOVERNMENT");
    assert.match(issue.message, /每玩家上限/);
  });

  test("多城中同类区域各自一座时不返回 E17c", () => {
    const b = placedBoard({
      "0,0": { 区域: "DISTRICT_CITY_CENTER" },
      "1,0": { 区域: "DISTRICT_CAMPUS", 所属城市: "c1" },
      "3,0": {},
      "4,0": { 区域: "DISTRICT_CITY_CENTER" },
    }, { 已解锁科技: ["TECH_WRITING"] });
    const withCities: BoardState = {
      ...b,
      城市: [
        { id: "c1", 名称: "西城", 中心: at(0, 0), 人口: 4 },
        { id: "c2", 名称: "东城", 中心: at(4, 0), 人口: 4 },
      ],
    };
    const issues = validateDistrictPlacement(
      R, withCities, at(3, 0), "DISTRICT_CAMPUS",
      { selectedCityId: "c2" },
    );
    assert.deepEqual(codes(issues).filter((code) => code === "E17c"), []);
    assert.deepEqual(codes(issues).filter((code) => code === "E17b"), []);
  });

  test("一座放置同时违反多项规则时按固定顺序返回问题", () => {
    const issues = validateDistrictPlacement(
      R,
      placedBoard({ "0,0": { 地形: "TERRAIN_OCEAN" } }, { 中心: at(4, 0) }),
      at(0, 0), "DISTRICT_HARBOR",
    );
    assert.deepEqual(codes(issues), ["E02", "E03", "E16", "E14t"]);
    for (const issue of issues) {
      assert.deepEqual(issue.position, at(0, 0));
      assert.equal(issue.districtId, "DISTRICT_HARBOR");
      assert.equal(issue.severity, "错误");
    }
  });

  test("validateBoard 保留完整诊断，并按文明替换后的有效区域计数", () => {
    const b = placedBoard({
      "0,0": { 区域: "DISTRICT_CITY_CENTER" },
      "1,0": { 地形: "TERRAIN_GRASS", 区域: "DISTRICT_CAMPUS" },
      "2,0": { 地形: "TERRAIN_GRASS", 区域: "DISTRICT_CAMPUS" },
      "4,0": { 地形: "TERRAIN_GRASS_HILLS", 区域: "DISTRICT_CAMPUS" },
    }, { 文明: "CIVILIZATION_KOREA" });
    const issues = validateBoard(R, b);
    assert.ok(codes(issues).includes("E17c"));
    assert.ok(issues.some((issue) =>
      issue.code === "E17c" && issue.districtId === "DISTRICT_SEOWON"));
    assert.ok(issues.some((issue) => issue.code === "E16"));
    assert.equal(codes(issues).filter((code) => code === "E01").length, 0);
  });

  test("evaluate 将共享校验错误转换为 Diagnostic，并保留非法区域的产出节点", () => {
    const b = placedBoard({
      "0,0": { 区域: "DISTRICT_CITY_CENTER" },
      "1,0": { 区域: "DISTRICT_CAMPUS" },
      "2,0": { 区域: "DISTRICT_CAMPUS" },
      "4,0": { 区域: "DISTRICT_CAMPUS" },
      "4,1": { 地形: "TERRAIN_GRASS_MOUNTAIN" },
    }, { 已解锁科技: ["TECH_WRITING"] });
    const tree = evaluate(R, b);
    const messages = tree.诊断.map((diagnostic) => diagnostic.说明);
    assert.ok(messages.some((message) => message.includes("E17c")));
    assert.ok(messages.some((message) => message.includes("E16")));
    assert.equal(tree.产出.some((node) =>
      node.来源.some((source) => source.来源 === "学院" &&
        source.位置?.q === 4 && source.位置?.r === 0)), true);
    assert.equal(fmt(total(tree, "科技")), "2.5",
      "非法区域仍按现有产出规则参与结算");
  });

  test("evaluate 保留 E05、E06，且不把挑战预算当作局面错误", () => {
    const encampment = evaluate(R, placedBoard({
      "0,0": { 区域: "DISTRICT_ENCAMPMENT" },
      "1,0": { 区域: "DISTRICT_CITY_CENTER" },
    }, { 已解锁科技: ["TECH_BRONZE_WORKING"] }));
    assert.ok(encampment.诊断.some((diagnostic) =>
      diagnostic.说明.includes("E05")));

    const aqueduct = evaluate(R, placedBoard({
      "0,0": { 区域: "DISTRICT_AQUEDUCT" },
      "1,0": { 区域: "DISTRICT_CITY_CENTER" },
    }, { 已解锁科技: ["TECH_ENGINEERING"] }));
    assert.ok(aqueduct.诊断.some((diagnostic) =>
      diagnostic.说明.includes("E06")));
    assert.equal(aqueduct.诊断.some((diagnostic) =>
      diagnostic.说明.includes("G5")), false);
  });

  test("挑战模式预算耗尽时返回 G5，而自由模式不返回 G5", () => {
    const b = placedBoard({ "0,0": {} }, { 已解锁科技: ["TECH_WRITING"] });
    const challenge = validateDistrictPlacement(
      R, b, at(0, 0), "DISTRICT_CAMPUS",
      { mode: "挑战", challengeBudgetRemaining: 0 },
    );
    assert.equal(first(challenge, "G5").layer, "模式");
    const free = validateDistrictPlacement(
      R, b, at(0, 0), "DISTRICT_CAMPUS",
      { mode: "自由", challengeBudgetRemaining: 0 },
    );
    assert.equal(free.some((candidate) => candidate.code === "G5"), false);
  });

  test("人口配额：人口 4 的城市最多放 2 个专业化区域", () => {
    const issues = validateDistrictPlacement(
      R,
      placedBoard({
        "0,0": { 区域: "DISTRICT_CAMPUS" },
        "1,0": { 区域: "DISTRICT_HOLY_SITE" },
        "0,1": {},
      }, {
        人口: 4,
        已解锁科技: ["TECH_WRITING", "TECH_ASTROLOGY"],
        已解锁市政: ["CIVIC_DRAMA_POETRY"],
      }),
      at(0, 1), "DISTRICT_THEATER",
      { selectedCityId: "单城" },
    );
    const population = first(issues, "E17p");
    assert.equal(population.layer, "城市");
    assert.match(population.message, /人口可建 2 个专业化区域/);
  });

  test("德国文明能力为每座城市提供 1 个额外人口区域配额", () => {
    const issues = validateDistrictPlacement(
      R,
      placedBoard({
        "0,0": { 区域: "DISTRICT_CAMPUS" },
        "1,0": { 区域: "DISTRICT_HOLY_SITE" },
        "0,1": {},
      }, {
        人口: 4, 文明: "CIVILIZATION_GERMANY",
        已解锁科技: ["TECH_WRITING", "TECH_ASTROLOGY"],
      }),
      at(0, 1), "DISTRICT_THEATER",
    );
    assert.equal(issues.some((candidate) => candidate.code === "E17p"), false);
  });

  test("奢侈与战略资源阻止区域；加成资源按收获科技判断", () => {
    const strategic = validateDistrictPlacement(
      R,
      placedBoard({ "0,0": { 资源: "RESOURCE_IRON" } },
        { 已解锁科技: ["TECH_WRITING"] }),
      at(0, 0), "DISTRICT_CAMPUS",
    );
    assert.match(first(strategic, "E07").message, /战略资源.*铁/);

    const luxury = validateDistrictPlacement(
      R,
      placedBoard({ "0,0": { 资源: "RESOURCE_WINE" } },
        { 已解锁科技: ["TECH_WRITING"] }),
      at(0, 0), "DISTRICT_CAMPUS",
    );
    assert.match(first(luxury, "E07").message, /奢侈资源.*葡萄酒/);

    const stoneBeforeMasonry = validateDistrictPlacement(
      R,
      placedBoard({ "0,0": { 资源: "RESOURCE_STONE" } },
        { 已解锁科技: ["TECH_WRITING"] }),
      at(0, 0), "DISTRICT_CAMPUS",
    );
    assert.match(first(stoneBeforeMasonry, "E07").message, /需要先解锁(?:砌砖|TECH_MASONRY)/);

    const stoneAfterMasonry = validateDistrictPlacement(
      R,
      placedBoard({ "0,0": { 资源: "RESOURCE_STONE" } },
        { 已解锁科技: ["TECH_WRITING", "TECH_MASONRY"] }),
      at(0, 0), "DISTRICT_CAMPUS",
    );
    assert.match(first(stoneAfterMasonry, "E07").message, /需要先清除资源/);

    const cattleBeforeHusbandry = validateDistrictPlacement(
      R,
      placedBoard({ "0,0": { 资源: "RESOURCE_CATTLE" } },
        { 已解锁科技: ["TECH_WRITING"] }),
      at(0, 0), "DISTRICT_CAMPUS",
    );
    assert.match(first(cattleBeforeHusbandry, "E07").message,
      /需要先解锁(?:畜牧业|TECH_ANIMAL_HUSBANDRY)/);
  });

  test("自由模式只能在解锁科技后清除可收获加成资源", () => {
    const before = placedBoard({
      "0,0": { 资源: "RESOURCE_STONE", 地貌: "FEATURE_FOREST", 河流边: true },
    });
    assert.match(resourceClearanceConstraint(R, before, at(0, 0)),
      /需要先解锁(?:砌砖|TECH_MASONRY)/);

    const unlocked = { ...before, 已解锁科技: new Set(["TECH_MASONRY"]) };
    assert.equal(resourceClearanceConstraint(R, unlocked, at(0, 0)), "");
    const cleared = withoutResource(unlocked, at(0, 0));
    assert.equal(cleared.tiles.get("0,0")?.资源, undefined);
    assert.equal(cleared.tiles.get("0,0")?.地貌, "FEATURE_FOREST");
    assert.equal(cleared.tiles.get("0,0")?.河流边, true);
    assert.equal(before.tiles.get("0,0")?.资源, "RESOURCE_STONE",
      "清除资源不得修改原局面");

    const luxury = placedBoard({ "0,0": { 资源: "RESOURCE_WINE" } }, {
      已解锁科技: ["TECH_IRRIGATION"],
    });
    assert.match(resourceClearanceConstraint(R, luxury, at(0, 0)),
      /奢侈资源.*不能清除/);
  });

  test("自然奇观和世界奇观都不能被区域占用", () => {

    const naturalWonder = validateDistrictPlacement(
      R,
      placedBoard({ "0,0": { 自然奇观: "FEATURE_ULURU" } },
        { 已解锁科技: ["TECH_WRITING"] }),
      at(0, 0), "DISTRICT_CAMPUS",
    );
    assert.equal(first(naturalWonder, "E08").layer, "地块");

    const worldWonder = validateDistrictPlacement(
      R,
      placedBoard({ "0,0": { 世界奇观: "BUILDING_PYRAMIDS" } },
        { 已解锁科技: ["TECH_WRITING"] }),
      at(0, 0), "DISTRICT_CAMPUS",
    );
    assert.equal(first(worldWonder, "E09").layer, "地块");
  });

  test("城市中心可以移到资源格且移动后资源保留", () => {
    const b = placedBoard({
      "0,0": { 区域: "DISTRICT_CITY_CENTER", 所属城市: "A" },
      "1,0": { 资源: "RESOURCE_WINE" },
    }, { 城市: [{ id: "A", 名称: "甲城", 中心: at(0, 0), 人口: 10 }] });
    assert.equal(cityCenterPlacementConstraint(b, at(1, 0), "A"), "");
    const moved = moveCityCenter(b, "A", at(1, 0));
    assert.equal(moved.tiles.get("1,0")?.资源, "RESOURCE_WINE");
  });

  test("区域只能建在所选城市的明确领土内，不能跨到相邻城市", () => {
    const b = placedBoard({
      "0,0": { 区域: "DISTRICT_CITY_CENTER", 所属城市: "A" },
      "1,0": {}, "2,0": {}, "3,0": {},
      "0,4": {},
      "4,0": { 区域: "DISTRICT_CITY_CENTER", 所属城市: "B" },
    }, {
      已解锁科技: ["TECH_WRITING"],
      城市: [
        { id: "A", 名称: "甲城", 中心: at(0, 0), 人口: 10 },
        { id: "B", 名称: "乙城", 中心: at(4, 0), 人口: 10 },
      ],
    });
    const own = validateDistrictPlacement(
      R, b, at(1, 0), "DISTRICT_CAMPUS", { selectedCityId: "A" },
    );
    assert.equal(own.some((candidate) => candidate.code === "E16b"), false);

    const neutral = validateDistrictPlacement(
      R, b, at(0, 4), "DISTRICT_CAMPUS", { selectedCityId: "A" },
    );
    assert.match(first(neutral, "E16b").message, /没有归属任何城市/);

    const crossed = validateDistrictPlacement(
      R, b, at(3, 0), "DISTRICT_CAMPUS", { selectedCityId: "A" },
    );
    assert.match(first(crossed, "E16b").message, /属于乙城/);
  });

  test("移动城市中心后，旧区域跨越新边境会进入完整局面诊断", () => {
    const b = placedBoard({
      "0,0": { 区域: "DISTRICT_CITY_CENTER", 所属城市: "A" },
      "1,0": { 区域: "DISTRICT_CAMPUS", 所属城市: "A" },
      "3,-3": { 区域: "DISTRICT_CITY_CENTER", 所属城市: "B" },
      "-2,0": {},
    }, {
      已解锁科技: ["TECH_WRITING"],
      城市: [
        { id: "A", 名称: "甲城", 中心: at(0, 0), 人口: 10 },
        { id: "B", 名称: "乙城", 中心: at(3, -3), 人口: 10 },
      ],
    });
    const moved = moveCityCenter(b, "A", at(-2, 0));
    const issues = validateBoard(R, moved);
    assert.match(first(issues, "E16b").message, /归属甲城.*属于乙城/);
  });
});
