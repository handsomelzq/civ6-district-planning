import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRESETS, randomSandboxBoard, sandboxBoard } from "../web/presets.ts";
import { brushInfo } from "../web/brush_info.ts";
import { renderBreakdown, renderMap } from "../web/render.ts";
import {
  eraIndex, loadProgression, prerequisiteClosure, progressionGraphLayout,
} from "../web/progression.ts";
import { evaluate } from "../src/evaluate.ts";
import { distance } from "../src/hex.ts";
import { cityTerritoryOwner, MIN_CITY_CENTER_DISTANCE } from "../src/board.ts";
import { R, board } from "./helpers.ts";
import { localIconSrc } from "../web/local_icons.ts";
import {
  formatLegalityIssue,
  formatResearchAlert,
} from "../web/brush_info.ts";
import { validateDistrictPlacement } from "../src/legality.ts";

const root = fileURLToPath(new URL("../配置表/", import.meta.url));
const texts = Object.fromEntries(["terrains.csv", "features.csv"].map((f) =>
  [f, readFileSync(join(root, f), "utf8")]));
const page = readFileSync(join(root, "..", "web", "index.html"), "utf8");
const appSource = readFileSync(join(root, "..", "web", "app.ts"), "utf8");
const buildSource = readFileSync(join(root, "..", "Tools", "build_web.mjs"), "utf8");
const bundle = readFileSync(join(root, "..", "web", "dist", "app.bundle.js"), "utf8");
const progression = loadProgression(Object.fromEntries(
  ["tech_tree.csv", "civic_tree.csv", "policy_cards.csv", "religion_beliefs.csv"].map((f) =>
    [f.replace(".csv", ""), readFileSync(join(root, f), "utf8")]),
) as never);

test("多城预设每一行没有内部空洞，中立填补格不归属城市", () => {
  for (const preset of PRESETS) {
    const b = sandboxBoard(preset.id);
    const rows = new Map<number, number[]>();
    for (const k of b.tiles.keys()) {
      const [q, r] = k.split(",").map(Number);
      rows.set(r, [...(rows.get(r) ?? []), q]);
    }
    for (const [r, qs] of rows) for (let q = Math.min(...qs); q <= Math.max(...qs); q++) {
      assert.ok(b.tiles.has(`${q},${r}`), `${preset.id} 存在空洞 ${q},${r}`);
    }
    if (preset.id === "coast") {
      const neutral = [...b.tiles].filter(([k, tile]) => {
        const [q, r] = k.split(",").map(Number);
        return b.城市!.every((c) => distance(c.中心, { q, r }) > 3) && !tile.所属城市;
      });
      assert.ok(neutral.length > 0, "三城间应存在不属任何城市的填补格");
    }
  }
});

test("汉萨悬停说明显示特色商业中心 +2，并展示地形地貌核心信息", () => {
  const hansa = brushInfo({ kind: "区域", id: "DISTRICT_INDUSTRIAL_ZONE" },
    R, "CIVILIZATION_GERMANY", texts);
  assert.match(hansa.title, /商业同业/);
  assert.ok(hansa.lines.some((l) => /特色.*商业中心.*\+2.*生产力/.test(l)));
  const mountain = brushInfo({ kind: "地形", id: "TERRAIN_GRASS_MOUNTAIN" }, R, undefined, texts);
  assert.ok(mountain.lines.some((l) => l.includes("可建区域")));
  const forest = brushInfo({ kind: "地貌", id: "FEATURE_FOREST" }, R, undefined, texts);
  assert.ok(forest.lines.some((l) => l.includes("建造区域时移除")));
});

test("右侧按区块展示非零正负贡献，隐藏未触发的零规则", () => {
  const b = board({
    "0,0": { 区域: "DISTRICT_SEOWON" },
    "1,0": { 区域: "DISTRICT_CITY_CENTER" },
  }, { 文明: "CIVILIZATION_KOREA" });
  const html = renderBreakdown(evaluate(R, b));
  assert.match(html, /区块 \(0, 0\)/);
  assert.match(html, /\+4/);
  assert.match(html, /-1/);
  assert.doesNotMatch(html, /Mountains_Science/);
  assert.equal((html.match(/data-xy="0,0"/g) ?? []).length, 1);
});

test("入口页提供模式选择、设置入口和拆解文档入口", () => {
  assert.match(page, /id="home-screen"/);
  assert.match(page, /data-enter-mode="自由"/);
  assert.match(page, /data-enter-mode="挑战"/);
  assert.match(appSource, /addEventListener\("click",/);
  assert.match(appSource, /TABLE_TEXTS\["tech_tree\.csv"\]/);
  assert.match(appSource, /TABLE_TEXTS\["civic_tree\.csv"\]/);
  assert.match(appSource, /TABLE_TEXTS\["policy_cards\.csv"\]/);
  assert.match(page, /dist\/app\.bundle\.js\?v=20260929-4/);
  assert.match(page, /id="home-settings"/);
  assert.match(page, /id="settings-modal"/);
  assert.match(page, /\/tree\/main\/设计/);
  assert.match(page, /DISTRICT_CITY_CENTER\.png/);
  assert.match(page, /<script src="dist\/app\.bundle\.js\?v=20260929-4"><\/script>/);
  assert.match(buildSource, /emitBrowserBundle\(\)/);
  assert.match(bundle, /data-enter-mode/);
  assert.match(bundle, /enterMode/);
  assert.doesNotMatch(bundle, /(^|\n)\s*import\s/);
});

test("研究系统包含完整科技/文化树和区域规划精选政策卡", () => {
  assert.equal(progression.techs.size, 77);
  assert.equal(progression.civics.size, 61);
  assert.ok(progression.policies.some((p) => p.id === "POLICY_NATURAL_PHILOSOPHY"));
  assert.ok(progression.policies.some((p) => p.id === "POLICY_CRAFTSMEN"));
  const chain = prerequisiteClosure(progression.techs, "TECH_ENGINEERING");
  assert.ok(chain.includes("TECH_MINING"));
  assert.ok(chain.includes("TECH_ENGINEERING"));
  for (const node of [...progression.techs.values(), ...progression.civics.values()]) {
    assert.ok(node.name.length > 0);
    assert.ok(node.functionText.length > 0);
    for (const parent of node.prereqs) {
      const pool = progression.techs.has(node.id) ? progression.techs : progression.civics;
      assert.ok(pool.has(parent), `${node.id} 的前置节点不存在：${parent}`);
    }
  }
  assert.ok(eraIndex("ERA_ANCIENT") < eraIndex("ERA_CLASSICAL"));
  assert.ok(eraIndex("ERA_CLASSICAL") < eraIndex("ERA_ATOMIC"));
  assert.ok(eraIndex("ERA_ATOMIC") < eraIndex("ERA_FUTURE"));
});

test("政策、科技树和文化树为独立入口，研究树全屏横向展开", () => {
  assert.match(page, /id="policies">政策<\/button>/);
  assert.match(page, /id="tech-tree">科技树<\/button>/);
  assert.match(page, /id="civic-tree">文化树<\/button>/);
  assert.doesNotMatch(page, /id="progression">研究<\/button>/);
  assert.match(page, /\.progression-modal\{place-items:stretch;padding:0/);
  assert.match(page, /\.progression-modal \.modal-card\{width:100%;height:100%/);
  assert.match(page, /\.tree-board\{overflow-x:auto;overflow-y:hidden/);
  assert.match(appSource, /openProgression\("科技"\)/);
  assert.match(appSource, /openProgression\("文化"\)/);
});

test("研究树按真实前置关系画分叉连线，节点悬停显示完整功能", () => {
  assert.match(appSource, /function progressionTree/);
  assert.match(appSource, /class="tree-branch/);
  assert.match(appSource, /title="\$\{esc\(node\.functionText\)/);
  assert.doesNotMatch(appSource, /<small>\$\{esc\(node\.functionText\)\}<\/small>/);
  assert.match(page, /\.tree-canvas/);
  assert.match(appSource, /function progressionHoverHtml/);
  assert.match(appSource, /id="progression-hover"/);
  assert.match(appSource, /node\.onmouseenter = node\.onfocus = detail/);
  assert.match(appSource, /node\.onmouseleave = node\.onblur = clearDetail/);
  assert.match(page, /\.progression-hover/);
});

test("研究树按前置图层布局，时代只是节点标签且节点间距足够", () => {
  const techLayout = progressionGraphLayout(progression.techs);
  const civicLayout = progressionGraphLayout(progression.civics);
  for (const [nodes, layout] of [[progression.techs, techLayout], [progression.civics, civicLayout]] as const) {
    const seen = new Set<string>();
    for (const [id, point] of layout) {
      const cell = `${point.column}:${point.row}`;
      assert.ok(!seen.has(cell), `${id} 与其他节点共享布局槽位 ${cell}`);
      seen.add(cell);
      assert.ok(point.x >= 0 && point.y >= 0);
    }
    for (const node of nodes.values()) {
      const child = layout.get(node.id)!;
      for (const parent of node.prereqs) {
        assert.ok(layout.get(parent)!.column < child.column,
          `${node.id} 的前置 ${parent} 必须位于更早研究层`);
      }
    }
  }
  assert.match(appSource, /progressionGraphLayout/);
  assert.match(appSource, /tree-layer/);
  assert.match(page, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(page, /\.progression-node\{display:block;width:100%;height:34px/);
  assert.doesNotMatch(page, /\.tree-board\{overflow-x:auto;overflow-y:auto/);
  assert.match(appSource, /treeBoard\.onpointerdown/);
  assert.match(appSource, /treeBoard\.scrollLeft = startScrollLeft/);
  assert.match(page, /\.tree-board\.dragging\{cursor:grabbing\}/);
  for (const [nodes, layout] of [[progression.techs, techLayout], [progression.civics, civicLayout]] as const) {
    for (const node of nodes.values()) {
      assert.ok(layout.get(node.id)!.column >= eraIndex(node.era),
        `${node.name} 不能出现在其官方时代之前`);
    }
  }
});

test("政策卡有三个槽位并写入求值器：自然哲学使学院相邻翻倍", () => {
  const spec = {
    "0,0": { 区域: "DISTRICT_CAMPUS" },
    "1,0": { 地形: "TERRAIN_GRASS_MOUNTAIN" },
  };
  const normal = evaluate(R, board(spec));
  const boostedBoard = board(spec);
  const boosted = evaluate(R, { ...boostedBoard,
    已装配政策: new Set(["POLICY_NATURAL_PHILOSOPHY"]) });
  assert.equal(normal.合计.get("科技")!.n / normal.合计.get("科技")!.d, 1);
  assert.equal(boosted.合计.get("科技")!.n / boosted.合计.get("科技")!.d, 2);
  assert.match(appSource, /Array\.from\(\{ length: 3 \}/);
  assert.match(appSource, /next\.size < 3/);
  const seowon = board({
    "0,0": { 地形: "TERRAIN_GRASS_HILLS", 区域: "DISTRICT_CAMPUS" },
  }, { 文明: "CIVILIZATION_KOREA" });
  const doubledSeowon = evaluate(R, { ...seowon,
    已装配政策: new Set(["POLICY_NATURAL_PHILOSOPHY"]) });
  assert.equal(doubledSeowon.合计.get("科技")!.n / doubledSeowon.合计.get("科技")!.d, 8,
    "书院固定 +4 属于学院相邻加成，自然哲学应翻倍为 +8");
  assert.match(appSource, /SUPPORTED_POLICY_IDS\.has/,
    "政策池只应展示当前求值器能真实结算的卡");
});

test("宗教模块以信条卡呈现，职业道德和万神殿直接写入当前局面", () => {
  assert.match(page, /id="religion">宗教<\/button>/);
  assert.equal(progression.beliefs.length, 8);
  assert.ok(progression.beliefs.some((b) => b.id === "BELIEF_WORK_ETHIC" && b.name === "职业道德"));
  assert.match(appSource, /data-belief-id/);
  assert.match(appSource, /function toggleBelief/);

  const holySite = board({
    "0,0": { 区域: "DISTRICT_HOLY_SITE" },
    "1,0": { 地形: "TERRAIN_DESERT" },
    "0,1": { 地形: "TERRAIN_DESERT_HILLS" },
  });
  const selected = { ...holySite, 已选宗教信条: new Set([
    "BELIEF_DESERT_FOLKLORE", "BELIEF_WORK_ETHIC",
  ]) };
  const tree = evaluate(R, selected);
  assert.equal(tree.合计.get("信仰")!.n / tree.合计.get("信仰")!.d, 2);
  assert.equal(tree.合计.get("生产力")!.n / tree.合计.get("生产力")!.d, 2,
    "职业道德应镜像包含沙漠民俗在内的圣地信仰相邻加成");
  assert.match(appSource, /other\.beliefClass === belief\.beliefClass/,
    "同一信条类别只能保留一项，选择新项时应替换旧项");
});

test("宗教模块展示的八项信条都有真实求值效果", () => {
  const value = (id: string, spec: Parameters<typeof board>[0], yieldType: string) => {
    const b = board(spec);
    const tree = evaluate(R, { ...b, 已选宗教信条: new Set([id]) });
    const result = tree.合计.get(yieldType);
    return result ? result.n / result.d : 0;
  };
  assert.equal(value("BELIEF_DANCE_OF_THE_AURORA", {
    "0,0": { 区域: "DISTRICT_HOLY_SITE" }, "1,0": { 地形: "TERRAIN_TUNDRA" },
  }, "信仰"), 1);
  assert.equal(value("BELIEF_DESERT_FOLKLORE", {
    "0,0": { 区域: "DISTRICT_HOLY_SITE" }, "1,0": { 地形: "TERRAIN_DESERT" },
  }, "信仰"), 1);
  assert.equal(value("BELIEF_SACRED_PATH", {
    "0,0": { 区域: "DISTRICT_HOLY_SITE" }, "1,0": { 地貌: "FEATURE_JUNGLE" },
  }, "信仰"), 1);
  assert.equal(value("BELIEF_LAY_MINISTRY", {
    "0,0": { 区域: "DISTRICT_HOLY_SITE" },
  }, "信仰"), 1);
  assert.equal(value("BELIEF_DIVINE_INSPIRATION", {
    "0,0": { 世界奇观: "BUILDING_PYRAMIDS" },
  }, "信仰"), 4);
  const holyBuildings = { "0,0": {
    区域: "DISTRICT_HOLY_SITE", 建筑: ["BUILDING_SHRINE", "BUILDING_TEMPLE"],
  } };
  assert.equal(value("BELIEF_CHORAL_MUSIC", holyBuildings, "文化"), 6);
  assert.equal(value("BELIEF_FEED_THE_WORLD", holyBuildings, "粮食"), 6);
  assert.equal(value("BELIEF_WORK_ETHIC", {
    "0,0": { 区域: "DISTRICT_HOLY_SITE" }, "1,0": { 地形: "TERRAIN_GRASS_MOUNTAIN" },
  }, "生产力"), 1);
});

test("科技与文化节点会约束区域可用性，选择后刷新当前局面", () => {
  assert.match(appSource, /validateDistrictPlacement/);
  assert.match(appSource, /formatResearchAlert/);
  assert.match(readFileSync(join(root, "..", "web", "brush_info.ts"), "utf8"), /缺少科技：/);
  assert.match(readFileSync(join(root, "..", "web", "brush_info.ts"), "utf8"), /缺少市政：/);
  assert.match(readFileSync(join(root, "..", "src", "legality.ts"), "utf8"), /E14t/);
  assert.match(readFileSync(join(root, "..", "src", "legality.ts"), "utf8"), /E14c/);
  assert.match(appSource, /prerequisiteClosure/);
  assert.match(appSource, /app\.board = \{ \.\.\.app\.board, 已解锁科技: next \}/);
});

test("河流以连续边界折线呈现，湖泊以整格水面显示并提供淡水", () => {
  const b = board({
    "0,0": { 河流边: true },
    "1,0": { 河流边: true, 地形: "TERRAIN_COAST", 湖泊: true },
    "2,0": { 河流边: true },
  });
  const html = renderMap(R, b);
  assert.match(html, /class="river-edge"/);
  const riverLine = html.match(/<polyline points="([^"]+)" class="river-edge"\/>/);
  assert.ok(riverLine, "河流应由 polyline 绘制");
  assert.ok((riverLine[1].match(/,/g) ?? []).length >= 3,
    "至少两段相邻河流必须共享同一条连续折线");
  assert.match(html, /class="lake-surface"/);
  assert.match(page, /\.river-edge/);
  assert.match(page, /\.lake-surface/);
});

test("自由模式预设河流至少两段且属于同一连续河道", () => {
  for (const preset of PRESETS) {
    const river = [...sandboxBoard(preset.id).tiles.entries()]
      .filter(([, tile]) => tile.河流边)
      .map(([id]) => id);
    if (!river.length) continue;
    const remaining = new Set(river);
    const components: string[][] = [];
    while (remaining.size) {
      const start = remaining.values().next().value as string;
      remaining.delete(start);
      const component = [start];
      const queue = [start];
      while (queue.length) {
        const [q, r] = queue.shift()!.split(",").map(Number);
        for (const d of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
          const next = `${q + d[0]},${r + d[1]}`;
          if (!remaining.has(next)) continue;
          remaining.delete(next);
          component.push(next);
          queue.push(next);
        }
      }
      components.push(component);
    }
    assert.equal(components.length, 1, `${preset.id} 的河流不能断成多个水系`);
    assert.ok(components[0].length >= 3, `${preset.id} 的河流至少需要两段连续河段`);
  }
});

test("随机城市模板包含多城、合法中心间距、连续河流与中立边界", () => {
  for (const seed of [1, 2, 3, 20260930]) {
    const b = randomSandboxBoard(seed);
    assert.ok((b.城市?.length ?? 0) >= 2);
    for (const a of b.城市 ?? []) for (const z of b.城市 ?? []) {
      if (a.id < z.id) assert.ok(distance(a.中心, z.中心) >= MIN_CITY_CENTER_DISTANCE);
    }
    const river = [...b.tiles.values()].filter((tile) => tile.河流边);
    assert.ok(river.length >= 3);
    const neutral = [...b.tiles].filter(([id]) => !cityTerritoryOwner(b, {
      q: Number(id.split(",")[0]), r: Number(id.split(",")[1]),
    }));
    assert.ok(neutral.length > 0);
  }
});

test("所有配置中的地形与地貌都有本地 Civ VI 图标路径", () => {
  const all = [
    ...readFileSync(join(root, "terrains.csv"), "utf8").split("\n").slice(1)
      .map((line) => line.split(",")[0]).filter(Boolean),
    ...readFileSync(join(root, "features.csv"), "utf8").split("\n").slice(1)
      .map((line) => line.split(",")[0]).filter(Boolean),
  ];
  for (const id of all) {
    const icon = localIconSrc(id);
    assert.ok(icon && existsSync(join(root, "..", "web", icon)),
      `${id} 应有图标或明确的同类官方图标回退`);
  }
  assert.match(readFileSync(join(root, "..", "web", "render.ts"), "utf8"), /terrain-icon/);
  assert.match(readFileSync(join(root, "..", "web", "render.ts"), "utf8"), /feature-icon/);
});

test("区域缺少科技或市政时会生成弹窗提示，并把城市中心移动放在自由模式工具中", () => {
  assert.match(appSource, /function showPlacementAlert/);
  assert.match(appSource, /formatResearchAlert/);
  assert.match(appSource, /cityCenterPlacementConstraint/);
  assert.match(appSource, /random-template/);
  assert.match(page, /id="placement-alert"/);
  assert.match(appSource, /移动城市中心/);
});

test("放置提示使用共享合法性结果，并按错误码合并研究弹窗", () => {
  const b = board({ "0,0": {} });
  const issues = validateDistrictPlacement(R, b, { q: 0, r: 0 }, "DISTRICT_CAMPUS");
  assert.equal(issues[0]?.code, "E14t");
  assert.equal(formatLegalityIssue(issues[0]!), "学院 缺少前置科技：TECH_WRITING（E14t）");
  assert.deepEqual(
    formatResearchAlert(issues),
    ["缺少科技：TECH_WRITING"],
  );
  assert.match(appSource, /validateDistrictPlacement/);
  assert.doesNotMatch(appSource, /districtPlacementConstraint\(rules/);
});
