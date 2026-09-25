/** Node 侧的表加载器。**只有这一个文件碰 fs** —— 核心层保持零 I/O，
 *  于是同一份 `Rules` 能跑在浏览器里（表由构建期内联，见 Tools/build_web.mjs）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { Rules, TABLE_FILES, type TableTexts } from "./rules.ts";

/** 默认表目录。用 fileURLToPath 而不是 URL.pathname —— 路径里有中文，
 *  pathname 是百分号编码的，直接喂给 fs 会 ENOENT。 */
export const DEFAULT_TABLE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)), "..", "配置表");

export function readTables(dir: string = DEFAULT_TABLE_DIR): TableTexts {
  const out = {} as TableTexts;
  for (const f of TABLE_FILES) out[f] = readFileSync(path.join(dir, f), "utf8");
  return out;
}

export const loadRules = (dir: string = DEFAULT_TABLE_DIR): Rules =>
  new Rules(readTables(dir));
