/** 精确有理数。求值器全程不用浮点 —— 见 设计/SDD-局面求值器.md §3.5 第 9 步。
 *
 * 为什么不用 number：`g = 符合数 × 加成值 ÷ 所需数量` 的结果是 1/2 的倍数，
 * number 表示 0.5 本身没有误差，但**累加顺序一旦影响结果就违反不变量 I3**
 * （顺序无关）。有理数让 I3 成为类型层面的事实而不是一个需要测试的巧合。
 */
export type Rat = { readonly n: number; readonly d: number };

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function rat(n: number, d = 1): Rat {
  if (d === 0) throw new Error("有理数分母为 0");
  if (!Number.isInteger(n) || !Number.isInteger(d)) {
    throw new Error(`有理数只接受整数，收到 ${n}/${d}`);
  }
  if (d < 0) [n, d] = [-n, -d];
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

/** 从 "1"、"-1"、"0.5" 这类配置表字面量解析。配置表里的加成值都是整数，
 *  但关卡的目标值会出现 0.5，所以两种都要支持。 */
export function parseRat(s: string): Rat {
  const t = s.trim();
  if (/^-?\d+$/.test(t)) return rat(Number(t));
  const m = /^(-?)(\d*)\.(\d+)$/.exec(t);
  if (!m) throw new Error(`无法解析为有理数：${s}`);
  const sign = m[1] === "-" ? -1 : 1;
  const frac = m[3];
  const denom = 10 ** frac.length;
  return rat(sign * (Number(m[2] || "0") * denom + Number(frac)), denom);
}

export const ZERO = rat(0);
export const add = (a: Rat, b: Rat): Rat => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rat, b: Rat): Rat => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d);
export const div = (a: Rat, b: Rat): Rat => {
  if (b.n === 0) throw new Error("有理数除以 0");
  return rat(a.n * b.d, a.d * b.n);
};
export const scale = (a: Rat, k: number): Rat => mul(a, rat(k));
export const eq = (a: Rat, b: Rat): boolean => a.n === b.n && a.d === b.d;
export const cmp = (a: Rat, b: Rat): number => a.n * b.d - b.n * a.d;
export const isZero = (a: Rat): boolean => a.n === 0;
export const toNumber = (a: Rat): number => a.n / a.d;

/** 渲染用：整数去掉小数点，否则保留一位小数。
 *  一位小数是游戏本身的行为 —— 提示文本的格式串是 `+#,###.#`（见拆解案 §4.3）。 */
export function fmt(a: Rat): string {
  if (a.d === 1) return String(a.n);
  return (a.n / a.d).toFixed(1);
}
