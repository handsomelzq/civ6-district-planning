#!/usr/bin/env python3
"""文档坏链检查：markdown 里指向本仓库文件的相对链接必须真的存在。

跑：python3 Tools/check_links.py

为什么要这个：这个项目的文档互相引用得很密（一份 SDD 里十几个指向别处的链接），
改文件名时很容易留下死链，而死链在作品集里是直接的减分项 —— 面试官点一下打不开，
前面所有严谨都白费。CI 里跑，坏一条就不发。
"""
import io
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LINK = re.compile(r"\[[^\]]*\]\(([^)#]+)(#[^)]*)?\)")
SKIP_DIRS = {"node_modules", "dist", ".git"}


def main():
    bad = []
    checked = 0
    for md in sorted(ROOT.rglob("*.md")):
        if any(part in SKIP_DIRS for part in md.parts):
            continue
        text = io.open(str(md), encoding="utf-8").read()
        for m in LINK.finditer(text):
            target = m.group(1).strip()
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            checked += 1
            dest = (md.parent / target).resolve()
            if not dest.exists():
                bad.append("%s → %s（文件不存在）" % (md.relative_to(ROOT), target))
            elif not str(dest).startswith(str(ROOT) + "/"):
                # **本机能打开、仓库里打不开**的那一类。CI 第一次跑就抓到一条：
                # SDD 里引了一份放在仓库外的个人工程规范。本机查不出来，因为
                # 那个文件在本机确实存在 —— 所以这一条必须单独判。
                bad.append("%s → %s（指向仓库外，克隆下来就是死链）"
                           % (md.relative_to(ROOT), target))
    for b in bad:
        sys.stderr.write("✗ 坏链 %s\n" % b)
    print("检查了 %d 条本地链接，坏链 %d 条" % (checked, len(bad)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
