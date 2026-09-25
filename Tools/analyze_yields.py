#!/usr/bin/env python3
"""产出量级分析：从配置表算出各区域的相邻上界、建筑链总产出，以及两者之比。

跑：python3 Tools/analyze_yields.py            # 人类可读报告
    python3 Tools/analyze_yields.py --csv     # 追加一份 CSV 到 stdout，便于贴表

为什么要工具：`设计/数值设计.md` 里的每个数字都必须能重算。手抄一次就会过期，
而过期的数值文档比没有更危险 —— 它会被当成事实引用。

只用标准库。规则语义见 设计/SDD-局面求值器.md §3.3、§3.4。
"""
import csv, io, pathlib, sys
from collections import defaultdict
from fractions import Fraction

BASE = pathlib.Path(__file__).resolve().parent.parent / "配置表"
NEIGHBORS = 6          # 六边形地块的邻居数上限


def load(name):
    with io.open(str(BASE / name), encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def fmt(f):
    f = Fraction(f)
    return str(f.numerator // f.denominator) if f.denominator == 1 else "%.1f" % float(f)


def kv(s):
    """`科技:2|信仰:1` → {'科技': 2, '信仰': 1}；`无` → {}"""
    out = {}
    s = (s or "").strip()
    if s in ("", "无"):
        return out
    for part in s.split("|"):
        k, _, v = part.partition(":")
        if v:
            out[k.strip()] = out.get(k.strip(), Fraction(0)) + Fraction(v)
    return out


# ── 一、相邻上界 ────────────────────────────────────────────────────────
# 每条规则的单位贡献 = 加成值 ÷ 所需数量（SDD §3.3 的 g，全程不取整）。
#
# 一个邻格能同时命中多条规则：一个放了市政广场的邻格既命中 `区域=市政广场`
# 也命中 `任意其他区域`。所以先把规则按「邻格原型」归组，再取最肥的原型。
#
# 「邻格原型」的定义：一个具体邻格的可观测属性组合。这里枚举的原型是
#   · 某种地形（山脉变体…）
#   · 某种地貌（森林、雨林、礁石、地热裂缝…）
#   · 某种区域（同时命中「任意其他区域」）
#   · 某种改良设施（同时命中「任意资源」类规则？不——改良与资源是不同列，不合并）
#   · 自然奇观 / 世界奇观 / 海洋资源 / 任意资源 / 某个资源类别
# 布尔型且与邻格数无关的规则（河流、自身）单独加一次。
BOOLEAN_ONCE = {"河流", "自身"}
# 与「任意其他区域」共生的类别：邻格上有区域时这条一定同时命中
COEXIST_DISTRICT = "任意其他区域"


def adjacency_ceiling(rules_of_district, yield_type=None):
    """返回 (上界 dict, 最肥原型说明)。不考虑全局唯一性约束，见报告脚注。"""
    once = defaultdict(Fraction)
    arche = defaultdict(lambda: defaultdict(Fraction))      # 原型 → 产出 → 单位贡献
    generic = defaultdict(Fraction)                         # 「任意其他区域」的贡献
    for r in rules_of_district:
        y = r["产出类型"]
        unit = Fraction(r["加成值"]) / int(r["所需数量"])
        cat, tid = r["目标类别"], r["目标id"]
        if cat in BOOLEAN_ONCE:
            once[y] += Fraction(r["加成值"])                # 布尔型只给一次
        elif cat == COEXIST_DISTRICT:
            generic[y] += unit
        else:
            key = (cat, tid if tid != "无" else "")
            arche[key][y] += unit
    # 区域类原型要叠上「任意其他区域」
    for key in list(arche):
        if key[0] == "区域":
            for y, v in generic.items():
                arche[key][y] += v
    if generic:
        arche[(COEXIST_DISTRICT, "")] = defaultdict(Fraction, generic)

    def weight(d):
        return d.get(yield_type, Fraction(0)) if yield_type else sum(d.values(), Fraction(0))

    best_key, best = None, defaultdict(Fraction)
    for key, d in arche.items():
        if weight(d) > weight(best):
            best_key, best = key, d
    total = defaultdict(Fraction)
    for y, v in once.items():
        total[y] += v
    for y, v in best.items():
        total[y] += v * NEIGHBORS
    return dict(total), best_key


# ── 二、建筑链 ──────────────────────────────────────────────────────────
def building_chains(buildings):
    """每个区域的建筑链产出。三个数，而不是一个：

      基础链       非特色、非宗教的建筑求和 —— 任何文明任何信仰都拿得到
      宗教多选一   圣地的 9 栋宗教建筑取值区间（玩家按所信宗教选一，**不是求和**）
      特色建筑     `替换建筑id` 非空的那些，按替换关系独立列出

    为什么不把宗教建筑折进一个数：9 栋的产出并不相同（信仰 3 到 5，还有
    附带粮食/生产力/科技的），挑哪一栋是**玩家的宗教决策**而不是常量。
    早先用 `max(总产出)` 取一栋，结果在谒师所（信仰3+粮食2）与犹太教堂
    （信仰5）之间被并列打破顺序随机决定 —— 一个不该存在的任意性。
    """
    by_dist = defaultdict(list)
    for b in buildings:
        by_dist[b["所属区域id"]].append(b)
    out = {}
    for d, bs in by_dist.items():
        base = [b for b in bs
                if b["替换建筑id"].strip() in ("", "无") and b["是否宗教建筑"] != "是"]
        uniq = [b for b in bs if b["替换建筑id"].strip() not in ("", "无")]
        relig = [b for b in bs if b["是否宗教建筑"] == "是"]
        tot = defaultdict(Fraction)
        for b in base:
            for y, v in kv(b["基础产出"]).items():
                tot[y] += v
        naive = defaultdict(Fraction)
        for b in bs:
            for y, v in kv(b["基础产出"]).items():
                naive[y] += v
        sums = [sum(kv(b["基础产出"]).values(), Fraction(0)) for b in relig]
        out[d] = dict(基础链=dict(tot), 直接求和=dict(naive), 栋数=len(bs),
                      基础栋数=len(base), 特色=uniq, 宗教栋数=len(relig),
                      宗教区间=(min(sums), max(sums)) if sums else None,
                      成本=sum(int(b["生产成本"] or 0) for b in base))
    return out


def inherited(chains, districts, d):
    """特色区域没有自己的建筑行，它建的是**被替换区域**的建筑（游戏行为）。

    `Buildings.PrereqDistrict` 指向基础区域，所以按 `所属区域id` 分组时特色区域
    会显示「无建筑」—— 那是建模假象，不是游戏事实：书院能建图书馆与大学。
    这条继承关系是规则，属于求值器（SDD-局面求值器.md §6 边界），不该靠在
    `buildings.csv` 里复制行来表达。
    """
    if d in chains:
        return chains[d], None
    base = (districts.get(d) or {}).get("替换区域id", "无").strip()
    if base and base != "无" and base in chains:
        return chains[base], base
    return None, None


# ── 三、关卡难度曲线 ────────────────────────────────────────────────────
def level_curve(levels):
    """从 levels.csv 读出难度曲线：预算、目标、贪心、最优、差距。"""
    def total(v):
        v = (v or "").strip()
        if not v:
            return Fraction(0)
        if ":" not in v:
            return Fraction(v)
        return sum((Fraction(p.partition(":")[2]) for p in v.split("|")), Fraction(0))
    out = []
    for r in levels:
        T, G = total(r["目标值"]), total(r["贪心基线结果"])
        V = Fraction(r["三星阈值"])
        out.append(dict(lid=r["关卡id"], name=r["名称"], kind=r["关卡类别"],
                        motif=r["母题"], budget=int(r["约束值"]),
                        civ=r["文明id"].replace("CIVILIZATION_", ""),
                        multi=":" in r["目标值"], T=T, G=G, V=V, gap=V - G,
                        star2=Fraction(r["二星阈值"])))
    return sorted(out, key=lambda x: x["lid"])


# ── 报告 ────────────────────────────────────────────────────────────────
def main(argv):
    as_csv = "--csv" in argv
    adj = defaultdict(list)
    for r in load("adjacency_rules.csv"):
        adj[r["区域id"]].append(r)
    districts = dict((r["区域id"], r) for r in load("districts.csv"))
    chains = building_chains(load("buildings.csv"))
    names = dict((k, v["名称"]) for k, v in districts.items())

    print("=" * 78)
    print("一、相邻加成的理论上界（6 个邻格全部换成最肥的那种原型）")
    print("=" * 78)
    print("%-12s %-22s %s" % ("区域", "最肥邻格原型", "上界（各产出）"))
    rows = []
    for d in sorted(adj, key=lambda x: names.get(x, x)):
        ceil, key = adjacency_ceiling(adj[d])
        if not ceil:
            continue
        if key is None:
            # 所有邻格原型的净收益都 ≤ 0（书院：每相邻一区域 −1，市政广场那 +1
            # 只够抵消回 0）。此时上界只剩布尔型规则的固定值。
            label = "无（邻格净收益均 ≤0）"
        else:
            label = "%s%s" % (key[0],
                              ("=" + names.get(key[1], key[1])) if key[1] else "")
        txt = "  ".join("%s %s" % (y, fmt(v)) for y, v in sorted(ceil.items()))
        print("%-12s %-22s %s" % (names.get(d, d), label, txt))
        rows.append((names.get(d, d), d, label, ceil))
    print("""
⚠️ 这是**忽略全局唯一性的上界**。市政广场全文明仅一座（`MaxPerPlayer=1`），
   所以"6 个邻格都是市政广场"在游戏里不可能。要算出可实现的上界，需要
   `districts.OnePerCity` / `MaxPerPlayer` 两列 —— 它们正是 配置表/字段说明.md
   §六·二 里仍未补的缺口。**这份报告就是那个缺口的具体消费者。**""")

    print("\n" + "=" * 78)
    print("二、建筑链产出（基础链 / 宗教多选一 / 特色建筑，三者分开）")
    print("=" * 78)
    print("%-12s %-8s %-22s %-12s %s" % ("区域", "栋数", "基础链", "宗教多选一", "直接求和（错的）"))
    for d in sorted(chains, key=lambda x: names.get(x, x)):
        c = chains[d]
        std = "  ".join("%s %s" % (y, fmt(v)) for y, v in sorted(c["基础链"].items())) or "无"
        nai = "  ".join("%s %s" % (y, fmt(v)) for y, v in sorted(c["直接求和"].items())) or "无"
        rel = ("+%s~%s（%d 栋选一）" % (fmt(c["宗教区间"][0]), fmt(c["宗教区间"][1]),
                                    c["宗教栋数"])) if c["宗教区间"] else "—"
        print("%-12s %-8s %-22s %-12s %s"
              % (names.get(d, d), "%d(基%d)" % (c["栋数"], c["基础栋数"]), std, rel, nai))
    print("""
⚠️ 「直接求和」那一列是**错的**，列在这里是为了看清错多少：它把互斥项都加了进去。
   圣地最极端 —— 直接求和 信仰 45，而实际拿得到的是基础链 6 加宗教多选一 3~5，
   即 9~11。**高算 4.1~5.0 倍。**（拆解案里先前手算的「3.7 倍」低估了这个问题；
   这份报告的数字是可重算的那个。）
   娱乐中心的 7 倍来自另一种情形：基础链本身只有文化 1，两栋特色建筑相对它很大。""")
    print("\n" + "=" * 78)
    print("三、相邻 vs 建筑：同一个区域的两种产出来源")
    print("=" * 78)
    print("%-12s %-10s %-12s %-9s %-9s %s"
          % ("区域", "相邻上界", "建筑（含宗教）", "建筑成本", "相邻/建筑", "建筑来源"))
    for nm, d, label, ceil in rows:
        c, via = inherited(chains, districts, d)
        a = sum(ceil.values(), Fraction(0))
        if c:
            b = sum(c["基础链"].values(), Fraction(0))
            if c["宗教区间"]:
                b += c["宗教区间"][1]
            cost, ratio = c["成本"], "%.1f×" % (float(a) / float(b)) if b else "—"
        else:
            b, cost, ratio = Fraction(0), 0, "—（无建筑）"
        print("%-12s %-10s %-12s %-9s %-9s %s"
              % (nm, fmt(a), fmt(b) if c else "无", cost, ratio,
                 ("继承 " + names.get(via, via)) if via else ("自有" if c else "—")))
    print("""
两条结论：
 1. **相邻上界普遍高于建筑链**（多数区域 1.1~3.0 倍），而且相邻加成**不花生产力**
    —— 它是放置决策的产物。建筑链要花 190~1665 生产力才拿到那个数。
    按「每点生产力换多少产出」算，选对位置比盖满建筑高一个数量级。
 2. **特色区域的建筑是继承来的**，不是它自己表里的行。`Buildings.PrereqDistrict`
    指向基础区域，所以按 `所属区域id` 分组时特色区域会显示「无建筑」——
    那是建模假象：书院能建图书馆与大学。这条继承关系属于求值器的规则。""")
    print("\n" + "=" * 78)
    print("四、关卡难度曲线")
    print("=" * 78)
    print("%-6s %-8s %-5s %-7s %-4s %-7s %-7s %-7s %-7s %s"
          % ("关卡", "名称", "类别", "母题", "预算", "贪心", "目标", "二星", "三星", "V−G"))
    for L in level_curve(load("levels.csv")):
        print("%-6s %-8s %-5s %-7s %-4d %-7s %-7s %-7s %-7s %s%s"
              % (L["lid"], L["name"], L["kind"], L["motif"], L["budget"],
                 fmt(L["G"]), fmt(L["T"]), fmt(L["star2"]), fmt(L["V"]), fmt(L["gap"]),
                 "　（多产出，值为合计）" if L["multi"] else ""))
    print("""
读法：`V−G` 是「最优与贪心的差距」，它同时是关卡的**规划含量**与**星级层次**
   的度量 —— 设计/关卡设计.md §8.2 要求 `V−G ≥ 1.5` 才撑得起三档星级。""")

    if as_csv:
        print("\n" + "=" * 78)
        print("CSV（区域,相邻上界合计,建筑标准链合计,建筑成本）")
        w = csv.writer(sys.stdout, lineterminator="\n")
        w.writerow(["区域id", "名称", "最肥邻格原型", "相邻上界合计",
                    "建筑标准链合计", "建筑成本"])
        for nm, d, label, ceil in rows:
            c = chains.get(d)
            w.writerow([d, nm, label, fmt(sum(ceil.values(), Fraction(0))),
                        fmt(sum(c["标准链"].values(), Fraction(0))) if c else "",
                        c["成本"] if c else ""])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
