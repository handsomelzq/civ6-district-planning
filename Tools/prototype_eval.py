#!/usr/bin/env python3
"""设计期原型求值器 —— 用于关卡设计与母题验证，**不是产品代码**。

为什么存在：`g` 的形态在 2026-09-24 实测定下后，关卡母题是否真能制造
「贪心失败」就可以用真实规则算出来了。这件事不该等技术栈定了再验——
母题不成立意味着 设计/关卡设计.md 要重写。

范围（刻意收窄）：
  - 只算**区域的相邻加成**。不算地块基础产出、建筑、每市民产出——
    关卡母题是纯粹关于相邻结构的，这些项对验证不构成影响。
  - 不做合法性校验（工作范围、配额、前置）。手写的实验盘自己保证合法。

它同时是一份**交叉校验参照实现**：产品求值器写出来后，两份独立实现
在同一批盘面上给出相同结果，是比单测更强的证据。

规则与算法出处：设计/SDD-局面求值器.md §3.3、§3.5。只用标准库。
"""
import csv, io, pathlib, sys
from collections import defaultdict
from fractions import Fraction

BASE = pathlib.Path(__file__).resolve().parent.parent / "配置表"

# 轴向坐标的六个邻居方向
DIRS = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]


def load(name):
    with io.open(str(BASE / name), encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


class Rules(object):
    def __init__(self):
        self.adj = defaultdict(list)          # 区域id -> [规则]
        for r in load("adjacency_rules.csv"):
            self.adj[r["区域id"]].append(r)
        self.districts = dict((r["区域id"], r) for r in load("districts.csv"))
        self.terrains = dict((r["地形id"], r) for r in load("terrains.csv"))
        self.features = dict((r["地貌id"], r) for r in load("features.csv"))
        # 文明 -> 特色区域替换：基础区域id -> 特色区域id
        self.replace = defaultdict(dict)
        for d, r in self.districts.items():
            if r["是否特色区域"] == "是" and r["所属文明id"] != "无":
                for c in r["所属文明id"].split("|"):
                    self.replace[c][r["替换区域id"]] = d
        # 文明/领袖 -> 被排除的规则原始标识
        self.excluded = defaultdict(set)
        try:
            for r in load("excluded_adjacencies.csv"):
                for col in ("所属文明id", "所属领袖id"):
                    if r[col] != "无":
                        for who in r[col].split("|"):
                            self.excluded[who].add(r["被排除规则标识"])
        except IOError:
            pass

    def name(self, did):
        return self.districts.get(did, {}).get("名称", did)


class Board(object):
    """手写实验盘。tiles: {(q,r): {"地形":..., "地貌":..., "区域":...}}"""

    def __init__(self, tiles):
        self.tiles = dict(tiles)

    def neighbors(self, q, r):
        for dq, dr in DIRS:
            t = self.tiles.get((q + dq, r + dr))
            if t is not None:
                yield t

    def copy_with(self, pos, district):
        t = dict(self.tiles)
        cell = dict(t[pos]); cell["区域"] = district; t[pos] = cell
        return Board(t)

    def empties(self, rules=None):
        """可放置区域的空格。地形可建性来自 terrains.是否可建区域。"""
        out = []
        for p, t in self.tiles.items():
            if t.get("区域"):
                continue
            if rules is not None:
                ter = rules.terrains.get(t.get("地形"), {})
                if ter.get("是否可建区域") == "否":
                    continue
            out.append(p)
        return out


def matches(rule, nb, subject_district):
    """这个邻格是否命中该规则的目标。目标类别语义见 SDD §3.4。"""
    cat, tid = rule["目标类别"], rule["目标id"]
    if cat == "地形":
        return nb.get("地形") == tid
    if cat == "地貌":
        return nb.get("地貌") == tid
    if cat == "区域":
        return nb.get("区域") == tid
    if cat == "任意其他区域":
        # 语义是「邻格上有区域」——"other" 指另一个**格子**，不是另一种类型。
        # 两个相邻的学院互相各给 +0.5，这是文明 6 的实际行为。
        # 同类型语义由独立的 Self 字段承担（见 SDD §3.4）。
        return bool(nb.get("区域"))
    if cat == "自身":
        return False          # 区域不可能与自己相邻；固定值另行处理
    if cat in ("河流", "海洋资源", "世界奇观", "自然奇观",
               "任意资源", "资源类别", "改良设施", "无目标"):
        return False          # 实验盘不构造这些目标
    raise ValueError("未知目标类别：%s" % cat)


def eval_district(rules, board, pos, civ=None, leader=None):
    """返回 (总产出 dict, 明细 list)。产出值是 Fraction，不取整（SDD §3.3）。"""
    did = board.tiles[pos].get("区域")
    if not did:
        return {}, []
    excl = rules.excluded.get(civ, set()) | rules.excluded.get(leader, set())
    nbs = list(board.neighbors(*pos))
    total, detail = defaultdict(Fraction), []
    for rule in rules.adj.get(did, []):
        if rule["原始标识"] in excl:
            continue
        need = int(rule["所需数量"]); val = Fraction(rule["加成值"])
        if rule["目标类别"] == "自身":
            inc, cnt = val, 1                     # 固定值（书院 +4）
        else:
            cnt = sum(1 for nb in nbs if matches(rule, nb, did))
            inc = Fraction(cnt) * val / need      # ← g，全程不取整
        if cnt == 0:
            continue
        total[rule["产出类型"]] += inc
        detail.append((rule["产出类型"], inc, cnt, rule["原始标识"]))
    return dict(total), detail


def eval_board(rules, board, civ=None, leader=None):
    total, per = defaultdict(Fraction), {}
    for pos, t in board.tiles.items():
        if t.get("区域"):
            y, d = eval_district(rules, board, pos, civ, leader)
            per[pos] = (y, d)
            for k, v in y.items():
                total[k] += v
    return dict(total), per


def effective(rules, did, civ):
    """应用文明的特色区域替换（SDD §3.5 第 1 步）。"""
    return rules.replace.get(civ, {}).get(did, did)


def greedy(rules, board, palette, budget, yield_type, civ=None, leader=None):
    """贪心基线，定义见 设计/关卡设计.md §7。

    增益 = 放置后**全局**目标产出 − 放置前，含对已有邻居的回溯加成。
    平局按 (增益, 全产出和, 区域id, 坐标) 固定顺序打破，保证可复现。
    """
    cur, steps = board, []
    for _ in range(budget):
        base = eval_board(rules, cur, civ, leader)[0].get(yield_type, Fraction(0))
        best = None
        for pos in sorted(cur.empties(rules)):
            for d0 in palette:
                d = effective(rules, d0, civ)
                nxt = cur.copy_with(pos, d)
                tot = eval_board(rules, nxt, civ, leader)[0]
                gain = tot.get(yield_type, Fraction(0)) - base
                key = (gain, sum(tot.values()), d, pos)
                if best is None or key > best[0]:
                    best = (key, pos, d, nxt)
        if best is None or best[0][0] <= 0:
            break
        steps.append((best[1], best[2], best[0][0]))
        cur = best[3]
    return cur, steps


def show(rules, board, title, yield_type, civ=None, leader=None):
    tot, per = eval_board(rules, board, civ, leader)
    print("  %s：%s = %s" % (title, yield_type,
                             fmt(tot.get(yield_type, Fraction(0)))))
    for pos in sorted(per):
        y, d = per[pos]
        if not d:
            continue
        print("    %-9s %-6s %s" % (pos, rules.name(board.tiles[pos]["区域"]),
                                    fmt(y.get(yield_type, Fraction(0)))))
        for yt, inc, cnt, rid in sorted(d):
            if yt == yield_type:
                print("        %-28s ×%d  %s" % (rid, cnt, fmt(inc)))
    return tot.get(yield_type, Fraction(0))


def fmt(f):
    f = Fraction(f)
    return str(f.numerator // f.denominator) if f.denominator == 1 else "%.1f" % float(f)


if __name__ == "__main__":
    print("这是一个库 + 实验脚本的载体。母题验证见 Tools/motif_check.py")
