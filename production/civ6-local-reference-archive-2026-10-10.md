# 《文明 VI》卸载前本机参考档案

## 目的

从本机正版 Steam 安装中保留本项目后续规则核对、配置表重建、地图脚本研究和 UI／地形视觉迭代所需的一手文件。档案不是独立游戏副本，不含电影、音频和完整 3D 模型库。

## 保存范围

- 全部 `.xml`、`.sql`、`.lua`、`.modinfo`、`.artdef`，保留 `Civ6.app/Contents` 下相对目录结构。
- Base、迭代兴衰、风云变幻以及德国／日本／俄罗斯／韩国相关的图标包和领袖 BLP。
- Base、迭代兴衰、风云变幻的战略视图地形、地貌、区域、建筑和改良设施 BLP。
- Base 地形材质／元素包，用于后续地块视觉提取。
- macOS 三套 GameCore、主程序，以及三套 Windows FinalRelease GameCore；XP1／XP2 调试 `.map` 用于闭源边界和符号研究。
- 项目当前已经解码的 `web/civ6-ui/` 与 `web/civ6-terrain/` PNG、来源说明和 manifest，额外复制到档案的 `Derived/` 中。

档案路径：`local-civ6-reference/`，受 `.gitignore` 排除。清单 `manifest.json` 记录每个文件的大小和 SHA-256。

## 排除范围

- 电影、音频、字幕媒体和完整地标／单位／领袖 3D 资源库。
- 当前四文明以外的领袖大型资源包。

## 验证结果

- 档案：4,027 个文件，共 2,159,833,137 字节（约 2.0 GiB）。
- 内容分类：规则／文本／脚本 3,752 个、290.2 MiB；精选素材／核心 39 个、1,767.8 MiB；当前项目已解码素材 236 个、1.8 MiB。
- `python3 Tools/backup_civ6_reference.py --verify-only`：全部文件大小和 SHA-256 通过。
- 以 `local-civ6-reference/Assets` 运行 `Tools/parse_civ6_xml.py`：成功生成 14 张表；项目现有 13 张同名基础配置表逐字节一致，另含新增的 `trait_adjacency_modifiers.csv`。
- 规则档案包含 42 个 modinfo、642 个 Lua、2,463 个 XML、17 个 SQL、584 个 artdef；Base／XP2 地图脚本在内。

## 使用方式

```bash
python3 Tools/backup_civ6_reference.py --verify-only
python3 Tools/parse_civ6_xml.py
CIV6_ASSETS="$PWD/local-civ6-reference/Assets" python3 Tools/parse_civ6_xml.py
```

这些文件的版权仍归 Firaxis／2K。档案仅用于本机个人开发和求职演示准备，不得提交到 Git、上传到公开网页或单独分发。
