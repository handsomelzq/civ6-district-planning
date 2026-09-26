/** 最小 CSV 解析。零依赖 —— 与 Tools/*.py 只用标准库是同一条纪律。
 *
 * 支持配置表实际用到的全部形态：带引号的字段（关卡坐标 `"0,0"`）、引号内的逗号、
 * 转义的双引号（`""`）、UTF-8 BOM、CRLF。不支持的（配置表里也不存在）：
 * 引号内换行。遇到就抛错而不是猜 —— 静默猜错的表比解析失败的表危险得多。
 */
export type Row = Record<string, string>;

export function parseCsv(text: string): Row[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;   // 去 BOM
  const lines = src.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const head = splitLine(lines[0]);
  return lines.slice(1).map((line, i) => {
    const cells = splitLine(line);
    if (cells.length !== head.length) {
      throw new Error(
        `CSV 第 ${i + 2} 行有 ${cells.length} 个字段，表头有 ${head.length} 个`);
    }
    const row: Row = {};
    head.forEach((h, j) => (row[h] = cells[j]));
    return row;
  });
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      out.push(cur); cur = "";
    } else cur += c;
  }
  if (quoted) throw new Error(`CSV 行内引号未闭合：${line.slice(0, 60)}`);
  out.push(cur);
  return out;
}

/** 配置表的空值约定是字面的「无」，不是空串（见 配置表/字段说明.md §零）。 */
export const NONE = "无";
export const isNone = (v: string | undefined): boolean =>
  v === undefined || v.trim() === "" || v.trim() === NONE;

/** `键:值|键:值` → Map。用于 基础产出 这类字段。 */
export function parseKv(v: string): Map<string, string> {
  const out = new Map<string, string>();
  if (isNone(v)) return out;
  for (const part of v.split("|")) {
    const i = part.indexOf(":");
    if (i < 0) throw new Error(`字段不是 键:值 形式：${part}`);
    out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

/** `a|b|c` → 数组；「无」→ 空数组。 */
export function parseList(v: string): string[] {
  if (isNone(v)) return [];
  return v.split("|").map((x) => x.trim()).filter((x) => x.length > 0);
}

/** 上限列：正整数 → 该数；「无限」→ `Infinity`。
 *
 *  注意「无限」与「无」是两个不同的记号（见 parse_civ6_xml.py 的 UNLIMITED）：
 *  「无」表示"没有这个属性"，在上限列里会被读成 0，把不限当成不可建。所以这里
 *  **只认「无限」**，遇到「无」或空值一律抛错而不静默回退 —— 配表校验（规则 22）
 *  已经守住了这条，这里再守一次是因为静默回退的后果是"某个区域永远不能放"，
 *  那种 bug 在界面上看起来像规则，不像错误。 */
export function parseLimit(v: string): number {
  const t = (v ?? "").trim();
  if (t === "无限") return Infinity;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`上限列的取值应为正整数或「无限」，实为 ${JSON.stringify(v)}`);
  return n;
}
