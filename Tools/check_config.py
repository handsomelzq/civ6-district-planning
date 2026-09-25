#!/usr/bin/env python3
"""配置表一致性检查。改完 CSV 跑一遍：python3 Tools/check_config.py

只用标准库，系统 python3 即可，不需要建 venv。

模式：
  （默认）       检查已存在的表；缺表只警告
  --delivery    交付模式：缺表、待核=是、依赖未决项的母题，一律视为错误
  --schema      打印各表的期望列，供 parse_civ6_xml.py 的作者对照
  --dir <路径>   改从指定目录读表（默认 ../配置表）。
                 用途：回归测试指向 Tools/testdata/；或在替换正式表之前
                 先校验一批候选表。

回归测试：python3 Tools/test_check_config.py

⚠️ 下面的 SCHEMA 与 ENUMS 是 ../配置表/字段说明.md 的代码镜像。
   **字段说明.md 才是唯一事实来源**，改了那边必须同步改这里。
   校验规则编号对应 字段说明.md §七。
"""
import csv, sys, pathlib, re
from collections import defaultdict

BASE = pathlib.Path(__file__).resolve().parent.parent / "配置表"

# ---------------------------------------------------------------- 枚举
ENUMS = {
    "产出类型": {"科技", "文化", "金币", "生产力", "信仰", "粮食"},
    # 目标类别与文明 6 原字段的映射见 设计/SDD-局面求值器.md §3.4（已由一手数据确定）
    "目标类别": {"地形", "地貌", "区域", "改良设施", "资源类别", "任意其他区域",
                 "海洋资源", "河流", "世界奇观", "自身", "自然奇观",
                 "任意资源", "无目标"},
    "资源类别": {"加成", "奢侈", "战略", "魔力节点", "文物"},
    "区域类别": {"城市中心", "专业化", "非专业化"},
    "兵种类别": {"近战", "反骑兵", "轻骑兵", "重骑兵", "远程",
                 "远程骑兵", "攻城", "海上", "支援"},
    "修正通道": {"战斗力", "远程战斗力", "攻城战斗力"},
    "作用时机": {"攻击时", "防御时", "始终"},
    "条件类别": {"地形", "地貌", "工事", "河流", "大人物", "编组", "兵种对抗",
                 "侧翼", "支援", "受损", "资源短缺", "外交可见度", "晋升",
                 "政策卡", "宗教", "奇观", "文明领袖", "难度"},
    "数据来源": {"一手", "二手"},
    "母题": {"A", "B", "C", "D", "E", "F", "无"},
    # 关卡类别（关卡设计.md §1.1/§1.2）：普通关要求贪心失败；教学关与对照关各有
    # 自己的判据 —— 对照关的判据是「交叉代入劣化」，由 §1.2 定义。
    "关卡类别": {"普通", "教学", "对照"},
    # 目标形态（SDD-挑战模式.md §3.2）。多产出的目标值写成 `产出类型:值` 用 | 分隔。
    "目标类型": {"单一产出达标", "多产出同时达标", "军事叠力达标"},
}
BOOL = {"是", "否"}
# 依赖未决项、不得进入交付关卡的母题（关卡设计.md §3）
BLOCKED_MOTIFS = {"D", "F"}

# ---------------------------------------------------------------- 表结构
# cols: 期望列；id: 主键列；prov: 是否要求带 数据来源/待核 两列（生成表要求）
SCHEMA = {
    "terrains.csv": dict(id="地形id", prov=True, cols=[
        "地形id", "名称", "基础产出", "是否可建区域", "备注"]),
    "features.csv": dict(id="地貌id", prov=True, cols=[
        "地貌id", "名称", "基础产出", "是否可建区域", "是否需移除", "备注"]),
    "resources.csv": dict(id="资源id", prov=True, cols=[
        "资源id", "名称", "资源类别", "是否海洋资源", "基础产出", "备注"]),
    "wonders.csv": dict(id="奇观id", prov=True, cols=[
        "奇观id", "名称", "基础产出", "占用格数", "备注"]),
    "techs.csv": dict(id="科技id", prov=True, cols=[
        "科技id", "名称", "时代", "备注"]),
    "civics.csv": dict(id="市政id", prov=True, cols=[
        "市政id", "名称", "时代", "备注"]),
    "improvements.csv": dict(id="改良设施id", prov=True, cols=[
        "改良设施id", "名称", "基础产出", "可建地形", "前置科技",
        "前置市政", "备注"]),
    "districts.csv": dict(id="区域id", prov=True, cols=[
        "区域id", "名称", "区域类别", "基础产出", "生产成本", "前置科技",
        "前置市政", "是否占区域配额", "可建地形", "是否特色区域",
        "替换区域id", "所属文明id", "备注"]),
    "buildings.csv": dict(id="建筑id", prov=True, cols=[
        "建筑id", "名称", "所属区域id", "基础产出", "生产成本",
        "前置科技", "前置市政", "前置建筑id", "备注"]),
    "units.csv": dict(id="单位id", prov=True, cols=[
        "单位id", "名称", "兵种类别", "时代", "基础战斗力", "基础远程战斗力",
        "基础攻城战斗力", "前置科技", "前置市政", "战略资源需求",
        "是否特色单位", "替换单位id", "所属文明id", "备注"]),
    "adjacency_rules.csv": dict(id="规则id", prov=True, cols=[
        "规则id", "区域id", "目标类别", "目标id", "产出类型", "加成值",
        "所需数量", "前置科技", "前置市政", "废弃科技", "废弃市政",
        "原始标识", "备注"]),
    "excluded_adjacencies.csv": dict(id=None, prov=True, cols=[
        "traitid", "所属文明id", "所属领袖id", "被排除规则标识", "备注"]),
    "combat_modifiers.csv": dict(id="修正id", prov=True, cols=[
        "修正id", "名称", "条件类别", "条件参数", "修正通道", "修正值",
        "作用时机", "是否可叠加", "叠加上限", "备注"]),
    "civs.csv": dict(id="文明id", prov=True, cols=[
        "文明id", "名称", "特色区域id", "文明能力", "是否首期纳入", "备注"]),
    "leaders.csv": dict(id="领袖id", prov=True, cols=[
        "领袖id", "名称", "所属文明id", "领袖能力", "是否首期纳入", "备注"]),
    # 手工表：关卡是原创设计内容，不要求 数据来源/待核
    "levels.csv": dict(id="关卡id", prov=False, cols=[
        "关卡id", "名称", "文明id", "领袖id", "已解锁科技", "已解锁市政",
        "城市中心坐标", "人口", "目标类型", "目标产出类型", "目标值",
        "约束类型", "约束值", "三星阈值", "二星阈值",
        "关卡类别", "母题", "贪心基线结果"]),
    "level_tiles.csv": dict(id=None, prov=False, cols=[
        "关卡id", "坐标", "地形", "地貌", "资源", "自然奇观",
        "河流边", "初始区域", "初始建筑"]),
}

# 目标类别 → (表名, 主键列)；None 表示该类别的 目标id 必须为「无」
TARGET_TABLE = {
    "地形": ("terrains.csv", "地形id"),
    "地貌": ("features.csv", "地貌id"),
    "区域": ("districts.csv", "区域id"),
    "改良设施": ("improvements.csv", "改良设施id"),
}
# 这些类别是布尔型（原字段值为 true），目标id 必须为「无」
BOOL_TARGETS = {"任意其他区域", "海洋资源", "河流", "世界奇观",
                "自身", "自然奇观", "任意资源", "无目标"}
# 这个类别的目标id 是资源类别枚举，不是某张表的 id
ENUM_TARGETS = {"资源类别": "资源类别"}

ERR, WARN = [], []
def err(m):  ERR.append(m)
def warn(m): WARN.append(m)

# ---------------------------------------------------------------- 工具
def load(name):
    """返回 (rows, headers)；表不存在返回 None。"""
    p = BASE / name
    if not p.exists():
        return None
    with open(p, encoding="utf-8-sig", newline="") as fh:
        rd = csv.DictReader(fh)
        return list(rd), (rd.fieldnames or [])

def ids(t, col):
    return {r[col].strip() for r in t if r.get(col, "").strip()} if t else set()

def is_int(v):
    return bool(re.fullmatch(r"-?\d+", v.strip()))

def is_num(v):
    return bool(re.fullmatch(r"-?\d+(\.\d+)?", v.strip()))


def parse_goal(v):
    """解析 `目标值` / `贪心基线结果`，两种形态都要支持：

      "4.5"                  → {None: 4.5}            单产出
      "科技:3.5|信仰:3.5"     → {"科技":3.5, "信仰":3.5} 多产出（SDD-挑战模式 §3.2）

    不可解析返回 None。多产出的两个字段必须用**同一种形态**，否则 §七 规则 14
    没法逐项比较 —— 这也是为什么 `贪心基线结果` 在多产出关卡里也写成向量。
    """
    v = (v or "").strip()
    if not v:
        return None
    if is_num(v):
        return {None: float(v)}
    out = {}
    for part in v.split("|"):
        if ":" not in part:
            return None
        k, _, x = part.partition(":")
        if not is_num(x) or not k.strip():
            return None
        out[k.strip()] = float(x)
    return out or None


def check_kv(tag, rid, col, val):
    """校验 `键:值|键:值` 或 `无` 形式的字段。"""
    v = val.strip()
    if v in ("", "无"):
        return
    for part in v.split("|"):
        if ":" not in part:
            err(f"{tag} {rid} 的「{col}」格式非法：{part}（应为 键:值，空值写 无）")
        else:
            k, _, n = part.partition(":")
            if col == "基础产出" and k not in ENUMS["产出类型"]:
                err(f"{tag} {rid} 的「{col}」产出类型不在枚举内：{k}")
            if col == "基础产出" and not is_num(n):
                err(f"{tag} {rid} 的「{col}」数值非法：{part}")

def check_enum(tag, rid, col, val, enum_name):
    v = val.strip()
    if v and v not in ENUMS[enum_name]:
        err(f"{tag} {rid} 的「{col}」取值不在枚举内：{v}"
            f"（若确为合法新值，先更新 配置表/字段说明.md §五）")

def check_bool(tag, rid, col, val):
    v = val.strip()
    if v and v not in BOOL:
        err(f"{tag} {rid} 的「{col}」应为 是/否，实为：{v}")

def check_fk(tag, rid, col, val, pool, pool_name, allow_none=True):
    """pool 为 None 表示目标表尚未生成 —— 跳过本检查。

    否则一张表没生成就会让所有指向它的外键集体报错，把真正的问题淹掉。
    缺表本身已在主流程里报过一次。"""
    if pool is None:
        return
    v = val.strip()
    if not v or (allow_none and v == "无"):
        return
    for one in v.split("|"):
        if one.strip() and one.strip() not in pool:
            err(f"{tag} {rid} 的「{col}」引用了不存在的 {pool_name}：{one.strip()}")

# ---------------------------------------------------------------- 主流程
def parse_dir(argv):
    """取出 --dir 指定的目录；未指定则用默认的 ../配置表。"""
    for i, a in enumerate(argv):
        if a == "--dir" and i + 1 < len(argv):
            return pathlib.Path(argv[i + 1]).expanduser()
        if a.startswith("--dir="):
            return pathlib.Path(a.split("=", 1)[1]).expanduser()
    return None


def main(argv):
    global BASE
    d = parse_dir(argv)
    if d is not None:
        if not d.is_dir():
            print(f"✗ --dir 指定的目录不存在：{d}")
            return 2
        BASE = d.resolve()
    delivery = "--delivery" in argv
    if "--schema" in argv:
        print("各表期望列（唯一事实来源：配置表/字段说明.md）\n")
        for n, s in SCHEMA.items():
            extra = " + 数据来源, 待核" if s["prov"] else ""
            print(f"{n}\n  {', '.join(s['cols'])}{extra}\n")
        return 0

    T = {}
    missing = []
    for name in SCHEMA:
        got = load(name)
        if got is None:
            missing.append(name)
        else:
            T[name] = got

    for name in missing:
        (err if delivery else warn)(f"表不存在：{name}")

    # 规则 1（结构）：列齐全 + 生成表必带来源两列
    for name, (rows, heads) in T.items():
        s = SCHEMA[name]
        want = list(s["cols"]) + (["数据来源", "待核"] if s["prov"] else [])
        for c in want:
            if c not in heads:
                err(f"{name} 缺少列：{c}")
        for c in heads:
            if c not in want:
                warn(f"{name} 多出未定义的列：{c}（字段说明.md 未收录）")

    def rows_of(name):
        return T[name][0] if name in T else []

    def has(name, *cols):
        if name not in T:
            return False
        return all(c in T[name][1] for c in cols)

    # id 池；表未生成则为 None（check_fk 会跳过，见其 docstring）
    P = {n: (ids(rows_of(n), s["id"]) if n in T else None)
         for n, s in SCHEMA.items() if s["id"]}

    def pool(name):
        return P.get(name)

    # 规则 3：主键唯一
    for name, s in SCHEMA.items():
        if not s["id"] or name not in T:
            continue
        seen, dup = set(), set()
        for r in rows_of(name):
            v = r.get(s["id"], "").strip()
            if not v:
                err(f"{name} 存在空的 {s['id']}")
            elif v in seen:
                dup.add(v)
            else:
                seen.add(v)
        for d in sorted(dup):
            err(f"{name} 的 {s['id']} 重复：{d}")

    # 各表字段级校验
    for r in rows_of("terrains.csv"):
        i = r.get("地形id", "?")
        check_kv("terrains", i, "基础产出", r.get("基础产出", ""))
        check_bool("terrains", i, "是否可建区域", r.get("是否可建区域", ""))

    for r in rows_of("features.csv"):
        i = r.get("地貌id", "?")
        check_kv("features", i, "基础产出", r.get("基础产出", ""))
        check_bool("features", i, "是否可建区域", r.get("是否可建区域", ""))
        check_bool("features", i, "是否需移除", r.get("是否需移除", ""))

    for r in rows_of("resources.csv"):
        i = r.get("资源id", "?")
        check_enum("resources", i, "资源类别", r.get("资源类别", ""), "资源类别")
        check_bool("resources", i, "是否海洋资源", r.get("是否海洋资源", ""))
        check_kv("resources", i, "基础产出", r.get("基础产出", ""))

    for r in rows_of("wonders.csv"):
        check_kv("wonders", r.get("奇观id", "?"), "基础产出", r.get("基础产出", ""))

    # 规则 6：特色区域三列一致性
    for r in rows_of("districts.csv"):
        i = r.get("区域id", "?")
        check_enum("districts", i, "区域类别", r.get("区域类别", ""), "区域类别")
        check_kv("districts", i, "基础产出", r.get("基础产出", ""))
        check_bool("districts", i, "是否占区域配额", r.get("是否占区域配额", ""))
        check_bool("districts", i, "是否特色区域", r.get("是否特色区域", ""))
        check_fk("districts", i, "可建地形", r.get("可建地形", ""),
                 pool("terrains.csv"), "地形")
        uniq = r.get("是否特色区域", "").strip() == "是"
        rep, civ = r.get("替换区域id", "无").strip(), r.get("所属文明id", "无").strip()
        if uniq:
            if rep == "无" or civ == "无":
                err(f"districts {i} 是特色区域，但「替换区域id」或「所属文明id」为无")
            check_fk("districts", i, "替换区域id", rep,
                     pool("districts.csv"), "区域")
            check_fk("districts", i, "所属文明id", civ,
                     pool("civs.csv"), "文明")
            if rep == i:
                err(f"districts {i} 的「替换区域id」指向自身")
        elif rep != "无" or civ != "无":
            err(f"districts {i} 不是特色区域，但「替换区域id」或「所属文明id」非无")

    for r in rows_of("improvements.csv"):
        i = r.get("改良设施id", "?")
        check_kv("improvements", i, "基础产出", r.get("基础产出", ""))
        check_fk("improvements", i, "可建地形", r.get("可建地形", ""),
                 pool("terrains.csv"), "地形")

    # 规则 1：buildings 外键
    for r in rows_of("buildings.csv"):
        i = r.get("建筑id", "?")
        check_kv("buildings", i, "基础产出", r.get("基础产出", ""))
        check_fk("buildings", i, "所属区域id", r.get("所属区域id", ""),
                 pool("districts.csv"), "区域", allow_none=False)
        check_fk("buildings", i, "前置建筑id", r.get("前置建筑id", ""),
                 pool("buildings.csv"), "建筑")

    # 规则 12：units.时代 非空
    for r in rows_of("units.csv"):
        i = r.get("单位id", "?")
        check_enum("units", i, "兵种类别", r.get("兵种类别", ""), "兵种类别")
        if r.get("时代", "").strip() in ("", "无"):
            err(f"units {i} 的「时代」为空（大将军的时代匹配依赖它）")
        if not is_int(r.get("基础战斗力", "")):
            err(f"units {i} 的「基础战斗力」非整数：{r.get('基础战斗力','')}")
        check_fk("units", i, "战略资源需求", r.get("战略资源需求", ""),
                 pool("resources.csv"), "资源")

    # 规则 1/2/4/5：adjacency_rules —— 多态外键 + 加成值恒正
    for r in rows_of("adjacency_rules.csv"):
        i = r.get("规则id", "?")
        check_fk("adjacency", i, "区域id", r.get("区域id", ""),
                 pool("districts.csv"), "区域", allow_none=False)
        cat = r.get("目标类别", "").strip()
        check_enum("adjacency", i, "目标类别", cat, "目标类别")
        check_enum("adjacency", i, "产出类型", r.get("产出类型", ""), "产出类型")
        tid = r.get("目标id", "无").strip()
        if cat in TARGET_TABLE:
            tbl, _ = TARGET_TABLE[cat]
            if tid == "无":
                err(f"adjacency {i} 目标类别为「{cat}」时必须给出具体目标id")
            else:
                check_fk("adjacency", i, "目标id", tid, pool(tbl), f"{cat}（{tbl}）")
        elif cat in ENUM_TARGETS:
            check_enum("adjacency", i, "目标id", tid, ENUM_TARGETS[cat])
        elif cat in BOOL_TARGETS:
            if tid != "无":
                err(f"adjacency {i} 目标类别为「{cat}」是布尔型，"
                    f"目标id 应为无，实为 {tid}")
        # 规则 5：加成值非零；负值合法但罕见，给警告不给错误。
        #   文明 6 全库仅 1 条负值（韩国书院），所以新出现的负值大概率是配错。
        #   combat_modifiers 的负值是常态，连警告都不给。
        v = r.get("加成值", "").strip()
        if not is_num(v):
            err(f"adjacency {i} 的「加成值」非数值：{v}")
        elif float(v) == 0:
            err(f"adjacency {i} 的「加成值」为 0，无意义")
        elif float(v) < 0:
            warn(f"adjacency {i} 的「加成值」为负：{v}"
                 f"（合法但罕见——文明 6 中仅韩国书院一条，请确认不是配错）")
        # 规则 4：所需数量 >= 1
        n = r.get("所需数量", "").strip()
        if not is_int(n):
            err(f"adjacency {i} 的「所需数量」非整数：{n}")
        elif int(n) < 1:
            err(f"adjacency {i} 的「所需数量」小于 1：{n}")

    # 规则 10/11：combat_modifiers —— 允许负值
    for r in rows_of("combat_modifiers.csv"):
        i = r.get("修正id", "?")
        check_enum("combat", i, "条件类别", r.get("条件类别", ""), "条件类别")
        check_enum("combat", i, "修正通道", r.get("修正通道", ""), "修正通道")
        check_enum("combat", i, "作用时机", r.get("作用时机", ""), "作用时机")
        check_bool("combat", i, "是否可叠加", r.get("是否可叠加", ""))
        if not is_num(r.get("修正值", "")):
            err(f"combat {i} 的「修正值」非数值：{r.get('修正值','')}")
        stack, cap = r.get("是否可叠加", "").strip(), r.get("叠加上限", "无").strip()
        if stack == "否" and cap != "无":
            err(f"combat {i}「是否可叠加=否」但「叠加上限」不是无：{cap}")
        if stack == "是" and cap != "无" and not is_int(cap):
            err(f"combat {i} 的「叠加上限」非整数：{cap}")
        # 条件参数里引用的 id
        cp = r.get("条件参数", "无").strip()
        if cp not in ("", "无"):
            for part in cp.split("|"):
                k, _, v = part.partition(":")
                if k == "地形":
                    check_fk("combat", i, "条件参数.地形", v,
                             pool("terrains.csv"), "地形")
                elif k == "地貌":
                    check_fk("combat", i, "条件参数.地貌", v,
                             pool("features.csv"), "地貌")
                elif k == "单位":
                    check_fk("combat", i, "条件参数.单位", v,
                             pool("units.csv"), "单位")

    # 规则 7b：全项目范围的科技 / 市政引用校验
    #   一个拼错的科技 id 会让相邻规则静默失效（见 SDD-局面求值器 §3.2），
    #   所以这类引用必须逐处校验，不能因为「看起来只是个字符串」就放过。
    TECH_COLS = {
        "districts.csv": ("区域id", ["前置科技", "前置市政"]),
        "buildings.csv": ("建筑id", ["前置科技", "前置市政"]),
        "units.csv": ("单位id", ["前置科技", "前置市政"]),
        "improvements.csv": ("改良设施id", ["前置科技", "前置市政"]),
        "adjacency_rules.csv": ("规则id",
                                ["前置科技", "前置市政", "废弃科技", "废弃市政"]),
    }
    for name, (idcol, cols) in TECH_COLS.items():
        for r in rows_of(name):
            i = r.get(idcol, "?")
            for c in cols:
                tgt = "techs.csv" if "科技" in c else "civics.csv"
                lbl = "科技" if "科技" in c else "市政"
                check_fk(name.removesuffix(".csv"), i, c, r.get(c, ""),
                         pool(tgt), lbl)

    # excluded_adjacencies：trait 排除某条相邻规则（高卢/日本的核心特性）
    #   「被排除规则标识」指向的是裸游戏 id，住在 adjacency_rules.原始标识 里，
    #   不是主键列，所以单独建池。
    raw_ids = ({r.get("原始标识", "").strip()
                for r in rows_of("adjacency_rules.csv")} if "adjacency_rules.csv" in T
               else None)
    for r in rows_of("excluded_adjacencies.csv"):
        i = r.get("traitid", "?")
        civ, lead = r.get("所属文明id", "无").strip(), r.get("所属领袖id", "无").strip()
        if civ == "无" and lead == "无":
            err(f"excluded {i} 的「所属文明id」与「所属领袖id」同时为无，"
                f"该排除规则无归属")
        check_fk("excluded", i, "所属文明id", civ, pool("civs.csv"), "文明")
        check_fk("excluded", i, "所属领袖id", lead, pool("leaders.csv"), "领袖")
        check_fk("excluded", i, "被排除规则标识", r.get("被排除规则标识", ""),
                 raw_ids, "相邻规则原始标识", allow_none=False)

    for r in rows_of("civs.csv"):
        i = r.get("文明id", "?")
        check_bool("civs", i, "是否首期纳入", r.get("是否首期纳入", ""))
        check_fk("civs", i, "特色区域id", r.get("特色区域id", ""),
                 pool("districts.csv"), "区域")

    for r in rows_of("leaders.csv"):
        i = r.get("领袖id", "?")
        check_bool("leaders", i, "是否首期纳入", r.get("是否首期纳入", ""))
        check_fk("leaders", i, "所属文明id", r.get("所属文明id", ""),
                 pool("civs.csv"), "文明", allow_none=False)

    # 规则 7/14/15：levels
    for r in rows_of("levels.csv"):
        i = r.get("关卡id", "?")
        check_fk("levels", i, "文明id", r.get("文明id", ""),
                 pool("civs.csv"), "文明", allow_none=False)
        check_fk("levels", i, "领袖id", r.get("领袖id", ""),
                 pool("leaders.csv"), "领袖", allow_none=False)
        check_fk("levels", i, "已解锁科技", r.get("已解锁科技", ""),
                 pool("techs.csv"), "科技")
        check_fk("levels", i, "已解锁市政", r.get("已解锁市政", ""),
                 pool("civics.csv"), "市政")
        # 母题可以是组合，用 `+` 连接（L-07 = B+C，L-10 = B+C+E），逐段校验
        motifs = [x.strip() for x in (r.get("母题") or "无").split("+")]
        for m in motifs:
            check_enum("levels", i, "母题", m, "母题")
        check_enum("levels", i, "关卡类别", r.get("关卡类别", ""), "关卡类别")
        check_enum("levels", i, "目标类型", r.get("目标类型", ""), "目标类型")
        if not re.fullmatch(r"-?\d+,-?\d+", r.get("城市中心坐标", "").strip()):
            err(f"levels {i} 的「城市中心坐标」格式非法（应为 q,r）："
                f"{r.get('城市中心坐标','')}")
        goal = parse_goal(r.get("目标值", ""))
        if goal is None:
            err(f"levels {i} 的「目标值」格式非法（应为数值，或 `产出类型:值` 用 | 分隔）："
                f"{r.get('目标值','')}")
        multi = r.get("目标类型", "").strip() == "多产出同时达标"
        if goal is not None and multi and None in goal:
            err(f"levels {i} 是多产出关卡，「目标值」必须写成 `产出类型:值`："
                f"{r.get('目标值','')}")
        if goal is not None and not multi and None not in goal:
            err(f"levels {i} 不是多产出关卡，「目标值」不该是向量：{r.get('目标值','')}")
        for c in ("约束值", "人口"):
            if not is_num(r.get(c, "")):
                err(f"levels {i} 的「{c}」非数值：{r.get(c,'')}")
        if is_num(r.get("约束值", "")) and float(r["约束值"]) <= 0:
            err(f"levels {i} 的「约束值」不为正（见 SDD-挑战模式 边界 G3）")
        # 规则 9 / 14：贪心基线。
        #   只有「普通」关要求贪心失败。教学关（§1.1）与对照关（§1.2）各有自己的
        #   判据：教学关本就要让贪心能过，对照关的判据是交叉代入劣化，而韩国书院
        #   这类全负交互的规则集在结构上不可能让贪心失败。
        #
        #   多产出关卡按**逐项**比较，不比合计：贪心可能把预算全倒进一种产出，
        #   合计超过目标合计却有一项没达标 —— 比合计会把合格关卡误判成不合格。
        #   这也是为什么多产出关卡的 `贪心基线结果` 也写成向量。
        exempt = r.get("关卡类别", "").strip() in ("教学", "对照")
        base_raw = r.get("贪心基线结果", "").strip()
        base = parse_goal(base_raw)
        if base_raw in ("", "无"):
            (err if delivery else warn)(
                f"levels {i} 的「贪心基线结果」为空"
                f"（见 SDD-挑战模式 边界 G10，交付模式下为错误）")
        elif base is None:
            err(f"levels {i} 的「贪心基线结果」格式非法：{base_raw}")
        elif goal is not None and set(base) != set(goal):
            err(f"levels {i} 的「贪心基线结果」与「目标值」形态不一致，无法比较："
                f"{base_raw} vs {r.get('目标值','')}")
        elif goal is not None and not exempt:
            if all(base[y] >= goal[y] for y in goal):
                err(f"levels {i} 贪心基线 {base_raw} 已达成目标 {r['目标值']}，"
                    f"关卡不合格（关卡设计.md §5.2）")
        # 规则 15：依赖未决项的母题不得进交付。母题可以是组合，任一段被阻塞即拦。
        blocked = [m for m in motifs if m in BLOCKED_MOTIFS]
        if blocked:
            (err if delivery else warn)(
                f"levels {i} 的母题 {'+'.join(blocked)} 依赖未决项，"
                f"不得进入交付（关卡设计.md §3）")
        # 星级阈值是**产出值**（2026-09-25 改，见 设计/关卡设计.md §8）：
        #   必须满足 目标值 ≤ 二星阈值 ≤ 三星阈值。
        #   二星＝三星是允许的：产出粒度 0.5，V−T<1 的紧关卡放不下三档。
        #   多产出关卡的星级阈值是**各产出的合计**（单一标量），所以与目标值比较时
        #   用目标向量的合计。
        t3, t2 = r.get("三星阈值", ""), r.get("二星阈值", "")
        floor = sum(goal.values()) if goal else None
        if is_num(t3) and is_num(t2) and float(t3) < float(t2):
            err(f"levels {i} 三星阈值 {t3} 低于二星阈值 {t2}")
        if is_num(t2) and floor is not None and float(t2) < floor:
            err(f"levels {i} 二星阈值 {t2} 低于目标值 {r.get('目标值','')}"
                f"（星级阈值是产出值，必须 目标值 ≤ 二星 ≤ 三星）")

    # 规则 8：level_tiles
    lv_ids = pool("levels.csv") or set()
    seen_xy = defaultdict(set)
    for r in rows_of("level_tiles.csv"):
        lid, xy = r.get("关卡id", "").strip(), r.get("坐标", "").strip()
        tag = f"{lid}@{xy}"
        if "levels.csv" in T and lid not in lv_ids:
            err(f"level_tiles {tag} 的关卡id 不存在于 levels.csv")
        if not re.fullmatch(r"-?\d+,-?\d+", xy):
            err(f"level_tiles {tag} 坐标格式非法（应为 q,r）")
        elif xy in seen_xy[lid]:
            err(f"level_tiles 关卡 {lid} 坐标重复：{xy}")
        else:
            seen_xy[lid].add(xy)
        check_fk("level_tiles", tag, "地形", r.get("地形", ""),
                 pool("terrains.csv"), "地形", allow_none=False)
        check_fk("level_tiles", tag, "地貌", r.get("地貌", ""),
                 pool("features.csv"), "地貌")
        check_fk("level_tiles", tag, "资源", r.get("资源", ""),
                 pool("resources.csv"), "资源")
        check_fk("level_tiles", tag, "自然奇观", r.get("自然奇观", ""),
                 pool("wonders.csv"), "奇观")
        check_fk("level_tiles", tag, "初始区域", r.get("初始区域", ""),
                 pool("districts.csv"), "区域")
        check_fk("level_tiles", tag, "初始建筑", r.get("初始建筑", ""),
                 pool("buildings.csv"), "建筑")
    for lid in lv_ids:
        if lid not in seen_xy:
            warn(f"levels {lid} 在 level_tiles.csv 中没有任何地块")

    # 规则 18：对照关必须与另一关**同地形**。
    #   对照关的存在意义是「同一片地形，只换文明，最优布局结构性改变」
    #   （关卡设计.md §1.2、GDD §6 验证指标「文明有差异」）。地形只要差一格，
    #   这个结论就不成立 —— 差异可能来自地形而不是文明。所以这条必须机器校验。
    if "levels.csv" in T and "level_tiles.csv" in T:
        terra = defaultdict(dict)
        for r in rows_of("level_tiles.csv"):
            terra[r.get("关卡id", "").strip()][r.get("坐标", "").strip()] = (
                r.get("地形", ""), r.get("地貌", ""), r.get("资源", ""),
                r.get("自然奇观", ""), r.get("河流边", ""))
        for r in rows_of("levels.csv"):
            if r.get("关卡类别", "").strip() != "对照":
                continue
            i = r.get("关卡id", "?")
            mine = terra.get(i)
            twins = [o for o in terra if o != i and terra[o] == mine]
            if not mine:
                continue          # 已由上面的「没有任何地块」警告覆盖
            if not twins:
                err(f"levels {i} 是对照关，但没有任何另一关与它同地形"
                    f"（对照关必须成对，见 关卡设计.md §1.2）")
            elif all(r2.get("文明id") == r.get("文明id")
                     for r2 in rows_of("levels.csv") if r2.get("关卡id") in twins):
                err(f"levels {i} 的同地形关卡与它文明相同，对照不成立"
                    f"（对照关要换的是文明，不是地形，见 关卡设计.md §1.2）")

    # 规则 13：来源检查
    pending = defaultdict(int)
    for name, (rows, heads) in T.items():
        if not SCHEMA[name]["prov"] or "待核" not in heads:
            continue
        for r in rows:
            check_enum(name, r.get(SCHEMA[name]["id"] or "关卡id", "?"),
                       "数据来源", r.get("数据来源", ""), "数据来源")
            if r.get("待核", "").strip() == "是":
                pending[name] += 1
    for name, n in sorted(pending.items()):
        (err if delivery else warn)(
            f"{name} 有 {n} 行「待核=是」"
            f"（二手数据不得进入对外产物，见 立项书 §五 过渡期政策）")

    # ---------------------------------------------------------- 输出
    def dedup(xs):
        seen, out = set(), []
        for x in xs:
            if x not in seen:
                seen.add(x); out.append(x)
        return out

    for e in dedup(ERR):
        print("✗", e)
    for w in dedup(WARN):
        print("⚠", w)

    print()
    if d is not None:
        print(f"（读取目录：{BASE}）")
    if not T:
        print("配置表目录下还没有任何表。")
        print(f"期望的 {len(SCHEMA)} 张表：{'、'.join(SCHEMA)}")
        print("跑 `python3 Tools/check_config.py --schema` 看各表的期望列。")
    else:
        print(f"已检查 {len(T)}/{len(SCHEMA)} 张表：")
        for name in SCHEMA:
            if name in T:
                n = len(T[name][0])
                pn = pending.get(name, 0)
                mark = f"，其中 {pn} 行待核" if pn else ""
                print(f"  {name:24s} {n:5d} 行{mark}")
        if missing:
            print(f"未生成：{'、'.join(missing)}")

    print(f"\n模式：{'交付' if delivery else '开发'}"
          f"｜错误 {len(dedup(ERR))}｜警告 {len(dedup(WARN))}")
    if not ERR:
        print("没有错误。" if WARN else "全部检查通过。")
    return 1 if ERR else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
