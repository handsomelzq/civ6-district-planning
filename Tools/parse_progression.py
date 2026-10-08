#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从已安装的《文明 VI》最终数据快照生成科技树、文化树和精选政策卡。

这不是第二套 XML 解析器：行级重放、DLC 顺序、本地化文本全部复用
parse_civ6_xml.py。输出给网页使用的只是一个窄表，保留游戏原始 id 以便回溯。
"""
import argparse
import csv
import importlib.util
import pathlib
import sys
from collections import defaultdict


ROOT = pathlib.Path(__file__).resolve().parent.parent
PARSER_PATH = pathlib.Path(__file__).with_name("parse_civ6_xml.py")


POLICY_FOCUS = {
    "POLICY_URBAN_PLANNING": "城市生产",
    "POLICY_NATURAL_PHILOSOPHY": "学院相邻",
    "POLICY_SCRIPTURE": "圣地相邻",
    "POLICY_AESTHETICS": "剧院广场相邻",
    "POLICY_CRAFTSMEN": "工业区相邻",
    "POLICY_RATIONALISM": "学院建筑",
    "POLICY_SIMULTANEUM": "圣地建筑",
    "POLICY_MERITOCRACY": "专业化区域",
    "POLICY_MEDINA_QUARTER": "城市容量",
    "POLICY_PUBLIC_WORKS": "建造者",
}

# 只收录当前静态局面能完整结算的信条。效果值来自 BeliefModifiers →
# Modifiers → ModifierArguments；这里将游戏的通用 Modifier 图压成求值器可读的窄表。
RELIGION_EFFECTS = {
    "BELIEF_DANCE_OF_THE_AURORA": (
        "圣地地形相邻:TERRAIN_TUNDRA:信仰:1|"
        "圣地地形相邻:TERRAIN_TUNDRA_HILLS:信仰:1"),
    "BELIEF_DESERT_FOLKLORE": (
        "圣地地形相邻:TERRAIN_DESERT:信仰:1|"
        "圣地地形相邻:TERRAIN_DESERT_HILLS:信仰:1"),
    "BELIEF_SACRED_PATH": "圣地地貌相邻:FEATURE_JUNGLE:信仰:1",
    "BELIEF_WORK_ETHIC": "圣地相邻镜像:信仰:生产力:1",
    "BELIEF_LAY_MINISTRY": (
        "区域固定:DISTRICT_HOLY_SITE:信仰:1|"
        "区域固定:DISTRICT_THEATER:文化:1"),
    "BELIEF_DIVINE_INSPIRATION": "奇观固定:无:信仰:4",
    "BELIEF_CHORAL_MUSIC": (
        "建筑固定:BUILDING_SHRINE:文化:2|"
        "建筑固定:BUILDING_TEMPLE:文化:4"),
    "BELIEF_FEED_THE_WORLD": (
        "建筑固定:BUILDING_SHRINE:粮食:3|"
        "建筑固定:BUILDING_TEMPLE:粮食:3"),
}

SLOT_ZH = {
    "SLOT_ECONOMIC": "经济",
    "SLOT_MILITARY": "军事",
    "SLOT_DIPLOMATIC": "外交",
    "SLOT_GREAT_PERSON": "伟人",
    "SLOT_WILDCARD": "万能",
}


def load_parser():
    spec = importlib.util.spec_from_file_location("civ6_parser", PARSER_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    extra = [
        "TechnologyPrereqs", "CivicPrereqs", "Policies", "Beliefs", "BeliefClasses",
    ]
    for table in extra:
        if table not in mod.NEEDED_TABLES:
            mod.NEEDED_TABLES.append(table)
    return mod


def csv_write(path, header, rows):
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)


def none(value, mod):
    return mod.or_none(value)


def prereq_map(rows, item_col, prereq_col):
    out = defaultdict(list)
    for row in rows:
        item, prereq = row.get(item_col, ""), row.get(prereq_col, "")
        if item and prereq:
            out[item].append(prereq)
    return out


def reverse_unlocks(db, loc, item_col, prereq_col, item_names, prefix):
    out = defaultdict(list)
    for row in db.rows("Districts"):
        value = row.get(prereq_col, "")
        if value in item_names:
            out[value].append("区域：" + loc(row.get("Name")))
    for row in db.rows("Buildings"):
        value = row.get(prereq_col, "")
        if value in item_names:
            out[value].append("建筑：" + loc(row.get("Name")))
    if item_col == "CivicType":
        for row in db.rows("Policies"):
            value = row.get(prereq_col, "")
            if value in item_names:
                out[value].append("政策卡：" + loc(row.get("Name")))
    return out


def build_techs(db, loc, mod):
    rows = db.rows("Technologies")
    names = {r["TechnologyType"]: loc(r.get("Name")) for r in rows}
    ids = set(names)
    prereqs = prereq_map(db.rows("TechnologyPrereqs"), "Technology", "PrereqTech")
    unlocks = reverse_unlocks(db, loc, "TechnologyType", "PrereqTech", ids, "科技")
    header = ["科技id", "名称", "时代", "成本", "前置科技", "功能说明",
              "解锁内容", "区域规划相关", "数据来源", "待核"]
    out = []
    for row in sorted(rows, key=lambda r: r["TechnologyType"]):
        tid = row["TechnologyType"]
        unlock = sorted(set(unlocks.get(tid, [])))
        desc = loc(row.get("Description"), "")
        function = desc if desc else ("；".join(unlock) if unlock else "无额外功能说明")
        focus = bool(unlock)
        out.append([
            tid, names[tid], none(row.get("EraType"), mod), row.get("Cost", "无"),
            mod.joiner(sorted(set(prereqs.get(tid, [])))) or "无",
            function, mod.joiner(unlock) or "无", "是" if focus else "否",
            "一手", "否",
        ])
    return header, out


def build_civics(db, loc, mod):
    rows = db.rows("Civics")
    names = {r["CivicType"]: loc(r.get("Name")) for r in rows}
    ids = set(names)
    prereqs = prereq_map(db.rows("CivicPrereqs"), "Civic", "PrereqCivic")
    unlocks = reverse_unlocks(db, loc, "CivicType", "PrereqCivic", ids, "市政")
    header = ["市政id", "名称", "时代", "成本", "前置市政", "功能说明",
              "解锁内容", "区域规划相关", "数据来源", "待核"]
    out = []
    for row in sorted(rows, key=lambda r: r["CivicType"]):
        cid = row["CivicType"]
        unlock = sorted(set(unlocks.get(cid, [])))
        desc = loc(row.get("Description"), "")
        function = desc if desc else ("；".join(unlock) if unlock else "无额外功能说明")
        focus = bool(unlock) or cid in {
            r.get("PrereqCivic") for r in db.rows("Policies")
            if r.get("PolicyType") in POLICY_FOCUS
        }
        out.append([
            cid, names[cid], none(row.get("EraType"), mod), row.get("Cost", "无"),
            mod.joiner(sorted(set(prereqs.get(cid, [])))) or "无",
            function, mod.joiner(unlock) or "无", "是" if focus else "否",
            "一手", "否",
        ])
    return header, out


def build_policies(db, loc):
    header = ["政策卡id", "名称", "政策槽位", "前置市政", "功能说明",
              "规划标签", "数据来源", "待核"]
    out = []
    for row in db.rows("Policies"):
        pid = row["PolicyType"]
        if pid not in POLICY_FOCUS:
            continue
        out.append([
            pid, loc(row.get("Name")), SLOT_ZH.get(row.get("GovernmentSlotType"),
                                                    row.get("GovernmentSlotType", "无")),
            row.get("PrereqCivic") or "无", loc(row.get("Description")),
            POLICY_FOCUS[pid], "一手", "否",
        ])
    out.sort(key=lambda x: (x[2], x[0]))
    return header, out


def build_religion_beliefs(db, loc):
    """生成区域规划信条窄表；不表达宗教传播、城市归属或宗教胜利。"""
    classes = {r["BeliefClassType"]: loc(r.get("Name"))
               for r in db.rows("BeliefClasses")}
    beliefs = {r["BeliefType"]: r for r in db.rows("Beliefs")}
    header = ["信条id", "名称", "信条类别", "功能说明", "结构化效果",
              "数据来源", "待核"]
    out = []
    missing = sorted(set(RELIGION_EFFECTS) - set(beliefs))
    if missing:
        raise RuntimeError("最终游戏数据缺少精选信条：" + ", ".join(missing))
    for bid in sorted(RELIGION_EFFECTS):
        row = beliefs[bid]
        out.append([
            bid, loc(row.get("Name")),
            classes.get(row.get("BeliefClassType"), row.get("BeliefClassType", "无")),
            loc(row.get("Description")), RELIGION_EFFECTS[bid],
            "一手（Beliefs/BeliefModifiers/ModifierArguments）", "否",
        ])
    return header, out


def main(argv=None):
    parser = load_parser()
    ap = argparse.ArgumentParser(description="生成文明 VI 科技树、文化树、精选政策卡和宗教信条")
    ap.add_argument("--assets", default=parser.DEFAULT_ASSETS)
    ap.add_argument("--out", default=str(ROOT / "配置表"))
    args = ap.parse_args(argv)
    assets = pathlib.Path(args.assets).expanduser()
    if not assets.is_dir():
        raise SystemExit("Assets 目录不存在：" + str(assets))
    schema = parser.load_schema(assets / "Base/Assets/Gameplay/Data/Schema/01_GameplaySchema.sql")
    data_files, text_files = parser.plan_files(assets, False)
    db = parser.DB(schema)
    for label, path in data_files:
        db.apply_file(label, path)
    loc = parser.Loc()
    for label, path in text_files:
        loc.load(label, path)
    out = pathlib.Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    h, rows = build_techs(db, loc, parser)
    csv_write(out / "tech_tree.csv", h, rows)
    h, rows = build_civics(db, loc, parser)
    csv_write(out / "civic_tree.csv", h, rows)
    h, rows = build_policies(db, loc)
    csv_write(out / "policy_cards.csv", h, rows)
    h, rows = build_religion_beliefs(db, loc)
    csv_write(out / "religion_beliefs.csv", h, rows)
    print("tech_tree.csv %d 行｜civic_tree.csv %d 行｜policy_cards.csv %d 行｜religion_beliefs.csv %d 行" %
          (len(build_techs(db, loc, parser)[1]),
           len(build_civics(db, loc, parser)[1]),
           len(build_policies(db, loc)[1]),
           len(build_religion_beliefs(db, loc)[1])))


if __name__ == "__main__":
    main(sys.argv[1:])
