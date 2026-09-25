#!/usr/bin/env python3
"""生成交叉校验用的 oracle：随机盘面 + **Python 原型求值器**算出的产出。

跑：python3 Tools/gen_oracle.py          # 写 tests/fixtures/oracle.json

为什么要这个：`设计/SDD-局面求值器.md` 把原型定位成「交叉校验参照实现」——
两份独立实现在同一批盘面上给出相同结果，是比单测更强的证据。产品求值器（TS）
写完后就拿这份 oracle 对账。

**覆盖范围是刻意收窄的**：只生成地形 / 地貌 / 区域三类属性，因为原型只建模这三类
（`prototype_eval.matches` 对河流、奇观、资源等一律返回 False）。这批就覆盖了
`地形 / 地貌 / 区域 / 任意其他区域 / 自身` 五个目标类别，也就是全部 10 关用到的
规则。剩下 8 个类别由 TS 侧的定向单测覆盖，期望值从规则行直接推出 ——
**不为了凑覆盖率去扩原型**，那会让参照实现变成第二个待测对象。

种子固定，输出可复现：删掉 json 重跑，内容逐字节一致。
"""
import io, json, pathlib, random, sys
from fractions import Fraction

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from prototype_eval import Rules, Board, eval_board, effective, fmt

R = Rules()
OUT = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "oracle.json"

FLAT = "TERRAIN_GRASS"
TERRAINS = [FLAT, "TERRAIN_PLAINS", "TERRAIN_GRASS_MOUNTAIN",
            "TERRAIN_PLAINS_MOUNTAIN", "TERRAIN_OCEAN", "TERRAIN_COAST"]
FEATURES = [None, "FEATURE_FOREST", "FEATURE_JUNGLE", "FEATURE_MARSH"]
# 刻意混入特色区域与市政广场：前者考替换解析，后者是全表唯一的「投资型」对象
DISTRICTS = [None, None, None, "DISTRICT_CAMPUS", "DISTRICT_HOLY_SITE",
             "DISTRICT_GOVERNMENT", "DISTRICT_CITY_CENTER",
             "DISTRICT_COMMERCIAL_HUB", "DISTRICT_THEATER", "DISTRICT_INDUSTRIAL_ZONE"]
CIVS = [None, "CIVILIZATION_KOREA", "CIVILIZATION_GERMANY", "CIVILIZATION_GAUL",
        "CIVILIZATION_GREECE", "CIVILIZATION_VIETNAM"]
YIELDS = ["科技", "文化", "金币", "生产力", "信仰", "粮食"]


def disc(rad):
    return [(q, r) for q in range(-rad, rad + 1) for r in range(-rad, rad + 1)
            if max(abs(q), abs(r), abs(q + r)) <= rad]


def make_case(rng, rad):
    """随机盘面。区域按**基础 id** 记录，替换留给求值时解析。"""
    civ = rng.choice(CIVS)
    tiles = {}
    for p in disc(rad):
        t = {"地形": rng.choice(TERRAINS), "地貌": rng.choice(FEATURES),
             "区域": rng.choice(DISTRICTS)}
        # 山脉与深海不可建区域；建了区域的格子地貌被移除
        if t["区域"] and (t["地形"] in ("TERRAIN_GRASS_MOUNTAIN",
                                       "TERRAIN_PLAINS_MOUNTAIN", "TERRAIN_OCEAN")):
            t["区域"] = None
        if t["区域"] and t["地貌"] in ("FEATURE_FOREST", "FEATURE_JUNGLE", "FEATURE_MARSH"):
            t["地貌"] = None
        tiles[p] = t
    return civ, tiles


def evaluate_with_prototype(civ, tiles):
    """原型的 Board 里存的是**已应用替换**的 id，所以这里现场解析一次。"""
    b = {}
    for p, t in tiles.items():
        b[p] = {"地形": t["地形"], "地貌": t["地貌"],
                "区域": effective(R, t["区域"], civ) if t["区域"] else None}
    tot, _ = eval_board(R, Board(b), civ)
    return dict((y, tot.get(y, Fraction(0))) for y in YIELDS)


def main():
    rng = random.Random(20260925)          # 固定种子 → 输出可复现
    cases = []
    for i in range(60):
        rad = 1 + (i % 3)                  # 半径 1/2/3 轮转（7 / 19 / 37 格）
        civ, tiles = make_case(rng, rad)
        totals = evaluate_with_prototype(civ, tiles)
        cases.append({
            "id": "case-%02d" % i,
            "半径": rad,
            "文明": civ,
            "tiles": dict(
                ("%d,%d" % p,
                 dict((k, v) for k, v in t.items() if v is not None))
                for p, t in sorted(tiles.items())),
            "期望产出": dict((y, fmt(v)) for y, v in totals.items()
                             if v != 0),
        })
    doc = {
        "说明": "由 Tools/gen_oracle.py 用 Python 原型求值器生成，勿手改。"
                "覆盖 地形/地貌/区域/任意其他区域/自身 五个目标类别。",
        "生成脚本": "Tools/gen_oracle.py",
        "种子": 20260925,
        "用例数": len(cases),
        "cases": cases,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with io.open(str(OUT), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1, sort_keys=False)
        fh.write("\n")
    nonzero = sum(1 for c in cases if c["期望产出"])
    print("写出 %s：%d 个用例，其中 %d 个有非零产出" % (OUT.name, len(cases), nonzero))
    print("涉及文明：%s" % ", ".join(sorted(set(str(c["文明"]) for c in cases))))


if __name__ == "__main__":
    main()
