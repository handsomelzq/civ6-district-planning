#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把《文明 VI》游戏本体的 XML 数据解析成本项目的配置表 CSV。

只用标准库，系统 python3（3.9）可跑。用法：

    python3 Tools/parse_civ6_xml.py                     # 写入 配置表/
    python3 Tools/parse_civ6_xml.py --out /tmp/候选表    # 写别处
    python3 Tools/parse_civ6_xml.py --assets <Assets目录>
    python3 Tools/parse_civ6_xml.py --modes            # 额外载入可选游戏模式内容
    python3 Tools/parse_civ6_xml.py --dump-table Adjacency_YieldChanges --grep Campus
                                                       # 打印解析后的原始表，供人工对账

字段定义见 配置表/字段说明.md（唯一事实来源），目标类别映射见 设计/SDD-局面求值器.md §3.4。
本脚本只读游戏目录，不写入其中任何文件。

────────────────────────────────────────────────────────────────────────
一、游戏数据是「一串数据库操作」，不是一堆行
────────────────────────────────────────────────────────────────────────
玩法数据文件的根标签是 GameInfo，第二层是表名，第三层是五种行级操作：

    <Row .../>              插入一行（= SQL INSERT：主键已存在则本次插入失败，原行留下）
    <Replace .../>          按主键覆盖插入（= INSERT OR REPLACE）
    <InsertOrIgnore .../>   主键已存在则忽略
    <Delete .../>           删除**所有匹配给定属性**的行（属性是部分匹配；无属性＝清空表）
    <Update><Where/><Set/>  按 Where 匹配，用 Set 覆盖字段（Where 缺省＝匹配全表）

所以只收集 <Row> 会得到错误结果（多出被删的行、少了被改的值）。本脚本按加载顺序
逐文件重放全部五种操作，得到与游戏内一致的最终表。主键、列默认值与外键级联行为直接
解析游戏自带的 Base/Assets/Gameplay/Data/Schema/01_GameplaySchema.sql，不手工抄写。

三个容易踩空的实现细节（都实际影响了数值，不是洁癖）：

1. <Where> 与 <Set> 既可以把列写成属性，也可以写成子元素：
       <Update><Where FeatureType="FEATURE_EYE_OF_THE_SAHARA" YieldType="YIELD_PRODUCTION"/>
               <Set><YieldChange>2</YieldChange></Set></Update>
   只读属性会把这类修改静默丢掉（撒哈拉之眼的生产力就会停在旧值）。两种写法都要支持。

2. <Row> 是普通 INSERT，不是 upsert。主键冲突时游戏里那次插入失败、原行保留，
   所以本脚本也「先到者胜」并把冲突记进报告。

3. 必须重放 Types 表并实现外键的 ON DELETE CASCADE。风云变幻就是靠
   「删 Types 里的一行 → 级联删掉 Technologies/Civilizations/Traits 里的对应行 → 再插新行」
   来改写基础游戏内容的（Expansion2_RemoveData.xml 删掉 Type=TECH_FUTURE_TECH，
   随后 Expansion2_Technologies.xml 重新插入 Cost=2600、EraType=ERA_FUTURE 的版本）。
   不实现级联，就会看到一堆假的主键冲突，并且留在表里的是被替换掉的旧值。

────────────────────────────────────────────────────────────────────────
二、加载顺序：从 .modinfo 读，不靠文件系统遍历顺序
────────────────────────────────────────────────────────────────────────
每个 DLC 的 <名字>.modinfo 里，InGameActions/UpdateDatabase 组件按顺序列出它加载的
数据文件，并带一个 criteria 指向 ActionCriteria/Criteria 里的判定条件。本脚本按
「完整版 + 风云变幻规则集（RULESET_EXPANSION_2）+ 不开任何可选游戏模式」求值这些条件：

    RuleSetInUse             取值里含 RULESET_EXPANSION_2 → 满足
    GameCoreInUse            取值为 Expansion2 → 满足（因此迭起兴衰的 core 内容不载入，
                             它的等价文件由 Expansion2 目录内的副本提供，见下）
    LeaderPlayable           取值里提到 Expansion2_Players → 满足（完整版全领袖可选）
    ModInUse / ModIsEnabled  一律满足（全 DLC 已安装）
    ConfigurationValueMatches 一律不满足（= 英雄/秘社/戏剧时代/蛮族部落等可选模式默认关闭）
                             想载入这些内容加 --modes
    Criteria 的 any="1" 表示「任一满足」，否则「全部满足」；组件不带 criteria ＝无条件加载

这不是权宜之计而是必须：DLC/Expansion1/Data 与 DLC/Expansion2/Data 里有同名不同内容的
文件（Expansion1_Districts.xml 两份 md5 不同），风云变幻游戏只加载 Expansion2 目录内的
那份。若两份都重放，同一主键会被插入两次，数值也会错。剧本 DLC（黑死病、海盗等）的
criteria 是 RULESET_SCENARIO_*，在这套判定下自然被排除。

文件顺序：Base（Gameplay/Data/*.xml 按文件名排序）→ Expansion1 → Expansion2 →
其余 DLC 目录按目录名排序；每个 modinfo 内组件按 LoadOrder 稳定排序，组件内按列出顺序。
排序全部显式，不随文件系统遍历顺序变化。

────────────────────────────────────────────────────────────────────────
三、几个刻意的取舍（详见脚本末尾报告里的「推断字段」一节）
────────────────────────────────────────────────────────────────────────
* adjacency_rules.规则id ＝ "<区域id>@<原始ID>"。游戏的 Adjacency_YieldChanges.ID 不够用作
  主键：同一条 ID 可以挂在多个区域上（拉夫拉与圣地共用同样的 10 条 id），而字段说明 §七 规则 3
  要求 规则id 唯一。原始 ID 完整保留在「原始标识」列里，对账不受影响。
* 山脉在文明 6 里是 5 个地形变体，"学院相邻山脉 +1" 就是 5 条独立规则，照原样输出。
* 特色区域不做规则继承：District_Adjacencies 里怎么挂就怎么出。
* 名称取简体中文（Base/Assets/Text/Vanilla_zh_Hans_CN.xml 与各 DLC 的 *_Translations_Text.xml），
  缺失回退英文，再缺失回退 LOC 键本身，绝不留空。
"""

import argparse
import csv
import os
import pathlib
import re
import sys
import xml.etree.ElementTree as ET
from collections import OrderedDict, defaultdict

# ── 常量 ────────────────────────────────────────────────────────────────
# 文明 6 的 Assets 目录。按 环境变量 → 各平台默认位置 的顺序找第一个存在的。
# 不写死本机路径：一来别人跑不了，二来「删掉 CSV 重跑能完全重建」这条可复现性
# 声明，只有在别人的机器上也成立时才算数。
CIV6_ASSETS_ENV = "CIV6_ASSETS"
_CANDIDATES = [
    # macOS（Steam）
    "~/Library/Application Support/Steam/steamapps/common/"
    "Sid Meier's Civilization VI/Civ6.app/Contents/Assets",
    # Windows（Steam，默认盘）
    "C:/Program Files (x86)/Steam/steamapps/common/Sid Meier's Civilization VI/Base/../",
    # Linux（Steam）
    "~/.steam/steam/steamapps/common/Sid Meier's Civilization VI/Base/../",
    # Epic（macOS）
    "~/Library/Application Support/Epic/CivilizationVI/Civ6.app/Contents/Assets",
]


def _default_assets():
    env = os.environ.get(CIV6_ASSETS_ENV)
    if env:
        return env
    for c in _CANDIDATES:
        p = pathlib.Path(c).expanduser()
        if p.is_dir():
            return str(p)
    return str(pathlib.Path(_CANDIDATES[0]).expanduser())      # 报错时给个可读路径


DEFAULT_ASSETS = _default_assets()

TARGET_RULESET = "RULESET_EXPANSION_2"   # 风云变幻（完整版默认规则集）
TARGET_GAMECORE = "Expansion2"
ZH = "zh_Hans_CN"

# 需要重放的表。其余表跳过（省时间也省内存）。
# Types 必须在列表里：它是游戏改写基础内容的总开关（删 Types 行会级联删掉具体表里的行）。
NEEDED_TABLES = [
    "Types",
    "Terrains", "Terrain_YieldChanges",
    "Features", "Feature_YieldChanges",
    "Resources", "Resource_YieldChanges",
    "Technologies", "Civics", "Eras", "Yields",
    "Improvements", "Improvement_YieldChanges", "Improvement_ValidTerrains",
    "Districts", "District_ValidTerrains", "District_Adjacencies",
    "DistrictReplaces", "Adjacency_YieldChanges", "ExcludedAdjacencies",
    # 只为报告用：说清那些没挂到任何区域的相邻规则去哪了（改良设施也用同一张规则表）
    "Improvement_Adjacencies",
    "Buildings", "Building_YieldChanges", "BuildingPrereqs", "BuildingReplaces",
    "Civilizations", "CivilizationTraits", "CivilizationLeaders",
    "Leaders", "LeaderTraits", "Traits",
]

YIELD_ZH = {
    "YIELD_SCIENCE": "科技", "YIELD_CULTURE": "文化", "YIELD_GOLD": "金币",
    "YIELD_PRODUCTION": "生产力", "YIELD_FAITH": "信仰", "YIELD_FOOD": "粮食",
}
RESOURCECLASS_ZH = {
    "RESOURCECLASS_BONUS": "加成", "RESOURCECLASS_LUXURY": "奢侈",
    "RESOURCECLASS_STRATEGIC": "战略", "RESOURCECLASS_LEY_LINE": "魔力节点",
    "RESOURCECLASS_ARTIFACT": "文物",
}
# SDD §3.4：文明 6 原字段 → 本项目 目标类别。值为 True 的是布尔型（目标id 恒为「无」）
TARGET_COLS = [
    ("AdjacentTerrain", "地形", False),
    ("AdjacentFeature", "地貌", False),
    ("AdjacentDistrict", "区域", False),
    ("AdjacentImprovement", "改良设施", False),
    ("AdjacentResourceClass", "资源类别", False),
    ("OtherDistrictAdjacent", "任意其他区域", True),
    ("AdjacentSeaResource", "海洋资源", True),
    ("AdjacentRiver", "河流", True),
    ("AdjacentWonder", "世界奇观", True),
    ("Self", "自身", True),
    ("AdjacentNaturalWonder", "自然奇观", True),
    ("AdjacentResource", "任意资源", True),
]
NONE = "无"
# 「无限」与「无」必须是两个不同的记号。districts 的上限列里，「无」会被读成
# "没有这个属性"，而实际语义是"不设上限"——混用会让求值器把不限当成限 0。
UNLIMITED = "无限"


# ── 报告收集 ────────────────────────────────────────────────────────────
class Report(object):
    def __init__(self):
        self.warns = []
        self.skips = defaultdict(list)      # 原因 → [条目]

    def warn(self, msg):
        self.warns.append(msg)

    def skip(self, reason, item):
        self.skips[reason].append(item)


REPORT = Report()


def die(msg):
    sys.stderr.write("✗ %s\n" % msg)
    sys.exit(2)


# ── 一、解析游戏自带的 SQL 表结构（主键、列默认值、外键级联） ──────────────
FK_RE = re.compile(
    r"FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)"
    r"((?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT|"
    r"NO\s+ACTION|RESTRICT))*)", re.I)


def load_schema(sql_path):
    """从 01_GameplaySchema.sql 取出每张表的主键、列默认值与外键级联行为。

    不手工抄这些：抄错一个主键会让 Replace 行为错得很安静，漏一条 ON DELETE CASCADE
    会让「删 Types 行以改写基础内容」这套机制整个失效。
    """
    text = sql_path.read_text(encoding="utf-8", errors="replace")
    schema = {}
    for m in re.finditer(r'CREATE\s+TABLE\s+"([A-Za-z0-9_]+)"\s*\((.*?)\);',
                         text, re.S):
        name, body = m.group(1), m.group(2)
        pk = []
        defaults = {}
        cols = []
        pkm = re.search(r"PRIMARY\s+KEY\s*\(([^)]*)\)", body)
        if pkm:
            pk = [c.strip().strip('"') for c in pkm.group(1).split(",") if c.strip()]
        for line in body.split("\n"):
            line = line.strip().rstrip(",")
            cm = re.match(r'"([A-Za-z0-9_]+)"\s+(TEXT|INTEGER|BOOLEAN|REAL)\b', line)
            if not cm:
                continue
            col = cm.group(1)
            cols.append(col)
            dm = re.search(r'DEFAULT\s+("?[-A-Za-z0-9_\.]+"?)', line)
            if dm:
                defaults[col] = dm.group(1).strip('"')
        fks = []
        for f in FK_RE.finditer(body):
            child = [c.strip().strip('"') for c in f.group(1).split(",")]
            parent = f.group(2)
            pcols = [c.strip().strip('"') for c in f.group(3).split(",")]
            clauses = " ".join(f.group(4).split()).upper()
            dm = re.search(r"ON DELETE (CASCADE|SET NULL|SET DEFAULT|"
                           r"NO ACTION|RESTRICT)", clauses)
            fks.append({"cols": child, "parent": parent, "pcols": pcols,
                        "on_delete": dm.group(1) if dm else "NO ACTION"})
        schema[name] = {"pk": pk, "defaults": defaults, "cols": cols, "fks": fks}
    return schema


# ── 二、按 .modinfo 排定加载顺序 ─────────────────────────────────────────
def eval_criteria(crit_el, include_modes, modinfo_name):
    """求值一个 <Criteria>。未知判定式直接报错退出，不静默放过。"""
    any_mode = crit_el.attrib.get("any") == "1"
    results = []
    for pred in crit_el:
        t = pred.tag
        txt = (pred.text or "").strip()
        if t == "RuleSetInUse":
            results.append(TARGET_RULESET in [x.strip() for x in txt.split(",")])
        elif t == "GameCoreInUse":
            results.append(txt == TARGET_GAMECORE)
        elif t == "LeaderPlayable":
            results.append("Expansion2_Players" in txt)
        elif t in ("ModInUse", "ModIsEnabled"):
            results.append(True)            # 完整版：全部 DLC 已安装并启用
        elif t == "ConfigurationValueMatches":
            results.append(bool(include_modes))   # 可选游戏模式，默认关闭
        else:
            die("%s 里出现未知的 criteria 判定式 <%s>，无法判断该内容是否应加载。"
                "请在 parse_civ6_xml.py 的 eval_criteria() 里补上它的语义。"
                % (modinfo_name, t))
    if not results:
        return True
    return any(results) if any_mode else all(results)


def modinfo_components(modinfo_path, section, kind, include_modes):
    """返回 [(组件id, [相对文件路径…])]，已按 criteria 过滤、按 LoadOrder 稳定排序。"""
    root = ET.parse(str(modinfo_path)).getroot()
    crits = {}
    for ac in root.findall("ActionCriteria"):
        for c in ac.findall("Criteria"):
            crits[c.attrib.get("id")] = c
    out = []
    for sect in root.findall(section):
        for comp in sect:
            if comp.tag != kind:
                continue
            cid = comp.attrib.get("criteria")
            if cid is not None:
                crit = crits.get(cid)
                if crit is None:
                    die("%s 的组件 %s 引用了不存在的 criteria「%s」"
                        % (modinfo_path.name, comp.attrib.get("id"), cid))
                if not eval_criteria(crit, include_modes, modinfo_path.name):
                    continue
            order = 0
            for lo in comp.iter("LoadOrder"):
                try:
                    order = int((lo.text or "0").strip())
                except ValueError:
                    order = 0
            files = [f.text.strip() for f in comp.iter("File")
                     if f.text and f.text.strip()]
            out.append((order, comp.attrib.get("id", "?"), files))
    out.sort(key=lambda t: t[0])            # sort 稳定：同 LoadOrder 保持列出顺序
    return [(cid, files) for _, cid, files in out]


def dlc_order(assets):
    """DLC 目录顺序：Expansion1 → Expansion2 → 其余按目录名排序。"""
    dlc = assets / "DLC"
    if not dlc.is_dir():
        return []
    dirs = sorted([d for d in dlc.iterdir() if d.is_dir()], key=lambda p: p.name)
    head = [d for d in dirs if d.name in ("Expansion1", "Expansion2")]
    head.sort(key=lambda p: p.name)
    tail = [d for d in dirs if d.name not in ("Expansion1", "Expansion2")]
    return head + tail


def plan_files(assets, include_modes):
    """返回 (数据文件列表, 文本文件列表)，元素为 (标签, 路径)。顺序即加载顺序。"""
    data, text = [], []
    base_data = sorted((assets / "Base/Assets/Gameplay/Data").glob("*.xml"),
                       key=lambda p: p.name)
    if not base_data:
        die("在 %s 下找不到 Base/Assets/Gameplay/Data/*.xml，--assets 路径可能不对"
            % assets)
    for p in base_data:
        data.append(("Base/" + p.name, p))
    base_text = sorted((assets / "Base/Assets/Text/en_US").glob("*.xml"),
                       key=lambda p: p.name)
    for p in base_text:
        text.append(("Base/en_US/" + p.name, p))
    zh = assets / "Base/Assets/Text" / ("Vanilla_%s.xml" % ZH)
    if zh.exists():
        text.append(("Base/" + zh.name, zh))
    else:
        REPORT.warn("找不到简体中文文本 %s，名称将回退英文" % zh.name)

    for d in dlc_order(assets):
        mi = sorted(d.glob("*.modinfo"), key=lambda p: p.name)
        if not mi:
            REPORT.skip("DLC 目录没有 .modinfo，整个跳过", d.name)
            continue
        for m in mi:
            for cid, files in modinfo_components(m, "InGameActions",
                                                 "UpdateDatabase", include_modes):
                for rel in files:
                    p = d / rel
                    if rel.lower().endswith(".sql"):
                        REPORT.skip("DLC 的 .sql 文件（只改表结构，不含数据行）",
                                    "%s/%s" % (d.name, rel))
                        continue
                    if not rel.lower().endswith(".xml"):
                        continue
                    if not p.exists():
                        REPORT.warn("%s 的组件 %s 列出的文件不存在：%s"
                                    % (m.name, cid, rel))
                        continue
                    data.append(("%s/%s" % (d.name, pathlib.Path(rel).name), p))
            for cid, files in modinfo_components(m, "InGameActions",
                                                 "UpdateText", include_modes):
                for rel in files:
                    p = d / rel
                    if not rel.lower().endswith(".xml") or not p.exists():
                        continue
                    text.append(("%s/%s" % (d.name, pathlib.Path(rel).name), p))
    return data, text


# ── 三、重放数据库操作 ──────────────────────────────────────────────────
def cols_of(el):
    """<Where>/<Set> 的列既可写成属性，也可写成子元素，两种都要取。"""
    out = dict(el.attrib)
    for ch in el:
        out[ch.tag] = (ch.text or "").strip()
    return out


class DB(object):
    """按加载顺序重放行级操作，得到与游戏内一致的最终表。

    行存在 OrderedDict 里：键是主键元组，值是行 dict。既有 O(1) 主键查找，
    又保留插入顺序（输出仍然显式排序，不依赖这个顺序）。
    """

    def __init__(self, schema):
        self.schema = schema
        self.tables = OrderedDict((t, OrderedDict()) for t in NEEDED_TABLES)
        self.rows_by_file = defaultdict(int)
        self.op_counts = defaultdict(int)          # (表, 操作) → 次数
        self.delete_hits = defaultdict(int)        # 表 → 实际删掉的行数（含级联）
        self.cascade_hits = defaultdict(int)       # 表 → 其中因外键级联被删的行数
        self.update_hits = defaultdict(int)        # 表 → 实际改到的行数
        self.pk_collisions = []
        # 反向外键：父表 → [(子表, 子列, 父列, ON DELETE 动作)]
        self.children = defaultdict(list)
        for t in NEEDED_TABLES:
            for fk in schema.get(t, {}).get("fks", []):
                if len(fk["cols"]) != 1 or len(fk["pcols"]) != 1:
                    REPORT.warn("%s 上有复合外键 %s，本脚本只处理单列外键"
                                % (t, fk["cols"]))
                    continue
                if fk["parent"] not in self.tables:
                    continue                      # 父表不在重放范围内，无从级联
                self.children[fk["parent"]].append(
                    (t, fk["cols"][0], fk["pcols"][0], fk["on_delete"]))

    def rows(self, table):
        return list(self.tables[table].values())

    def pk_of(self, table, row):
        pk = self.schema.get(table, {}).get("pk") or []
        if not pk:
            return None
        return tuple(row.get(c, "") for c in pk)

    # ── 删除（含外键级联） ───────────────────────────────────────────────
    def _delete_matching(self, table, cond, cascade=False):
        pk = self.schema[table]["pk"]
        tbl = self.tables[table]
        victims = []
        if pk and all(c in cond for c in pk):
            key = tuple(cond[c] for c in pk)
            r = tbl.get(key)
            # 主键之外的属性也必须匹配（Delete 是部分匹配，不是只看主键）
            if r is not None and all(r.get(k) == v for k, v in cond.items()):
                victims.append(key)
        else:
            for key, r in tbl.items():
                if all(r.get(k) == v for k, v in cond.items()):
                    victims.append(key)
        if not victims:
            return 0
        gone_rows = [tbl.pop(k) for k in victims]
        self.delete_hits[table] += len(gone_rows)
        if cascade:
            self.cascade_hits[table] += len(gone_rows)
        for child, ccol, pcol, action in self.children.get(table, []):
            vals = set(r.get(pcol) for r in gone_rows if r.get(pcol) is not None)
            if not vals:
                continue
            if action == "CASCADE":
                for v in sorted(vals):
                    self._delete_matching(child, {ccol: v}, cascade=True)
            elif action in ("SET NULL", "SET DEFAULT"):
                for r in self.tables[child].values():
                    if r.get(ccol) in vals:
                        if action == "SET NULL":
                            r[ccol] = ""          # NULL
                        else:
                            r.pop(ccol, None)     # 回落到表结构里的默认值
        return len(gone_rows)

    # ── 重放一个文件 ────────────────────────────────────────────────────
    def apply_file(self, label, path):
        try:
            root = ET.parse(str(path)).getroot()
        except ET.ParseError as e:
            REPORT.warn("XML 解析失败，已跳过：%s（%s）" % (label, e))
            return
        if root.tag != "GameInfo":
            return
        for tbl in root:
            name = tbl.tag
            if name not in self.tables:
                continue
            store = self.tables[name]
            for op in tbl:
                self.op_counts[(name, op.tag)] += 1
                if op.tag in ("Row", "Replace", "InsertOrIgnore"):
                    row = dict(op.attrib)
                    key = self.pk_of(name, row)
                    if key is None:
                        die("%s 的 %s 没有主键，无法安全插入" % (label, name))
                    if op.tag == "Row":
                        if key in store:
                            # 普通 INSERT 撞主键：游戏里这次插入失败，原行保留
                            self.pk_collisions.append((label, name, key))
                            continue
                        store[key] = row
                    elif op.tag == "Replace":
                        store[key] = row
                    else:                          # InsertOrIgnore
                        if key in store:
                            continue
                        store[key] = row
                    self.rows_by_file[(label, name)] += 1
                elif op.tag == "Delete":
                    self._delete_matching(name, dict(op.attrib))
                elif op.tag == "Update":
                    where, sets = {}, {}
                    for sub in op:
                        if sub.tag == "Where":
                            where.update(cols_of(sub))
                        elif sub.tag == "Set":
                            sets.update(cols_of(sub))
                        else:
                            die("%s 的 <Update> 里出现未知子标签 <%s>"
                                % (label, sub.tag))
                    if not sets:
                        REPORT.warn("%s 的 %s 有一条 <Update> 没有 <Set>，已忽略"
                                    % (label, name))
                        continue
                    hit = [r for r in store.values()
                           if all(r.get(k) == v for k, v in where.items())]
                    for r in hit:
                        r.update(sets)
                    self.update_hits[name] += len(hit)
                    if not hit:
                        REPORT.warn("%s 的 %s 有一条 <Update> 没匹配到任何行（Where=%s）"
                                    % (label, name, where or "缺省=全表"))
                    pkcols = self.schema[name]["pk"]
                    if hit and any(c in sets for c in pkcols):
                        # 改了主键：重建索引，否则后续按主键查找会错位
                        rebuilt = OrderedDict()
                        for r in store.values():
                            rebuilt[self.pk_of(name, r)] = r
                        self.tables[name] = rebuilt
                        store = self.tables[name]
                else:
                    die("%s 的 %s 里出现未实现的行级操作 <%s>。"
                        "请在 parse_civ6_xml.py 的 DB.apply_file() 里实现它，"
                        "不要静默跳过。" % (label, name, op.tag))

    # 取值：带上 SQL 表结构里的列默认值
    def get(self, table, row, col, fallback=""):
        if col in row:
            return row[col]
        d = self.schema.get(table, {}).get("defaults", {})
        if col in d:
            return d[col]
        return fallback

    def boolean(self, table, row, col):
        v = str(self.get(table, row, col, "0")).strip().lower()
        return v in ("true", "1")


# ── 四、本地化文本 ──────────────────────────────────────────────────────
MARKUP = re.compile(r"\[(?:NEWLINE|ICON_[A-Za-z0-9_]*|COLOR[^\]]*|ENDCOLOR|"
                    r"LINK[^\]]*|/LINK|BULLET)\]")


def clean_text(s):
    if s is None:
        return ""
    s = MARKUP.sub(" ", s)
    s = s.replace("\r", " ").replace("\n", " ").replace("\t", " ")
    s = s.replace("|", "／")            # | 是本项目 CSV 的多值分隔符，正文里不能留
    s = re.sub(r"\s+", " ", s)
    return s.strip()


class Loc(object):
    """LOC 键 → 文本。优先简体中文，缺失回退英文，再缺失回退键本身。"""

    def __init__(self):
        self.zh = {}
        self.en = {}

    def load(self, label, path):
        try:
            root = ET.parse(str(path)).getroot()
        except ET.ParseError as e:
            REPORT.warn("文本文件解析失败，已跳过：%s（%s）" % (label, e))
            return
        for tbl in root:
            if tbl.tag not in ("LocalizedText", "EnglishText", "BaseGameText",
                              "FrontEndText"):
                continue
            for op in tbl:
                tag = op.attrib.get("Tag")
                lang = op.attrib.get("Language")
                store = self.zh if lang == ZH else (self.en if lang in (None, "en_US")
                                                    else None)
                if store is None:
                    continue
                if op.tag == "Delete":
                    if tag:
                        store.pop(tag, None)
                    continue
                txt = None
                for ch in op:
                    if ch.tag == "Text":
                        txt = ch.text or ""
                    elif ch.tag == "Where":       # <Update> 形式
                        tag = ch.attrib.get("Tag", tag)
                    elif ch.tag == "Set":
                        for g in ch:
                            if g.tag == "Text":
                                txt = g.text or ""
                        if "Text" in ch.attrib:
                            txt = ch.attrib["Text"]
                if txt is None:
                    txt = op.attrib.get("Text")
                if tag and txt is not None:
                    store[tag] = txt

    def __call__(self, key, default=None):
        if not key:
            return default if default is not None else NONE
        raw = self.zh.get(key)
        if raw is None:
            raw = self.en.get(key)
        if raw is None:
            REPORT.skip("本地化文本缺失，名称回退为 LOC 键", key)
            return key
        # 部分语言的 Text 用 "单数|复数"，取第一段
        return clean_text(raw.split("|")[0]) or key


# ── 五、小工具 ──────────────────────────────────────────────────────────
def joiner(vals):
    vals = [v for v in vals if v]
    return "|".join(vals) if vals else NONE


def or_none(v):
    v = (v or "").strip()
    return v if v else NONE


def yields_of(db, table, key_col, key, id_col="YieldType", val_col="YieldChange"):
    """把某张 *_YieldChanges 表整理成 `科技:2|金币:1` 形式。"""
    got = []
    for r in db.rows(table):
        if r.get(key_col) != key:
            continue
        yt = r.get(id_col, "")
        zh = YIELD_ZH.get(yt)
        if zh is None:
            REPORT.skip("产出类型不在字段说明 §五 枚举内（该条产出被丢弃）",
                        "%s %s %s" % (table, key, yt))
            continue
        val = db.get(table, r, val_col, "0")
        got.append((zh, val))
    got.sort()
    return joiner(["%s:%s" % (z, v) for z, v in got])


def write_csv(path, header, rows):
    with open(str(path), "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(header)
        for r in rows:
            w.writerow(r)


PROV = ["一手", "否"]          # 数据来源 / 待核：本轮全部来自游戏本体

# 首期纳入的文明：设计决定，不在游戏数据里（2026-09-24 定）。
# 选择标准是「特色区域的机制类型要有差异」而非数值更高，五种类型各一个：
#   韩国 书院   方向反转（+4 固定 + 每相邻一区域 −1，与学院的成团逻辑相反）
#   希腊 卫城   档位升级（通用区域相邻从标准档升主要档，代价是丢三条娱乐区规则）
#   德国 汉萨   规则集替换（吃商业中心与资源，而工业区吃矿场采石场）
#   高卢 奥皮杜姆 规则裁剪（ExcludedAdjacencies 排除 5 条通用档，换采石场与战略资源翻倍）
#   越南 城池   配额穿透 + 全表最高通用档（任意其他区域每 1 个 +2 文化）
FIRST_ROUND_CIVS = frozenset([
    "CIVILIZATION_KOREA", "CIVILIZATION_GREECE", "CIVILIZATION_GERMANY",
    "CIVILIZATION_GAUL", "CIVILIZATION_VIETNAM",
])


# ── 六、各表生成 ────────────────────────────────────────────────────────
def gen_terrains(db, loc):
    """terrains.csv：地形id, 名称, 基础产出, 是否可建区域, 备注 + 来源两列

    是否可建区域为推断字段：Impassable=true（山脉、冰）判为否；水域地形里只有浅水
    （ShallowWater=true，即海岸与湖泊）判为是——港口一类 Coast=true 的区域建在浅水上，
    深海（TERRAIN_OCEAN）没有任何区域可建。
    """
    rows = []
    for r in db.rows("Terrains"):
        tid = r["TerrainType"]
        impassable = db.boolean("Terrains", r, "Impassable")
        water = db.boolean("Terrains", r, "Water")
        if impassable:
            ok = "否"
        elif water:
            ok = "是" if db.boolean("Terrains", r, "ShallowWater") else "否"
        else:
            ok = "是"
        note = []
        if db.boolean("Terrains", r, "Mountain"):
            note.append("山脉变体")
        if db.boolean("Terrains", r, "Hills"):
            note.append("丘陵")
        if water:
            note.append("水域")
        rows.append([tid, loc(r.get("Name")),
                     yields_of(db, "Terrain_YieldChanges", "TerrainType", tid),
                     ok, joiner(note) if note else NONE] + PROV)
    rows.sort(key=lambda x: x[0])
    return ["地形id", "名称", "基础产出", "是否可建区域", "备注",
            "数据来源", "待核"], rows


def gen_features(db, loc):
    """features.csv：含自然奇观（文明 6 的自然奇观就是 NaturalWonder=true 的地貌，
    且相邻规则的 AdjacentFeature 可能指向它们，拆表会造成外键断裂）。"""
    rows = []
    for r in db.rows("Features"):
        fid = r["FeatureType"]
        nw = db.boolean("Features", r, "NaturalWonder")
        impassable = db.boolean("Features", r, "Impassable")
        ok = "否" if (nw or impassable) else "是"
        removable = db.boolean("Features", r, "Removable")
        note = []
        if nw:
            note.append("自然奇观")
        if impassable:
            note.append("不可通行")
        rows.append([fid, loc(r.get("Name")),
                     yields_of(db, "Feature_YieldChanges", "FeatureType", fid),
                     ok, "是" if removable else "否",
                     joiner(note) if note else NONE] + PROV)
    rows.sort(key=lambda x: x[0])
    return ["地貌id", "名称", "基础产出", "是否可建区域", "是否需移除", "备注",
            "数据来源", "待核"], rows


def gen_resources(db, loc):
    rows = []
    for r in db.rows("Resources"):
        rid = r["ResourceType"]
        cls = db.get("Resources", r, "ResourceClassType", "")
        zh = RESOURCECLASS_ZH.get(cls)
        if zh is None:
            REPORT.skip("资源类别不在字段说明 §五 枚举内（整行被跳过）",
                        "%s（%s）" % (rid, cls))
            continue
        # 「海洋资源」＝可出现在水域：有海洋生成频率，或写明必须临陆（近海资源）
        sea_freq = str(db.get("Resources", r, "SeaFrequency", "0")).strip()
        sea = (db.boolean("Resources", r, "AdjacentToLand")
               or (sea_freq not in ("", "0")))
        rows.append([rid, loc(r.get("Name")), zh, "是" if sea else "否",
                     yields_of(db, "Resource_YieldChanges", "ResourceType", rid),
                     NONE] + PROV)
    rows.sort(key=lambda x: x[0])
    return ["资源id", "名称", "资源类别", "是否海洋资源", "基础产出", "备注",
            "数据来源", "待核"], rows


def gen_wonders(db, loc):
    """wonders.csv 是自然奇观表（世界奇观在文明 6 里是 Buildings.IsWonder，
    且相邻规则里「世界奇观」是布尔型、不需要 id 表）。"""
    rows = []
    for r in db.rows("Features"):
        if not db.boolean("Features", r, "NaturalWonder"):
            continue
        fid = r["FeatureType"]
        tiles = db.get("Features", r, "Tiles", "1")
        rows.append([fid, loc(r.get("Name")),
                     yields_of(db, "Feature_YieldChanges", "FeatureType", fid),
                     tiles or "1", NONE] + PROV)
    rows.sort(key=lambda x: x[0])
    return ["奇观id", "名称", "基础产出", "占用格数", "备注",
            "数据来源", "待核"], rows


def gen_techs(db, loc):
    rows = [[r["TechnologyType"], loc(r.get("Name")),
             or_none(db.get("Technologies", r, "EraType")), NONE] + PROV
            for r in db.rows("Technologies")]
    rows.sort(key=lambda x: x[0])
    return ["科技id", "名称", "时代", "备注", "数据来源", "待核"], rows


def gen_civics(db, loc):
    rows = [[r["CivicType"], loc(r.get("Name")),
             or_none(db.get("Civics", r, "EraType")), NONE] + PROV
            for r in db.rows("Civics")]
    rows.sort(key=lambda x: x[0])
    return ["市政id", "名称", "时代", "备注", "数据来源", "待核"], rows


def gen_improvements(db, loc):
    valid = defaultdict(list)
    for r in db.rows("Improvement_ValidTerrains"):
        valid[r.get("ImprovementType")].append(r.get("TerrainType"))
    rows = []
    for r in db.rows("Improvements"):
        iid = r["ImprovementType"]
        terr = sorted(set(t for t in valid.get(iid, []) if t))
        rows.append([iid, loc(r.get("Name")),
                     yields_of(db, "Improvement_YieldChanges",
                               "ImprovementType", iid),
                     joiner(terr),
                     or_none(db.get("Improvements", r, "PrereqTech")),
                     or_none(db.get("Improvements", r, "PrereqCivic")),
                     NONE] + PROV)
    rows.sort(key=lambda x: x[0])
    return ["改良设施id", "名称", "基础产出", "可建地形", "前置科技", "前置市政",
            "备注", "数据来源", "待核"], rows


def trait_to_civ(db):
    """TraitType → [CivilizationType]（特色区域归属靠它解析）"""
    out = defaultdict(list)
    for r in db.rows("CivilizationTraits"):
        t, c = r.get("TraitType"), r.get("CivilizationType")
        if t and c:
            out[t].append(c)
    return out


def gen_districts(db, loc):
    """districts.csv

    两个推断字段：
      * 区域类别：CityCenter=true → 城市中心；RequiresPopulation=true → 专业化；否则非专业化
      * 是否占区域配额 ＝ RequiresPopulation。文明 6 没有名为「占配额」的列，
        区域上限由人口决定，RequiresPopulation 正是「这个区域是否受人口约束」。
    基础产出恒为「无」：文明 6 的区域本身没有产出表（产出来自建筑、市民与相邻加成），
    District_CitizenYieldChanges 是「每个市民的产出」，语义不同，不能填进这一列。
    """
    valid = defaultdict(list)
    for r in db.rows("District_ValidTerrains"):
        valid[r.get("DistrictType")].append(r.get("TerrainType"))
    # 临海区域（Coast=true）在原数据里不走 District_ValidTerrains，而是靠一个布尔列表达。
    # 若不补上，港口的「可建地形」会是「无」＝不限，等于把非法摆位放了进来。
    shallow = sorted(r["TerrainType"] for r in db.rows("Terrains")
                     if db.boolean("Terrains", r, "ShallowWater"))
    replaces = {}
    for r in db.rows("DistrictReplaces"):
        replaces[r.get("CivUniqueDistrictType")] = r.get("ReplacesDistrictType")
    t2c = trait_to_civ(db)
    rows = []
    for r in db.rows("Districts"):
        did = r["DistrictType"]
        if db.boolean("Districts", r, "CityCenter"):
            kind = "城市中心"
        elif db.boolean("Districts", r, "RequiresPopulation"):
            kind = "专业化"
        else:
            kind = "非专业化"
        quota = "是" if db.boolean("Districts", r, "RequiresPopulation") else "否"
        # 唯一性约束（2026-09-26 补，字段说明 §六·三）。两列都靠**表结构默认值**表达
        #   大多数情形，所以必须走 db.boolean / db.get 的默认值回退，不能读原始 XML 属性：
        #   全 36 行里只有 4 行显式写了 OnePerCity=false、2 行显式写了 MaxPerPlayer=1。
        #   统一成「上限」语义（数字或「无限」），求值器直接比计数，不必再解释布尔。
        one_per_city = db.boolean("Districts", r, "OnePerCity")
        per_city = "1" if one_per_city else UNLIMITED
        mpp = db.get("Districts", r, "MaxPerPlayer", "-1")
        try:
            mpp_n = float(mpp)
        except ValueError:
            mpp_n = -1.0
        per_player = UNLIMITED if mpp_n < 0 else str(int(mpp_n))
        trait = db.get("Districts", r, "TraitType", "")
        civs = sorted(set(t2c.get(trait, []))) if trait else []
        rep = replaces.get(did)
        uniq = bool(trait) and bool(rep) and bool(civs)
        if trait and not uniq:
            REPORT.warn("区域 %s 带 TraitType=%s，但%s%s —— 已按非特色区域输出"
                        % (did, trait,
                           "" if rep else "DistrictReplaces 里没有它；",
                           "" if civs else "该 trait 没挂到任何文明"))
        terr = sorted(set(t for t in valid.get(did, []) if t))
        note = []
        if db.boolean("Districts", r, "Coast"):
            note.append("须临海（Coast=true）")
            if not terr:
                terr = list(shallow)
        if db.boolean("Districts", r, "Aqueduct"):
            note.append("引水渠类")
        if db.boolean("Districts", r, "InternalOnly"):
            note.append("内部区域")
        rows.append([
            did, loc(r.get("Name")), kind, NONE,
            db.get("Districts", r, "Cost", "0"),
            or_none(db.get("Districts", r, "PrereqTech")),
            or_none(db.get("Districts", r, "PrereqCivic")),
            quota,
            per_city,
            per_player,
            joiner(terr),
            "是" if uniq else "否",
            rep if uniq else NONE,
            joiner(civs) if uniq else NONE,
            joiner(note) if note else NONE] + PROV)
    rows.sort(key=lambda x: x[0])
    return ["区域id", "名称", "区域类别", "基础产出", "生产成本", "前置科技",
            "前置市政", "是否占区域配额", "每城上限", "每玩家上限",
            "可建地形", "是否特色区域",
            "替换区域id", "所属文明id", "备注", "数据来源", "待核"], rows


def gen_buildings(db, loc):
    """buildings.csv：只收「区域内建筑」。

    世界奇观（IsWonder=true）不进这张表：它没有所属区域，而 buildings.所属区域id 是
    必填外键；相邻规则里的「世界奇观」是布尔型、不需要 id 表。跳过数量见报告。

    两列互斥标记（2026-09-25 补，字段说明 §六·二）：
      替换建筑id     ← BuildingReplaces（特色建筑与基础建筑互斥）
      是否宗教建筑   ← Buildings.EnabledByReligion（圣地的宗教建筑多选一）
    不补这两列，「按区域把建筑产出求和」就会重复计入 —— 圣地的建筑链会被高算 3.7 倍。
    """
    prereq = defaultdict(list)
    for r in db.rows("BuildingPrereqs"):
        prereq[r.get("Building")].append(r.get("PrereqBuilding"))
    replaces = defaultdict(list)
    for r in db.rows("BuildingReplaces"):
        replaces[r.get("CivUniqueBuildingType")].append(r.get("ReplacesBuildingType"))
    rows = []
    for r in db.rows("Buildings"):
        bid = r["BuildingType"]
        if db.boolean("Buildings", r, "IsWonder"):
            REPORT.skip("世界奇观（Buildings.IsWonder=true，无所属区域）不进 buildings.csv",
                        bid)
            continue
        dist = db.get("Buildings", r, "PrereqDistrict", "")
        if not dist:
            REPORT.skip("建筑没有 PrereqDistrict（所属区域id 必填），整行跳过", bid)
            continue
        rows.append([bid, loc(r.get("Name")), dist,
                     yields_of(db, "Building_YieldChanges", "BuildingType", bid),
                     db.get("Buildings", r, "Cost", "0"),
                     or_none(db.get("Buildings", r, "PrereqTech")),
                     or_none(db.get("Buildings", r, "PrereqCivic")),
                     joiner(sorted(set(p for p in prereq.get(bid, []) if p))),
                     joiner(sorted(set(x for x in replaces.get(bid, []) if x))),
                     "是" if db.boolean("Buildings", r, "EnabledByReligion") else "否",
                     NONE] + PROV)
    rows.sort(key=lambda x: x[0])
    return ["建筑id", "名称", "所属区域id", "基础产出", "生产成本", "前置科技",
            "前置市政", "前置建筑id", "替换建筑id", "是否宗教建筑",
            "备注", "数据来源", "待核"], rows


def ability_text(db, loc, traits):
    """把一串 TraitType 拼成人类可读的能力描述。没有描述的内部 trait 忽略。"""
    out = []
    tindex = dict((r.get("TraitType"), r) for r in db.rows("Traits"))
    for t in traits:
        r = tindex.get(t)
        if not r:
            continue
        if db.boolean("Traits", r, "InternalOnly"):
            continue
        name = r.get("Name")
        desc = r.get("Description")
        if not desc:
            continue
        piece = loc(desc)
        if name:
            piece = "%s：%s" % (loc(name), piece)
        out.append(piece)
    return "；".join(out) if out else NONE


def gen_civs(db, loc):
    """civs.csv。是否首期纳入来自 FIRST_ROUND_CIVS（设计决定，不在游戏数据里）。"""
    t2c = trait_to_civ(db)
    traits_of = defaultdict(list)
    for r in db.rows("CivilizationTraits"):
        traits_of[r.get("CivilizationType")].append(r.get("TraitType"))
    replaces = set(r.get("CivUniqueDistrictType") for r in db.rows("DistrictReplaces"))
    uniq_by_civ = defaultdict(list)
    for r in db.rows("Districts"):
        did = r["DistrictType"]
        trait = db.get("Districts", r, "TraitType", "")
        if not trait or did not in replaces:
            continue
        for c in t2c.get(trait, []):
            uniq_by_civ[c].append(did)
    rows = []
    for r in db.rows("Civilizations"):
        cid = r["CivilizationType"]
        rows.append([cid, loc(r.get("Name")),
                     joiner(sorted(set(uniq_by_civ.get(cid, [])))),
                     ability_text(db, loc, sorted(set(traits_of.get(cid, [])))),
                     "是" if cid in FIRST_ROUND_CIVS else "否", NONE] + PROV)
    rows.sort(key=lambda x: x[0])
    return ["文明id", "名称", "特色区域id", "文明能力", "是否首期纳入", "备注",
            "数据来源", "待核"], rows


def gen_leaders(db, loc, civ_ids):
    """leaders.csv：只收有文明归属的领袖（所属文明id 是必填外键）。"""
    civ_of = defaultdict(list)
    for r in db.rows("CivilizationLeaders"):
        civ_of[r.get("LeaderType")].append(r.get("CivilizationType"))
    traits_of = defaultdict(list)
    for r in db.rows("LeaderTraits"):
        traits_of[r.get("LeaderType")].append(r.get("TraitType"))
    rows = []
    for r in db.rows("Leaders"):
        lid = r["LeaderType"]
        civs = sorted(set(c for c in civ_of.get(lid, []) if c in civ_ids))
        if not civs:
            REPORT.skip("领袖没有对应文明（CivilizationLeaders 里查不到），整行跳过",
                        lid)
            continue
        rows.append([lid, loc(r.get("Name")), joiner(civs),
                     ability_text(db, loc, sorted(set(traits_of.get(lid, [])))),
                     "是" if any(c in FIRST_ROUND_CIVS for c in civs) else "否",
                     NONE] + PROV)
    rows.sort(key=lambda x: x[0])
    return ["领袖id", "名称", "所属文明id", "领袖能力", "是否首期纳入", "备注",
            "数据来源", "待核"], rows


def gen_excluded(db, loc):
    """excluded_adjacencies.csv：按文明或领袖的 trait 排除某条相邻规则。

    这是特色化的第三种手法（除「替换区域」与「新增规则」之外），也是高卢与
    日本的核心特性所在。trait 可能属于文明也可能属于领袖，游戏数据把两者
    混在同一列且没有区分字段，所以这里显式解析出归属并分成两列。
    """
    civ_of, lead_of = defaultdict(list), defaultdict(list)
    for r in db.rows("CivilizationTraits"):
        civ_of[r.get("TraitType")].append(r.get("CivilizationType"))
    for r in db.rows("LeaderTraits"):
        lead_of[r.get("TraitType")].append(r.get("LeaderType"))
    rows = []
    for r in db.rows("ExcludedAdjacencies"):
        t = r.get("TraitType")
        civs, leads = sorted(set(civ_of.get(t, []))), sorted(set(lead_of.get(t, [])))
        if not civs and not leads:
            REPORT.skip("ExcludedAdjacencies 的 TraitType 查不到归属，整行跳过", t)
            continue
        rows.append([t, joiner(civs) if civs else NONE,
                     joiner(leads) if leads else NONE,
                     r.get("YieldChangeId"), NONE] + PROV)
    rows.sort(key=lambda x: (x[0], x[3]))
    return ["traitid", "所属文明id", "所属领袖id", "被排除规则标识", "备注",
            "数据来源", "待核"], rows


def classify_target(db, adj):
    """按 SDD §3.4 把一行 Adjacency_YieldChanges 归到 (目标类别, 目标id)。"""
    hits = []
    for col, cat, is_bool in TARGET_COLS:
        raw = db.get("Adjacency_YieldChanges", adj, col, "")
        if is_bool:
            if str(raw).strip().lower() in ("true", "1"):
                hits.append((cat, NONE, col, raw))
        else:
            v = str(raw).strip()
            if v and v != "NO_RESOURCECLASS":
                if cat == "资源类别":
                    zh = RESOURCECLASS_ZH.get(v)
                    if zh is None:
                        return None, None, "资源类别取值不在枚举内：%s" % v
                    hits.append((cat, zh, col, raw))
                else:
                    hits.append((cat, v, col, raw))
    if not hits:
        return "无目标", NONE, None        # 合法：韩国书院的固定值行
    if len(hits) > 1:
        return None, None, ("同时命中多个目标列：%s"
                            % "、".join("%s=%s" % (h[2], h[3]) for h in hits))
    return hits[0][0], hits[0][1], None


def gen_adjacency(db, loc):
    """adjacency_rules.csv —— 本轮最重要的一张表。

    一行 ＝ District_Adjacencies（哪个区域挂了哪条规则）× Adjacency_YieldChanges（规则内容）。
    规则id ＝ "<区域id>@<原始ID>"，原始 ID 另存「原始标识」列，理由见文件头。
    """
    adj_by_id = {}
    for r in db.rows("Adjacency_YieldChanges"):
        adj_by_id[r.get("ID")] = r
    used = set()
    rows = []
    seen = {}
    for link in db.rows("District_Adjacencies"):
        did = link.get("DistrictType")
        aid = link.get("YieldChangeId")
        adj = adj_by_id.get(aid)
        if adj is None:
            REPORT.skip("District_Adjacencies 指向的 Adjacency_YieldChanges 不存在"
                        "（多半已被 Delete）", "%s → %s" % (did, aid))
            continue
        used.add(aid)
        yt = db.get("Adjacency_YieldChanges", adj, "YieldType", "")
        zh = YIELD_ZH.get(yt)
        if zh is None:
            REPORT.skip("产出类型不在字段说明 §五 枚举内（整行跳过）",
                        "%s@%s（%s）" % (did, aid, yt))
            continue
        cat, tid, problem = classify_target(db, adj)
        if problem:
            REPORT.skip("目标类别无法映射（整行跳过）：%s" % problem,
                        "%s@%s" % (did, aid))
            continue
        rid = "%s@%s" % (did, aid)
        if rid in seen:
            REPORT.warn("规则id 撞车：%s（District_Adjacencies 里出现了重复挂接）" % rid)
            continue
        seen[rid] = True
        desc = db.get("Adjacency_YieldChanges", adj, "Description", "")
        rows.append([
            rid, did, cat, tid, zh,
            db.get("Adjacency_YieldChanges", adj, "YieldChange", "0"),
            db.get("Adjacency_YieldChanges", adj, "TilesRequired", "1"),
            or_none(db.get("Adjacency_YieldChanges", adj, "PrereqTech")),
            or_none(db.get("Adjacency_YieldChanges", adj, "PrereqCivic")),
            or_none(db.get("Adjacency_YieldChanges", adj, "ObsoleteTech")),
            or_none(db.get("Adjacency_YieldChanges", adj, "ObsoleteCivic")),
            aid,
            loc(desc) if desc else NONE] + PROV)
    imp_used = set(r.get("YieldChangeId") for r in db.rows("Improvement_Adjacencies"))
    for aid in sorted(set(adj_by_id) - used):
        if aid in imp_used:
            REPORT.skip("相邻规则挂在改良设施上而非区域上（Improvement_Adjacencies，"
                        "adjacency_rules.区域id 装不下，本轮不收）", aid)
        else:
            REPORT.skip("相邻规则没有任何挂接方（区域与改良设施都没引用它，"
                        "是游戏数据里的孤立行）", aid)
    rows.sort(key=lambda x: (x[1], x[0]))
    return ["规则id", "区域id", "目标类别", "目标id", "产出类型", "加成值",
            "所需数量", "前置科技", "前置市政", "废弃科技", "废弃市政",
            "原始标识", "备注", "数据来源", "待核"], rows


# ── 七、主流程 ──────────────────────────────────────────────────────────
def main(argv):
    ap = argparse.ArgumentParser(
        description="把文明 6 的 XML 玩法数据解析成本项目的配置表 CSV")
    ap.add_argument("--assets", default=DEFAULT_ASSETS,
                    help="文明 6 的 Assets 目录。默认按 $%s → 各平台 Steam/Epic "
                         "默认位置 依次查找" % CIV6_ASSETS_ENV)
    here = pathlib.Path(__file__).resolve().parent.parent
    ap.add_argument("--out", default=str(here / "配置表"), help="输出目录")
    ap.add_argument("--modes", action="store_true",
                    help="额外载入可选游戏模式内容（英雄、秘社、戏剧时代…），默认不载入")
    ap.add_argument("--dump-table", default=None,
                    help="不写 CSV，只打印解析后的某张游戏原始表（人工对账用）")
    ap.add_argument("--grep", default=None, help="配合 --dump-table 过滤行")
    args = ap.parse_args(argv)

    assets = pathlib.Path(args.assets).expanduser()
    if not assets.is_dir():
        die("Assets 目录不存在：%s\n"
            "   用 --assets 指定，或设环境变量 %s" % (assets, CIV6_ASSETS_ENV))
    sql = assets / "Base/Assets/Gameplay/Data/Schema/01_GameplaySchema.sql"
    if not sql.exists():
        die("找不到表结构文件：%s" % sql)

    schema = load_schema(sql)
    for t in NEEDED_TABLES:
        if t not in schema or not schema[t]["pk"]:
            die("表结构里没有 %s 的主键，无法安全重放 Replace/InsertOrIgnore" % t)

    data_files, text_files = plan_files(assets, args.modes)
    db = DB(schema)
    for label, path in data_files:
        db.apply_file(label, path)

    loc = Loc()
    for label, path in text_files:
        loc.load(label, path)

    if args.dump_table:
        t = args.dump_table
        if t not in db.tables:
            die("未重放该表：%s（可加进 NEEDED_TABLES）" % t)
        pk = schema[t]["pk"]
        rows = db.rows(t)
        if args.grep:
            rows = [r for r in rows
                    if any(args.grep in str(v) for v in r.values())]
        print("表 %s：主键 %s｜默认值 %s" % (t, pk, schema[t]["defaults"]))
        print("共 %d 行（过滤后 %d 行）" % (len(db.rows(t)), len(rows)))
        for r in sorted(rows, key=lambda r: tuple(r.get(c, "") for c in pk)):
            print("  " + "  ".join("%s=%s" % (k, r[k]) for k in sorted(r)))
        return 0

    out = pathlib.Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)

    tables = OrderedDict()
    tables["terrains.csv"] = gen_terrains(db, loc)
    tables["features.csv"] = gen_features(db, loc)
    tables["resources.csv"] = gen_resources(db, loc)
    tables["wonders.csv"] = gen_wonders(db, loc)
    tables["techs.csv"] = gen_techs(db, loc)
    tables["civics.csv"] = gen_civics(db, loc)
    tables["improvements.csv"] = gen_improvements(db, loc)
    tables["districts.csv"] = gen_districts(db, loc)
    tables["buildings.csv"] = gen_buildings(db, loc)
    tables["civs.csv"] = gen_civs(db, loc)
    civ_ids = set(r[0] for r in tables["civs.csv"][1])
    tables["leaders.csv"] = gen_leaders(db, loc, civ_ids)
    tables["adjacency_rules.csv"] = gen_adjacency(db, loc)
    tables["excluded_adjacencies.csv"] = gen_excluded(db, loc)

    for name, (header, rows) in tables.items():
        write_csv(out / name, header, rows)

    # ── 报告 ────────────────────────────────────────────────────────────
    print("《文明 VI》数据解析报告")
    print("Assets：%s" % assets)
    print("规则集：%s｜游戏核心：%s｜可选游戏模式：%s"
          % (TARGET_RULESET, TARGET_GAMECORE, "载入" if args.modes else "不载入"))
    print("加载顺序取自各 DLC 的 .modinfo（InGameActions/UpdateDatabase，"
          "按 criteria 过滤、按 LoadOrder 排序）")
    print("数据文件 %d 个｜文本文件 %d 个" % (len(data_files), len(text_files)))
    print("输出目录：%s" % out)

    print("\n一、各表行数")
    for name, (header, rows) in tables.items():
        print("  %-22s %5d 行" % (name, len(rows)))

    print("\n二、游戏原始表：行级操作与最终行数")
    print("  %-28s %6s %6s %6s %6s %6s %8s %8s"
          % ("表", "Row", "Repl", "InsIg", "Del", "Upd", "删中行", "改中行"))
    for t in NEEDED_TABLES:
        c = db.op_counts
        print("  %-28s %6d %6d %6d %6d %6d %8d %8d   → 最终 %d 行"
              % (t, c[(t, "Row")], c[(t, "Replace")], c[(t, "InsertOrIgnore")],
                 c[(t, "Delete")], c[(t, "Update")],
                 db.delete_hits[t], db.update_hits[t], len(db.rows(t))))

    print("\n三、各来源文件贡献的插入行数（只列相邻规则四张表，其余同理）")
    key_tables = ["Adjacency_YieldChanges", "District_Adjacencies",
                  "Districts", "DistrictReplaces"]
    by_file = defaultdict(list)
    for (label, tname), n in db.rows_by_file.items():
        if tname in key_tables:
            by_file[label].append((tname, n))
    for label in sorted(by_file):
        print("  %-52s %s" % (label,
              "，".join("%s %d" % (t, n) for t, n in sorted(by_file[label]))))

    if db.pk_collisions:
        print("\n⚠ 主键撞车 %d 处（同一主键被 <Row> 插入两次，"
              "通常意味着加载顺序把同一份内容重放了两遍）：" % len(db.pk_collisions))
        for label, t, key in db.pk_collisions[:20]:
            print("   %s  %s  %s" % (label, t, key))

    print("\n四、被跳过的内容（逐条说明原因，不静默丢弃）")
    if not REPORT.skips:
        print("  无")
    for reason in sorted(REPORT.skips):
        items = REPORT.skips[reason]
        head = "、".join(items[:8]) + ("…" if len(items) > 8 else "")
        print("  [%d 条] %s\n        %s" % (len(items), reason, head))

    print("\n五、警告")
    if not REPORT.warns:
        print("  无")
    for w in REPORT.warns:
        print("  ⚠ %s" % w)

    print("\n六、推断字段（不是游戏数据里的直接对应列，逐项说明依据）")
    for line in [
        "districts.区域类别        CityCenter=true→城市中心；RequiresPopulation=true→专业化；"
        "否则非专业化",
        "districts.是否占区域配额  ＝ Districts.RequiresPopulation。文明 6 没有「占配额」列，"
        "区域上限由人口决定",
        "districts.基础产出        恒为「无」。文明 6 的区域本身没有产出表；"
        "District_CitizenYieldChanges 是每市民产出，语义不同",
        "districts.可建地形        取 District_ValidTerrains；该表为空而 Coast=true 时"
        "补为浅水地形（TERRAIN_COAST），否则港口会被写成「不限」",
        "terrains.是否可建区域     Impassable=true→否；水域地形里只有浅水"
        "（ShallowWater=true）为是，深海为否",
        "features.是否可建区域     NaturalWonder 或 Impassable→否，其余为是",
        "features.是否需移除       ＝ Features.Removable（可被工人移除）",
        "resources.是否海洋资源    ＝「可出现在水域」（SeaFrequency>0 或 AdjacentToLand）。"
        "琥珀、石油这类水陆都能出的资源也算是，与相邻规则的 AdjacentSeaResource 语义一致",
        "civs.是否首期纳入         来自脚本里的 FIRST_ROUND_CIVS 常量（设计决定，"
        "不在游戏数据里）：韩国/希腊/德国/高卢/越南",
        "leaders.是否首期纳入      ＝其所属文明是否在 FIRST_ROUND_CIVS 内",
        "civs.文明能力/leaders.领袖能力  由 Traits 的 Name/Description 本地化文本拼成，"
        "未做结构化建模",
    ]:
        print("  " + line)

    print("\n七、下一步：python3 Tools/check_config.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
