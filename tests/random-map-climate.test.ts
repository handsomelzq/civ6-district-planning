import test from "node:test";
import assert from "node:assert/strict";
import { randomSandboxBoard } from "../web/presets.ts";
import { key, neighbors, parseKey } from "../src/hex.ts";

const seeds = Array.from({ length: 200 }, (_, i) => i + 1);

function components(ids: string[]): string[][] {
  const remaining = new Set(ids);
  const result: string[][] = [];
  while (remaining.size) {
    const queue = [remaining.values().next().value!];
    remaining.delete(queue[0]);
    for (let i = 0; i < queue.length; i++) {
      for (const p of neighbors(parseKey(queue[i]))) {
        const next = key(p);
        if (remaining.delete(next)) queue.push(next);
      }
    }
    result.push(queue);
  }
  return result;
}

test("随机冻土只在一个南北边缘带出现，且连到极地方向边界", () => {
  for (const seed of seeds) {
    const ids = [...randomSandboxBoard(seed).tiles]
      .filter(([, t]) => t.地形.startsWith("TERRAIN_TUNDRA"))
      .map(([id]) => id);
    if (!ids.length) continue;
    const rows = ids.map((id) => parseKey(id).r);
    assert.ok(rows.every((r) => r <= -5) || rows.every((r) => r >= 5),
      `seed=${seed}：冻土不能散落内陆或同时占据两极`);
    for (const group of components(ids)) {
      assert.ok(group.some((id) => Math.abs(parseKey(id).r) === 7),
        `seed=${seed}：冻土片区必须连接南北边缘`);
    }
  }
});

test("小型区域地图可不含极地，也能生成北缘或南缘冻土", () => {
  const climates = new Set<string>();
  for (const seed of seeds) {
    const rows = [...randomSandboxBoard(seed).tiles]
      .filter(([, t]) => t.地形.startsWith("TERRAIN_TUNDRA"))
      .map(([id]) => parseKey(id).r);
    climates.add(!rows.length ? "无极地" : rows.every((r) => r < 0) ? "北缘" : "南缘");
  }
  assert.deepEqual([...climates].sort(), ["北缘", "南缘", "无极地"].sort());
});

test("最终地图的沙漠连成一个片区，不被海岸、湖泊或城市中心切成碎块", () => {
  for (const seed of seeds) {
    const ids = [...randomSandboxBoard(seed).tiles]
      .filter(([, t]) => t.地形.startsWith("TERRAIN_DESERT"))
      .map(([id]) => id);
    assert.ok(ids.length >= 2, `seed=${seed}：不是单格孤立沙漠`);
    assert.equal(components(ids).length, 1, `seed=${seed}：沙漠必须集中连片`);
    assert.ok(ids.every((id) => Math.abs(parseKey(id).r) < 5),
      `seed=${seed}：沙漠不能侵入极地带`);
  }
});

test("随机生物群落不把雨林、沼泽或森林放进不适宜的冻土或沙漠", () => {
  for (const seed of seeds) for (const [, t] of randomSandboxBoard(seed).tiles) {
    if (t.地形.startsWith("TERRAIN_TUNDRA")) {
      assert.ok(!["FEATURE_JUNGLE", "FEATURE_MARSH"].includes(t.地貌 ?? ""));
    }
    if (t.地形.startsWith("TERRAIN_DESERT")) {
      assert.ok(!["FEATURE_JUNGLE", "FEATURE_MARSH", "FEATURE_FOREST"].includes(t.地貌 ?? ""));
    }
    if (t.地貌 === "FEATURE_MARSH") assert.equal(t.地形, "TERRAIN_GRASS");
  }
});

test("气候生成保留固定种子重现、不同种子差异和完整169格地图", () => {
  const signature = (seed: number) => JSON.stringify([...randomSandboxBoard(seed).tiles]);
  assert.equal(signature(12345), signature(12345));
  assert.notEqual(signature(12345), signature(54321));
  for (const seed of seeds) assert.equal(randomSandboxBoard(seed).tiles.size, 169);
});
