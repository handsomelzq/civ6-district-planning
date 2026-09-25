#!/usr/bin/env python3
"""关卡设计工具：为每关算最优前沿与贪心基线，据此定目标值与星级阈值，
并生成 配置表/levels.csv 与 配置表/level_tiles.csv。

跑：python3 Tools/design_levels.py

为什么要工具：目标值与星级阈值**必须从数据推出来**（关卡设计.md §5.2），
手拍的阈值没法保证「贪心必须失败」和「三星需要优于人工首解」。

只用标准库。地图规模：半径 3 的六边形 37 格（关卡设计.md §4）。
"""
import csv, io, itertools, pathlib, sys
from fractions import Fraction
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from prototype_eval import Rules, Board, eval_board, greedy, effective, fmt

R = Rules()
OUT = pathlib.Path(__file__).resolve().parent.parent / "配置表"

FLAT, MTN, MTN2 = "TERRAIN_GRASS", "TERRAIN_GRASS_MOUNTAIN", "TERRAIN_PLAINS_MOUNTAIN"
OCEAN = "TERRAIN_OCEAN"   # 海洋，是否可建区域=否；海岸(TERRAIN_COAST)在文明 6 里可建，不能当填充用
FOREST, JUNGLE = "FEATURE_FOREST", "FEATURE_JUNGLE"
CAMPUS, GOV, CENTER = "DISTRICT_CAMPUS", "DISTRICT_GOVERNMENT", "DISTRICT_CITY_CENTER"


def ring3():
    """半径 3 的轴向坐标全集（37 格）。"""
    out = []
    for q in range(-3, 4):
        for r in range(-3, 4):
            if max(abs(q), abs(r), abs(q + r)) <= 3:
                out.append((q, r))
    return out


def make(center, mountains=(), forests=(), water=(), districts=(), land=None):
    """默认草原；指定处放山脉/森林/水域；districts 是 (坐标, 区域id)。

    land 若给出，则**只有列出的格子是陆地**，其余全为海岸（不可建）。
    这是隔离「诱饵」与「协同块」的手段——见 设计/关卡设计.md §2.0.1：
    两者若连通，贪心会顺着连通区把协同块自己填满。
    """
    t = {}
    for p in ring3():
        t[p] = {"地形": FLAT, "地貌": None, "区域": None}
    if land is not None:
        keep = set(land) | set(mountains) | {center}
        for p in ring3():
            if p not in keep:
                t[p]["地形"] = OCEAN
    for p in mountains:
        t[p]["地形"] = MTN
    for p in water:
        t[p]["地形"] = OCEAN
    for p in forests:
        t[p]["地貌"] = FOREST
    t[center]["区域"] = CENTER
    for p, d in districts:
        t[p]["区域"] = d
    return Board(t)


def frontier(board, palette, maxk, civ=None):
    """最优前沿：{预算 k: 该预算下的最优目标产出}，以及各自的布局。"""
    empties = sorted(board.empties(R))
    best = {}
    for k in range(1, maxk + 1):
        bv, bp = Fraction(-1), None
        for spots in itertools.combinations(empties, k):
            for combo in itertools.product(palette, repeat=k):
                b = board
                for p, d0 in zip(spots, combo):
                    b = b.copy_with(p, effective(R, d0, civ))
                v = eval_board(R, b, civ)[0].get(YT, Fraction(0))
                if v > bv:
                    bv, bp = v, list(zip(spots, combo))
        best[k] = (bv, bp)
    return best


def render(board):
    """把盘面画成可眼检的 ASCII 图。"""
    rows = []
    for r in range(-3, 4):
        cells = []
        for q in range(-3, 4):
            if max(abs(q), abs(r), abs(q + r)) > 3:
                cells.append("  ")
                continue
            t = board.tiles[(q, r)]
            if t["区域"] == CENTER:
                c = "◎"
            elif t["区域"]:
                c = "■"
            elif t["地形"] == MTN:
                c = "▲"
            elif t["地形"] == OCEAN:
                c = "~"
            elif t["地貌"] == FOREST:
                c = "♣"
            else:
                c = "·"
            cells.append(c + " ")
        rows.append(" " * (r + 3) + "".join(cells))
    return "\n".join("    " + x for x in rows)


YT = "科技"
LEVELS = []


def level(lid, name, board, palette, budget, kind, motif, note, civ="CIVILIZATION_GERMANY",
          leader="LEADER_BARBAROSSA"):
    """kind ∈ {普通, 教学, 对照}，语义见 设计/关卡设计.md §1.1 / §1.2。"""
    assert kind in ("普通", "教学", "对照"), kind
    g_board, steps = greedy(R, board, palette, budget, YT, civ)
    G = eval_board(R, g_board, civ)[0].get(YT, Fraction(0))
    fr = frontier(board, palette, budget, civ)
    V = fr[budget][0]
    # 目标值：落在贪心与最优之间，靠最优一侧；取半整数网格上的一格
    # 目标值＝贪心基线 + 一个最小步长（0.5）。
    #   2026-09-25 改：原先取 G 与 V 之间偏最优的一侧，但评级改为按产出值之后
    #   逻辑反转了 —— 通关门槛应当贴近贪心（低门槛人人能过），挑战交给星级阈值。
    #   把 T 压到最低，也把 V−T 这段空间全部留给三档星级。
    T = (G + Fraction(1, 2)) if V > G else V            # V==G 时是教学关/对照关
    # 星级阈值＝**产出值**（2026-09-25 改；原先按剩余预算，见 关卡设计.md §8）
    #   三星 = 设计期穷举出的最优值 V（运行时只比数字，不需要求解器）
    #   二星 = T 与 V 的中点，对齐到 0.5，且必须严格大于 T
    #   产出粒度是 0.5，所以 V − T < 1 的紧关卡放不下三档，二星退化为等于三星
    star3 = V
    mid = Fraction(int((T + (V - T) / 2) * 2 + Fraction(1, 2)), 2)
    star2 = mid if T < mid < V else V
    need = next((k for k in range(1, budget + 1) if fr[k][0] >= T), budget)
    tiers = 3 if star2 < star3 else 2
    LEVELS.append(dict(lid=lid, name=name, board=board, budget=budget, T=T, G=G, V=V,
                       fr=fr, need=need, star3=star3, star2=star2, tiers=tiers,
                       kind=kind, palette=palette,
                       motif=motif, note=note, civ=civ, leader=leader, steps=steps))
    print("\n" + "=" * 70)
    print("%s 「%s」　预算 %d　母题 %s　类别 %s　文明 %s"
          % (lid, name, budget, motif, kind, civ.replace("CIVILIZATION_", "")))
    print(render(board))
    print("    图例  ◎城市中心  ▲山脉  ♣森林  ~海洋  ·平地")
    print("    %s" % note)
    print("    贪心基线 = %s   最优(预算%d) = %s   目标值 = %s"
          % (fmt(G), budget, fmt(V), fmt(T)))
    print("    最优前沿 " + "  ".join("k=%d:%s" % (k, fmt(v)) for k, (v, _) in sorted(fr.items())))
    print("    星级阈值（产出值）：一星 %s（＝目标）  二星 %s  三星 %s（＝最优）%s"
          % (fmt(T), fmt(star2), fmt(star3),
             "" if tiers == 3 else "　⚠️ V−T<1，只有两档"))
    print("    达标最少 %d 步（约束值 %d）" % (need, budget))
    if kind == "普通":
        print("    %s" % ("✅ 贪心失败，关卡成立" if G < T else "❌ 贪心达标，关卡不合格"))
    elif kind == "教学":
        print("    教学关：贪心可达标（关卡设计.md §1.1 的例外）")
    else:
        print("    对照关：判据是交叉代入劣化，不要求贪心失败（关卡设计.md §1.2）")


# ══════════════════════════════════════════════════════════════════════
# 六关设计。外环（半径 3）一律设为海岸以压缩可建格，这既让搜索可穷举，
# 也让地图更像一座真实的沿海城市而不是一张空棋盘。
OUTER = [p for p in ring3() if max(abs(p[0]), abs(p[1]), abs(p[0] + p[1])) == 3]

# ── L-01 教学 · 主要档相邻（山脉每座 +1）──────────────────────────
level("L-01", "读山", make((0, 0), mountains=[(2, 0), (2, -1), (-2, 0), (-2, 1)],
                           water=OUTER),
      [CAMPUS], 2, "教学", "无",
      "两侧各有一对山脉。目标：学会「每座山 +1」是主要档，挨得越多越好。")

# ── L-02 教学 · 标准档相邻（区域之间每 2 个 +1）────────────────────
level("L-02", "抱团", make((0, 0), water=OUTER),
      [CAMPUS], 3, "教学", "无",
      "全图无山无林。唯一的科技来源是区域互给的标准档加成——放两个比放一个的两倍更多。")

# ── L-03 教学 · 政府广场（自身零产出，给每个邻居 +1）───────────────
level("L-03", "枢纽", make((0, 0), water=OUTER),
      [CAMPUS, GOV], 3, "教学", "无",
      "政府广场自己不产科技，但给每个相邻区域 +1。学会「有的区域价值在别人身上」。")

# ── L-04 母题 A · 争格 ── **故意保留的反向回归用例** ────────────────
# 母题 A 已删除（关卡设计.md §2.2）：它只能靠贪心的平局打破来"通过"。
# 这张盘面**留在脚本里**是有用的 —— 它在强基线（平局取最优）下必须不合格。
# 若哪天有人把 greedy(best_ties=False) 改回去，这一关会重新"通过"并入表，
# 从而暴露基线被削弱。它不入配置表（emit() 会跳过并列名）。
level("L-04", "一格双优",
      make((0, 0),
           mountains=[(2, 0), (2, -1), (3, -2), (3, 0), (-3, 2), (-3, 0)],
           land=[(1, 0), (3, -1), (-3, 1)]),
      [CAMPUS], 2, "普通", "A",
      "(1,0) 挨 2 山又挨城市中心；两个诱饵各挨 2 山但孤立。贪心去吃两个诱饵，最优必须占住 (1,0)。")

# ── L-05 母题 B · 集群中心（预算 4；低于 4 数学上不成立）────────────
# 协同块＝城市中心周围 4 格互相相邻；诱饵＝4 个隔海的靠山孤格，各 +1。
level("L-05", "组团",
      make((0, 0),
           mountains=[(3, -1), (0, 3), (-3, 1), (0, -3)],
           land=[(1, 0), (1, -1), (0, 1), (-1, 1),          # 协同块
                 (3, 0), (1, 2), (-3, 2), (1, -3)]),        # 诱饵（各挨 1 山）
      [CAMPUS], 4, "普通", "B",
      "4 个隔海孤格各挨 1 山（+1）；中心周围 4 格互相相邻。诱饵数=预算，贪心会全花在诱饵上。")

# ── L-06 母题 C · 投资型放置 ──────────────────────────────────────
# 2026-09-25 重做。第一版在这张 37 格地图上贪心达标，我当时归因为「半径 3 对母题 C
# 偏紧」——**这个归因是错的**。用几何搜索穷举「4 个互不相邻的诱饵 + 一个远离中心的
# 菱形协同块」的所有摆法，合格方案有 140612 个；真正的原因是第一版协同块的形状不对
# （5 格链状，内部相邻对不够，而且挨着诱饵）。
#
# 协同块＝菱形 4 格 {(2,0),(3,0),(3,-1),(2,1)}：内部 5 对相邻，缺的那条边正好是
# 两个政府广场之间（它们互不需要相邻）。最优＝两学院占 (2,0)(3,0)，两政府广场占
# (2,1)(3,-1)，两个学院各自「2 座政府广场 +2」「3 个相邻区域 +1.5」= 3.5，合计 7。
COMBO_CLUSTER = [(2, 0), (3, 0), (3, -1), (2, 1)]
COMBO_BAITS = [(-3, 0), (-3, 3), (0, -3), (0, 2)]
COMBO_MTN = [(-2, 0), (-2, 3), (0, -2), (0, 3)]

level("L-06", "先修路",
      make((0, 0), mountains=COMBO_MTN, land=COMBO_CLUSTER + COMBO_BAITS),
      [CAMPUS, GOV], 4, "普通", "C",
      "协同块远离城市中心与山脉，单独放一个区域进去一分不得。最优＝两座政府广场夹两座学院。")

# ── L-08 / L-09 母题 E · 同一片地形，只换文明 ────────────────────────
# 这一对是 GDD §6 验证指标「文明有差异」的实测关卡，所以**地形必须逐格相同**
# （check_config 规则 18 会校验这一点）。
#
# 协同块扩到紧凑 5 格（内部 7 对相邻，是 5 格的上限），预算 5，诱饵 5 个。
# 德国在这一关等价于常规文明：汉萨替换的是工业区、只影响生产力，与科技无关。
E_CLUSTER = [(2, 0), (3, 0), (3, -1), (2, 1), (2, -1)]
E_BAITS = [(-3, 0), (-3, 3), (0, -3), (0, 2), (3, -3)]
E_MTN = [(-2, 0), (-2, 3), (0, -2), (0, 3), (2, -3)]


def e_board():
    return make((0, 0), mountains=E_MTN, land=E_CLUSTER + E_BAITS)


level("L-08", "成团",
      e_board(), [CAMPUS, GOV], 5, "普通", "E",
      "常规文明版。学院要抱团、要贴山：最优是把 5 个预算全砸进东边那块协同块。")

level("L-09", "各自为政",
      e_board(), [CAMPUS, GOV], 5, "对照", "E",
      "与 L-08 同一片地形，换韩国。书院固定 +4 但每相邻一区域 −1，且完全不吃山脉——"
      "最优解从「抱团」反转为「尽量分开」。",
      civ="CIVILIZATION_KOREA", leader="LEADER_SEONDEOK")


# ══════════════════════════════════════════════════════════════════════
def terrain_key(board):
    """盘面的地形指纹（只含地形/地貌，不含区域）。对照关必须同地形。"""
    return tuple(sorted((p, t["地形"], t["地貌"]) for p, t in board.tiles.items()))


def apply_plan(board, plan, civ):
    b = board
    for p, d0 in plan:
        b = b.copy_with(p, effective(R, d0, civ))
    return eval_board(R, b, civ)[0].get(YT, Fraction(0))


def cross_check():
    """对照关的判据：交叉代入劣化（关卡设计.md §1.2）。

    把 A 文明的最优布局照搬给 B 文明，B 的得分必须显著低于 B 自己的最优；
    反向亦然。两边都劣化，才说明「最优布局的结构真的随文明改变」，
    而不只是数值高低不同。
    """
    ok = True
    for L in LEVELS:
        if L["kind"] != "对照":
            continue
        twins = [O for O in LEVELS
                 if O is not L and terrain_key(O["board"]) == terrain_key(L["board"])]
        print("\n" + "=" * 70)
        if not twins:
            print("❌ %s 是对照关，但没有同地形的对照对象" % L["lid"])
            ok = False
            continue
        for O in twins:
            if O["civ"] == L["civ"]:
                print("❌ %s 与 %s 同地形但文明相同，对照不成立" % (L["lid"], O["lid"]))
                ok = False
                continue
            print("【交叉代入】%s（%s） ↔ %s（%s）　同地形，预算 %d"
                  % (O["lid"], O["civ"].replace("CIVILIZATION_", ""),
                     L["lid"], L["civ"].replace("CIVILIZATION_", ""), L["budget"]))
            for X, Y in ((O, L), (L, O)):
                plan = X["fr"][X["budget"]][1]
                cross = apply_plan(Y["board"], plan, Y["civ"])
                drop = (Y["V"] - cross) / Y["V"] if Y["V"] else Fraction(0)
                flag = "✅" if cross < Y["V"] else "❌"
                print("    %s 把 %s 的最优布局给 %s：%s（%s 自己的最优 %s，劣化 %.0f%%）"
                      % (flag, X["lid"], Y["civ"].replace("CIVILIZATION_", ""),
                         fmt(cross), Y["lid"], fmt(Y["V"]), 100.0 * float(drop)))
                if cross >= Y["V"]:
                    ok = False
            sa = {p for p, _ in O["fr"][O["budget"]][1]}
            sb = {p for p, _ in L["fr"][L["budget"]][1]}
            print("    两最优布局的格子交集：%s（越小越说明结构不同）"
                  % (sorted(sa & sb) or "空集"))
    return ok


# ══════════════════════════════════════════════════════════════════════
# 写表
def emit():
    lv_h = ["关卡id", "名称", "文明id", "领袖id", "已解锁科技", "已解锁市政",
            "城市中心坐标", "人口", "目标类型", "目标产出类型", "目标值",
            "约束类型", "约束值", "三星阈值", "二星阈值", "关卡类别", "母题",
            "贪心基线结果"]
    ti_h = ["关卡id", "坐标", "地形", "地貌", "资源", "自然奇观", "河流边",
            "初始区域", "初始建筑"]
    lv, ti = [], []
    skipped = []
    for L in LEVELS:
        # 不合格的关卡不入表。check_config 规则 14 也会拦（普通关的贪心基线
        # 必须严格小于目标值），这里提前挡掉，免得配置表进入已知非法状态。
        # 教学关与对照关豁免，各有自己的判据（关卡设计.md §1.1 / §1.2）。
        if L["kind"] == "普通" and L["G"] >= L["T"]:
            skipped.append("%s（%s，母题 %s）：贪心 %s ≥ 目标 %s"
                           % (L["lid"], L["name"], L["motif"], fmt(L["G"]), fmt(L["T"])))
            continue
        center = [p for p, t in L["board"].tiles.items() if t["区域"] == CENTER][0]
        lv.append([L["lid"], L["name"], L["civ"], L["leader"],
                   "TECH_WRITING", "无", "%d,%d" % center, 4,
                   "单一产出", YT, fmt(L["T"]), "区域数", L["budget"],
                   fmt(L["star3"]), fmt(L["star2"]), L["kind"],
                   L["motif"], fmt(L["G"])])
        for p in sorted(L["board"].tiles):
            t = L["board"].tiles[p]
            ti.append([L["lid"], "%d,%d" % p, t["地形"], t["地貌"] or "无",
                       "无", "无", "无", t["区域"] or "无", "无"])
    if skipped:
        print("\n⚠️ 以下关卡不合格，未写入配置表：")
        for x in skipped:
            print("   " + x)
    for name, head, rows in (("levels.csv", lv_h, lv), ("level_tiles.csv", ti_h, ti)):
        with io.open(str(OUT / name), "w", encoding="utf-8", newline="") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(head)
            for r in rows:
                w.writerow(r)
        print("\n写出 %s：%d 行" % (name, len(rows)))


if __name__ == "__main__":
    ok = cross_check()
    emit()
    if not ok:
        print("\n❌ 对照关的交叉代入判据未通过（关卡设计.md §1.2）")
        sys.exit(1)
