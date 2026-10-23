import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { deflateSync, inflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const crc = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (const byte of buf) { c ^= byte; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
};
function png(pixels: Buffer): Buffer {
  const chunk = (tag: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(tag), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const hdr = Buffer.alloc(13); hdr.writeUInt32BE(4, 0); hdr.writeUInt32BE(4, 4); hdr[8] = 8; hdr[9] = 6;
  const rows = Buffer.concat(Array.from({ length: 4 }, (_, y) => Buffer.concat([Buffer.from([0]), pixels.subarray(y * 16, y * 16 + 16)])));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', hdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test("素材导入只将地形底图变不透明，丘陵裁去留白并保留原像素与来源", () => {
  const dir = mkdtempSync(join(tmpdir(), "terrain-import-"));
  try {
    const input = join(dir, "input"), out = join(dir, "out"); mkdirSync(input);
    const pixels = Buffer.alloc(64);
    for (let i = 0; i < 16; i++) { pixels.set([20, 80, 40, (i === 5 || i === 6 || i === 9 || i === 10) ? 255 : 0], i * 4); }
    const names = ["SV_TerrainHexGrasslands_Color", "SV_Sprites_HillsGrasslands_Color_1"];
    const data = png(pixels);
    for (const name of names) writeFileSync(join(input, name + '.png'), data);
    const manifest = names.map((name) => ({ name, width: 4, height: 4,
      png_sha256: createHash('sha256').update(data).digest('hex'), source: 'test.blp' }));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const run = spawnSync('python3', ['Tools/import_terrain_art.py', '--source', input,
      '--manifest', join(dir, 'manifest.json'), '--out', out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const base = readFileSync(join(out, names[0] + '.png'));
    assert.equal(base.readUInt32BE(16), 4);
    const hill = readFileSync(join(out, names[1] + '.png'));
    assert.equal(hill.readUInt32BE(16), 2);
    assert.equal(hill.readUInt32BE(20), 2);
    const raw = (d: Buffer) => {
      const blocks: Buffer[] = []; for (let p = 8; p < d.length;) {
        const n = d.readUInt32BE(p); if (d.toString('ascii', p + 4, p + 8) === 'IDAT') blocks.push(d.subarray(p + 8, p + 8 + n)); p += n + 12;
      } return inflateSync(Buffer.concat(blocks));
    };
    const baseRows = raw(base);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) assert.equal(baseRows[y * 17 + 1 + x * 4 + 3], 255);
    assert.deepEqual(raw(hill), Buffer.from([0,20,80,40,255,20,80,40,255,0,20,80,40,255,20,80,40,255]));
    assert.equal(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))[0].source, 'test.blp');
    // A damaged source must be rejected rather than silently installing misleading art.
    writeFileSync(join(input, names[0] + '.png'), Buffer.from('not a PNG'));
    const bad = spawnSync('python3', ['Tools/import_terrain_art.py', '--source', input,
      '--manifest', join(dir, 'manifest.json'), '--out', join(dir, 'bad')], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
