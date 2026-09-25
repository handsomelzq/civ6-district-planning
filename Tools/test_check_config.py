#!/usr/bin/env python3
"""check_config.py 的回归测试。跑：python3 Tools/test_check_config.py

只用标准库。把 check_config.py 当子进程跑（顺带验证 CLI 本身），
对着 testdata/ 下三套数据断言结果。

改了校验规则就来这里加一条断言 —— 否则下次改坏了没人知道。
"""
import pathlib, re, shutil, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).resolve().parent
CHECKER = HERE / "check_config.py"
DATA = HERE / "testdata"

# broken/ 里每条数据都针对一个规则；下面逐条断言它真的被报出来。
# 左边是人类可读的规则名，右边是输出里必须出现的片段。
BROKEN_EXPECT = [
    ("结构·缺列",            "terrains.csv 缺少列：备注"),
    ("主键唯一·地形",        "terrains.csv 的 地形id 重复"),
    ("主键唯一·相邻规则",    "adjacency_rules.csv 的 规则id 重复"),
    ("键值格式·基础产出",    "「基础产出」格式非法"),
    ("布尔值",               "「是否可建区域」应为 是/否"),
    ("枚举·区域类别",        "「区域类别」取值不在枚举内"),
    ("枚举·目标类别",        "「目标类别」取值不在枚举内"),
    ("枚举·作用时机",        "「作用时机」取值不在枚举内"),
    ("外键·可建地形",        "「可建地形」引用了不存在的 地形"),
    ("外键·区域id",          "「区域id」引用了不存在的 区域"),
    ("外键·文明",            "「文明id」引用了不存在的 文明"),
    ("外键·领袖",            "「领袖id」引用了不存在的 领袖"),
    ("外键·初始建筑",        "「初始建筑」引用了不存在的 建筑"),
    ("规则7·已解锁科技",     "「已解锁科技」引用了不存在的 科技"),
    ("规则7b·前置科技",      "「前置科技」引用了不存在的 科技"),
    ("规则7b·前置市政",      "「前置市政」引用了不存在的 市政"),
    ("特色区域·非特色却填",  "不是特色区域，但"),
    ("特色区域·特色未填",    "是特色区域，但"),
    ("特色区域·自指",        "「替换区域id」指向自身"),
    ("相邻·加成值为零",      "「加成值」为 0"),
    ("相邻·所需数量≥1",      "「所需数量」小于 1"),
    ("相邻·布尔型不应填id",  "是布尔型"),
    ("相邻·改良设施需具体id","必须给出具体目标id"),
    ("相邻·资源类别枚举",    "「目标id」取值不在枚举内"),
    ("外键·改良设施可建地形","improvements IMPROVEMENT_MINE 的「可建地形」"),
    ("战斗·上限与可叠加",    "「是否可叠加=否」但「叠加上限」不是无"),
    ("战斗·修正值数值",      "「修正值」非数值"),
    ("战斗·上限整数",        "「叠加上限」非整数"),
    ("关卡·非平凡性",        "贪心基线 12 已达成目标 10"),
    ("关卡·坐标格式",        "「城市中心坐标」格式非法"),
    ("关卡·人口数值",        "「人口」非数值"),
    ("关卡·约束值为正",      "「约束值」不为正"),
    ("关卡·星级阈值顺序",    "三星阈值 1 低于二星阈值 2"),
    ("关卡·二星不得低于目标", "低于目标值"),
    ("关卡·类别枚举",        "的「关卡类别」取值不在枚举内"),
    ("关卡·对照关必须成对",  "是对照关，但没有任何另一关与它同地形"),
    ("关卡·目标值格式",      "的「目标值」格式非法"),
    ("关卡·多产出目标须向量", "是多产出关卡，「目标值」必须写成"),
    ("关卡·基线与目标同形态", "与「目标值」形态不一致，无法比较"),
    ("地块·坐标重复",        "坐标重复"),
    ("地块·孤儿关卡id",      "的关卡id 不存在于 levels.csv"),
    ("警告·未决母题",        "母题 D 依赖未决项"),
    ("警告·待核数据",        "「待核=是」"),
    ("警告·加成值为负",      "「加成值」为负"),
    ("排除表·无归属",        "同时为无，该排除规则无归属"),
    ("排除表·被排除规则引用","「被排除规则标识」引用了不存在的"),
    ("警告·关卡无地块",      "没有任何地块"),
]

fails = []
def run(fixture, *flags):
    cmd = [sys.executable, str(CHECKER), "--dir", str(DATA / fixture), *flags]
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr

def counts(out):
    m = re.search(r"错误 (\d+)｜警告 (\d+)", out)
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)

def expect(label, cond, detail=""):
    if cond:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}{('  — ' + detail) if detail else ''}")
        fails.append(label)

# ---------------------------------------------------------------- clean
print("clean/ 开发模式 —— 应当完全通过")
rc, out = run("clean")
e, w = counts(out)
expect("退出码 0", rc == 0, f"实际 {rc}")
expect("0 错误", e == 0, f"实际 {e}")
expect("0 警告", w == 0, f"实际 {w}")
expect("17 张表都读到", "已检查 17/17 张表" in out)

print("\nclean/ 交付模式 —— 表齐全且无待核，也应当通过")
rc, out = run("clean", "--delivery")
expect("退出码 0", rc == 0, f"实际 {rc}")
expect("模式显示为交付", "模式：交付" in out)

# ---------------------------------------------------------------- broken
print("\nbroken/ —— 每条校验规则都应当报出来")
rc, out = run("broken")
expect("退出码 1", rc == 1, f"实际 {rc}")
for label, frag in BROKEN_EXPECT:
    expect(label, frag in out, f"输出中找不到：{frag}")

# ---------------------------------------------------------------- partial
print("\npartial/ 开发模式 —— 只有 2 张表，不该因缺表而爆出外键错误")
rc, out = run("partial")
e, w = counts(out)
expect("退出码 0", rc == 0, f"实际 {rc}")
expect("0 错误", e == 0, f"实际 {e}")
expect("15 条缺表警告", w == 15, f"实际 {w}")
expect("没有任何外键错误（缺表雪崩的回归守卫）",
       "引用了不存在的" not in out)

print("\npartial/ 交付模式 —— 缺表应升为错误")
rc, out = run("partial", "--delivery")
expect("退出码 1", rc == 1, f"实际 {rc}")

# ---------------------------------------------------------------- 待核闸门
print("\n待核数据 —— 开发模式放行，交付模式拦截")
with tempfile.TemporaryDirectory() as td:
    tmp = pathlib.Path(td) / "pending"
    shutil.copytree(DATA / "clean", tmp)
    f = tmp / "combat_modifiers.csv"
    f.write_text(f.read_text(encoding="utf-8")
                 .replace("战斗力,3,始终,否,无,,一手,否",
                          "战斗力,3,始终,否,无,,二手,是"), encoding="utf-8")
    def run_tmp(*flags):
        p = subprocess.run([sys.executable, str(CHECKER), "--dir", str(tmp), *flags],
                           capture_output=True, text=True)
        return p.returncode, p.stdout + p.stderr
    rc, out = run_tmp()
    expect("开发模式退出码 0", rc == 0, f"实际 {rc}")
    expect("开发模式给出待核警告", "「待核=是」" in out)
    rc, out = run_tmp("--delivery")
    expect("交付模式退出码 1", rc == 1, f"实际 {rc}")

# ---------------------------------------------------------------- --dir 本身
print("\n--dir 参数本身")
p = subprocess.run([sys.executable, str(CHECKER), "--dir", "/nonexistent-xyz"],
                   capture_output=True, text=True)
expect("目录不存在时退出码 2", p.returncode == 2, f"实际 {p.returncode}")

print()
if fails:
    print(f"✗ {len(fails)} 项断言失败：{'、'.join(fails)}")
    sys.exit(1)
print("全部断言通过。")
