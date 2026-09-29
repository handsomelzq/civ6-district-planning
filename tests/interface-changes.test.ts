import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRESETS, sandboxBoard } from "../web/presets.ts";
import { brushInfo } from "../web/brush_info.ts";
import { renderBreakdown } from "../web/render.ts";
import { eraIndex, loadProgression, prerequisiteClosure } from "../web/progression.ts";
import { evaluate } from "../src/evaluate.ts";
import { distance } from "../src/hex.ts";
import { R, board } from "./helpers.ts";

const root = fileURLToPath(new URL("../配置表/", import.meta.url));
const texts = Object.fromEntries(["terrains.csv", "features.csv"].map((f) =>
  [f, readFileSync(join(root, f), "utf8")]));
const page = readFileSync(join(root, "..", "web", "index.html"), "utf8");
const appSource = readFileSync(join(root, "..", "web", "app.ts"), "utf8");
const progression = loadProgression(Object.fromEntries(
  ["tech_tree.csv", "civic_tree.csv", "policy_cards.csv"].map((f) =>
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
  assert.match(page, /dist\/web\/app\.js\?v=20260929-2/);
  assert.match(page, /id="home-settings"/);
  assert.match(page, /id="settings-modal"/);
  assert.match(page, /\/tree\/main\/设计/);
  assert.match(page, /DISTRICT_CITY_CENTER\.png/);
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
