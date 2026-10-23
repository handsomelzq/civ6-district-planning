import test from "node:test";
import assert from "node:assert/strict";
import { renderMap } from "../web/render.ts";
import { randomSandboxBoard, sandboxBoard } from "../web/presets.ts";
import { moveCityCenter, type BoardState } from "../src/board.ts";
import { board, R } from "./helpers.ts";

const pointId = (value: string): string => value.split(",").map(Number).join(",");
const segmentId = (a: string, b: string): string => [pointId(a), pointId(b)].sort().join("|");
const riverLines = (html: string): string[][] =>
  [...html.matchAll(/<polyline points="([^"]+)" class="river-edge"/g)]
    .map((m) => m[1].split(" ").map(pointId));

// 从最终 SVG 的地块多边形独立抽取边，防止“边界附近”又被误当作真正边界。
function assertOnHexEdges(b: BoardState, terrainArt: boolean): string[][] {
  const html = renderMap(R, b, { terrainArt });
  const edges = new Set<string>();
  for (const m of html.matchAll(/<polygon points="([^"]+)"/g)) {
    const vertices = m[1].split(" ");
    for (let i = 0; i < vertices.length; i++) {
      edges.add(segmentId(vertices[i], vertices[(i + 1) % vertices.length]));
    }
  }
  const lines = riverLines(html);
  for (const line of lines) {
    assert.ok(line.length >= 3, "每条河至少包含两段相连河段，不画孤立点");
    for (let i = 1; i < line.length; i++) {
      assert.notEqual(line[i - 1], line[i], "不能用重复点冒充连续河段");
      assert.ok(edges.has(segmentId(line[i - 1], line[i])),
        `河段 ${line[i - 1]} → ${line[i]} 必须恰好是一条六边形边，不能穿格或跳边`);
    }
  }
  return lines;
}

test("横向河道沿尖顶六边格边缘折行，不再用直线切过格子", () => {
  const b = board({ "0,0": { 河流边: true }, "1,0": { 河流边: true }, "2,0": { 河流边: true } });
  for (const art of [false, true]) {
    const lines = assertOnHexEdges(b, art);
    assert.equal(lines.length, 1);
    assert.ok(new Set(lines[0].map((p) => p.split(",")[1])).size > 1);
  }
});

test("转弯和成团临河格也只能沿真实边线连接，不能退回中心连线", () => {
  for (const ids of [["0,0", "1,0", "1,-1"], ["0,0", "1,0", "0,-1", "-1,1"]]) {
    const b = board(Object.fromEntries(ids.map((id) => [id, { 河流边: true }])));
    assert.equal(assertOnHexEdges(b, true).length, 1);
  }
});

test("旧关卡只有一个临河格时仍表现为至少两段相连的边缘河道", () => {
  assert.equal(assertOnHexEdges(board({ "0,0": { 河流边: true } }), true).length, 1);
  assert.equal(riverLines(renderMap(R, board({ "0,0": {} }))).length, 0);
});

test("200个随机模板的河道最终只有一条连续贴边折线，城市中心不截断河流", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const b = randomSandboxBoard(seed);
    assert.equal(assertOnHexEdges(b, true).length, 1, `seed=${seed}：河道不应断成多条线`);
  }
});

test("随机种子6的河道经过中心行时，城市中心不能把它分成两截", () => {
  assert.equal(riverLines(renderMap(R, randomSandboxBoard(6))).length, 1);
});

test("移动临河城市中心不改变已有河道，渲染不修改局面", () => {
  const b = sandboxBoard("mountain");
  const before = JSON.stringify([...b.tiles]);
  const river = riverLines(renderMap(R, b, { terrainArt: true }));
  const moved = moveCityCenter(b, "A", { q: 0, r: 1 });
  assert.deepEqual(riverLines(renderMap(R, moved, { terrainArt: true })), river);
  assert.equal(JSON.stringify([...b.tiles]), before);
});

test("显式路径必须原样沿真实格边渲染，不再猜临河片区外轮廓", () => {
  const b: BoardState = {
    ...board({ "0,0": { 河流边: true }, "1,0": { 河流边: true },
      "0,1": { 河流边: true }, "1,-1": {} }),
    河道: [[{ x: 1, y: -1 }, { x: 1, y: 1 }, { x: 0, y: 2 }]],
  };
  const expected = [["26,-15", "26,15", "0,30"]];
  for (const terrainArt of [false, true]) {
    assert.deepEqual(assertOnHexEdges(b, terrainArt), expected);
    assert.deepEqual(riverLines(renderMap(R, { ...b, 河道: [] }, { terrainArt })), []);
  }
});

test("显式随机河道移动城心后保持不变，渲染不修改输入", () => {
  const b = randomSandboxBoard(61);
  const snapshot = JSON.stringify({ tiles: [...b.tiles], paths: b.河道 });
  const lines = assertOnHexEdges(b, true);
  const city = b.城市![0];
  const targetId = [...b.tiles].find(([, t]) => !t.区域 && t.地形 === "TERRAIN_GRASS")![0];
  const [q, r] = targetId.split(",").map(Number);
  const moved = moveCityCenter(b, city.id, { q, r });
  assert.deepEqual(riverLines(renderMap(R, moved, { terrainArt: true })), lines);
  assert.equal(JSON.stringify({ tiles: [...b.tiles], paths: b.河道 }), snapshot);
});
