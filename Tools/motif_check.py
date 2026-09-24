#!/usr/bin/env python3
"""关卡母题验证：用真实规则算出「贪心是否真的会失败」。

跑：python3 Tools/motif_check.py

母题定义见 设计/关卡设计.md §2。判据见同文档 §1（贪心必须失败）与 §7（贪心定义）。
"""
import itertools, sys, pathlib
from fractions import Fraction
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from prototype_eval import (Rules, Board, eval_board, greedy, effective, fmt, show)

R = Rules()
MTN = "TERRAIN_GRASS_MOUNTAIN"
FLAT = "TERRAIN_GRASS"
FOREST = "FEATURE_FOREST"
CAMPUS, HOLY, GOV = "DISTRICT_CAMPUS", "DISTRICT_HOLY_SITE", "DISTRICT_GOVERNMENT"
CENTER = "DISTRICT_CITY_CENTER"


def tile(terrain=FLAT, feature=None, district=None):
    return {"地形": terrain, "地貌": feature, "区域": district}


def exhaustive(board, palette, budget, yt, civ=None):
    """穷举最优：小盘面上可行，给出严格的最优解而不是我的猜测。"""
    empties = sorted(board.empties(R))
    best = (Fraction(-1), None)
    for k in range(1, budget + 1):
        for spots in itertools.combinations(empties, k):
            for combo in itertools.product(palette, repeat=k):
                b = board
                for p, d0 in zip(spots, combo):
                    b = b.copy_with(p, effective(R, d0, civ))
                v = eval_board(R, b, civ)[0].get(yt, Fraction(0))
                if v > best[0]:
                    best = (v, list(zip(spots, combo)), b)
    return best


def verdict(name, board, palette, budget, yt, civ=None, note=""):
    print("\n" + "=" * 68)
    print("【%s】预算 %d 个区域，目标产出：%s%s" % (name, budget, yt,
                                              ("　（%s）" % note) if note else ""))
    gb, steps = greedy(R, board, palette, budget, yt, civ)
    gv = eval_board(R, gb, civ)[0].get(yt, Fraction(0))
    print("  贪心：", " → ".join("%s放%s(+%s)" % (p, R.name(d), fmt(g))
                                 for p, d, g in steps) or "（无正收益可放）")
    print("  贪心结果 = %s" % fmt(gv))
    bv, plan, bb = exhaustive(board, palette, budget, yt, civ)
    print("  最优：", " → ".join("%s放%s" % (p, R.name(effective(R, d, civ)))
                                for p, d in plan))
    print("  最优结果 = %s" % fmt(bv))
    gap = bv - gv
    if gap > 0:
        print("  ✅ 母题成立：贪心比最优低 %s（差 %.0f%%）"
              % (fmt(gap), 100.0 * float(gap) / float(bv)))
    else:
        print("  ❌ 母题不成立：贪心已达最优，这个盘面没有设计含量")
    return gv, bv


# ── 0. 校准：复现 2026-09-24 的四个实测读数 ──────────────────────────
print("=" * 68)
print("【校准】对照 2026-09-24 游戏内实测读数（圣地 + 森林）")
cases = [
    ("2 片森林", {(0, 0): tile(district=HOLY), (1, 0): tile(feature=FOREST),
                 (0, 1): tile(feature=FOREST)}, "1"),
    ("1 片森林", {(0, 0): tile(district=HOLY), (1, 0): tile(feature=FOREST)}, "0.5"),
    ("1 个城市中心", {(0, 0): tile(district=HOLY), (1, 0): tile(district=CENTER)}, "0.5"),
    ("1 森林+1 城市中心", {(0, 0): tile(district=HOLY), (1, 0): tile(feature=FOREST),
                        (0, 1): tile(district=CENTER)}, "1"),
    ("2 座山脉（主要档）", {(0, 0): tile(district=HOLY), (1, 0): tile(MTN),
                       (0, 1): tile(MTN)}, "2"),
]
ok = True
for label, tiles, expect in cases:
    got = fmt(eval_board(R, Board(tiles))[0].get("信仰", Fraction(0)))
    flag = "✓" if got == expect else "✗"
    if got != expect:
        ok = False
    print("  %s %-20s 原型 %-4s 实测 %-4s" % (flag, label, got, expect))
if not ok:
    print("\n✗ 原型与实测不符，后面的结论不可信。停止。")
    sys.exit(1)
print("  → 原型与全部实测读数一致，可以用来验证母题。")


# ── 母题 A · 争格 ────────────────────────────────────────────────────
# (0,0) 同时是学院最优位（挨 2 山）与圣地最优位（挨 2 森林）；
# 次优位不对称：学院的次优位还能挨 1 山，圣地的次优位一片森林都挨不到。
A = {}
for q, r in [(0, 0), (1, 0), (0, 1), (1, -1), (-1, 1), (2, -1), (-1, 0), (2, 0), (0, -1)]:
    A[(q, r)] = tile()
A[(1, 0)] = tile(MTN); A[(0, 1)] = tile(MTN)          # (0,0) 挨 2 山
A[(1, -1)] = tile(feature=FOREST); A[(-1, 1)] = tile(feature=FOREST)  # (0,0) 挨 2 森林
A[(2, -1)] = tile(MTN)                                # (2,0) 挨 1 山（学院次优）
verdict("母题 A 争格", Board(A), [CAMPUS, HOLY], 2, "科技",
        note="学院与圣地抢同一格；这里只看科技，所以抢到手才算数")


# ── 母题 B · 集群中心 ─────────────────────────────────────────────
# 目标函数 = Σ(各区域的山脉相邻数) + (相邻区域对数)。这是个带点权的最密子图
# 问题，贪心失败的构造条件很严：
#   ① 高权格（靠山格）必须**互不相邻**，且每格只挨 1 座山
#   ② 存在一个**紧凑连通块**，块外围留空不与高权格连通
#   ③ **预算 k ≥ 4** —— 紧凑 k 块的内部相邻对数 E(k) = 0/1/3/5/7…，
#      而 k 个孤立靠山格贡献 k。k=3 时 3=3 打平，k≥4 才有 E(k) > k。
#      **这意味着母题 B 在预算 ≤3 时数学上不可能成立。**
def cluster_board(n_iso, blob):
    T = {}
    for p in blob:
        T[p] = tile()
    for p in [(2, 0), (2, -1), (-1, 0), (-1, 1), (0, -1), (1, 1), (-1, 2), (2, -2)]:
        T.setdefault(p, tile())
    for i in range(n_iso):                    # 间隔 3，保证各只挨 1 座山且彼此不相邻
        q = 5 + 3 * i
        T[(q, 0)] = tile(); T[(q + 1, 0)] = tile(MTN)
    return Board(T)


verdict("母题 B 集群中心（预算 4）", cluster_board(4, [(0, 0), (1, 0), (0, 1), (1, -1)]),
        [CAMPUS], 4, "科技", note="紧凑 4 块内部 5 对相邻 → 5；4 个孤立靠山格 → 4")
verdict("母题 B 集群中心（预算 3，对照）", cluster_board(3, [(0, 0), (1, 0), (0, 1)]),
        [CAMPUS], 3, "科技", note="预期打平，验证 k≥4 这条门槛")
verdict("母题 B 集群中心（预算 5）",
        cluster_board(5, [(0, 0), (1, 0), (0, 1), (1, -1), (-1, 1)]),
        [CAMPUS], 5, "科技", note="差距随预算扩大")


# ── 母题 C · 投资型放置 ─────────────────────────────────────────────
# 政府广场自身零科技，但给每个相邻区域 +1 科技（主要档）。
# 关键：投资的回报必须**需要多步才能兑现**，同时要有足够的孤立诱饵吸走贪心的预算。
# 若诱饵太肥或回报一步就可见，贪心会自己找到投资（见 §7.4 的量化判据）。
C = {}
for p in [(0, 0), (1, 0), (0, 1), (-1, 1)]:          # 轮毂 + 三根辐条
    C[p] = tile()
for i in range(4):                                    # 4 个孤立靠山诱饵，各 +1
    q = 5 + 3 * i
    C[(q, 0)] = tile(); C[(q + 1, 0)] = tile(MTN)
verdict("母题 C 投资型放置（预算 4）", Board(C), [CAMPUS, GOV], 4, "科技",
        note="最优＝2 个政府广场 + 2 个学院互相加成；贪心把预算全花在孤立诱饵上")


# ── 母题 E · 文明特化（同盘换文明）────────────────────────────────
E = {}
for q, r in [(0, 0), (1, 0), (0, 1), (-1, 0), (0, -1), (1, -1), (-1, 1), (2, -1)]:
    E[(q, r)] = tile()
E[(2, -1)] = tile(MTN)
print("\n" + "=" * 68)
print("【母题 E 文明特化】同一盘面、同样 3 个区域预算，只换文明")
for civ, label in [(None, "常规文明（学院）"), ("CIVILIZATION_KOREA", "韩国（书院）"),
                   ("CIVILIZATION_GAUL", "高卢（被排除通用档）")]:
    v, plan, _ = exhaustive(Board(E), [CAMPUS], 3, "科技", civ)
    print("  %-22s 最优 = %-5s  布局 %s"
          % (label, fmt(v), [p for p, _ in plan]))
