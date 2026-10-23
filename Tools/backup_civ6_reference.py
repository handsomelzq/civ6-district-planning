#!/usr/bin/env python3
"""Preserve a compact, project-specific Civ VI first-party reference archive.

The archive stays local and Git-ignored.  It keeps the source hierarchy needed
by parse_civ6_xml.py plus selected binary art/core packs that would otherwise
be unavailable after uninstalling the game.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Tuple


PROJECT = Path(__file__).resolve().parent.parent
DEFAULT_GAME = Path(
    "~/Library/Application Support/Steam/steamapps/common/"
    "Sid Meier's Civilization VI/Civ6.app/Contents"
).expanduser()
DEFAULT_OUTPUT = PROJECT / "local-civ6-reference"

TEXT_EXTENSIONS = {".xml", ".sql", ".lua", ".modinfo", ".artdef"}

# Packs used by the current Germany/Japan/Russia/Korea scope and by the
# existing icon/terrain extraction work.  Paths are relative to Civ6.app/Contents.
SELECTED_BINARY_PATHS = [
    "MacOS/Civ6_Exe",
    "MacOS/GameCore_Base.dll",
    "MacOS/GameCore_XP1.dll",
    "MacOS/GameCore_XP2.dll",
    "Assets/Base/Binaries/Win64Steam/GameCore_Base_FinalRelease.dll",
    "Assets/DLC/Expansion1/Binaries/Win64/GameCore_XP1_FinalRelease.dll",
    "Assets/DLC/Expansion1/Binaries/Win64/GameCore_XP1_FinalRelease.map",
    "Assets/DLC/Expansion2/Binaries/Win64/GameCore_XP2_FinalRelease.dll",
    "Assets/DLC/Expansion2/Binaries/Win64/GameCore_XP2_FinalRelease.map",
    "Assets/Base/Platforms/Windows/BLPs/UI/Icons.blp",
    "Assets/DLC/Expansion1/platforms/windows/BLPs/UI/Icons.blp",
    "Assets/DLC/Expansion2/Platforms/Windows/BLPs/UI/Icons.blp",
    "Assets/DLC/GreatBuilders/Platforms/Windows/BLPs/UI/Icons.blp",
    "Assets/DLC/GreatWarlords/Platforms/Windows/BLPs/UI/Icons.blp",
    "Assets/Base/Platforms/Windows/BLPs/UI/UI_HUD.blp",
    "Assets/Base/Platforms/Windows/BLPs/UI/UI_Leaders.blp",
    "Assets/Base/Platforms/Windows/BLPs/terrain/TerrainMaterialSet_Base.blp",
    "Assets/Base/Platforms/Windows/BLPs/terrain/TerrainElementSet_Base.blp",
    "Assets/Base/Platforms/Windows/BLPs/strategicview/strategicview_terraintypes.blp",
    "Assets/Base/Platforms/Windows/BLPs/strategicview/strategicview_terrainsprites.blp",
    "Assets/Base/Platforms/Windows/BLPs/strategicview/strategicview_features.blp",
    "Assets/Base/Platforms/Windows/BLPs/strategicview/strategicview_districts.blp",
    "Assets/Base/Platforms/Windows/BLPs/strategicview/strategicview_buildings.blp",
    "Assets/Base/Platforms/Windows/BLPs/strategicview/strategicview_improvements.blp",
    "Assets/DLC/Expansion1/platforms/windows/BLPs/strategicview/strategicview_features.blp",
    "Assets/DLC/Expansion1/platforms/windows/BLPs/strategicview/strategicview_districts.blp",
    "Assets/DLC/Expansion1/platforms/windows/BLPs/strategicview/strategicview_buildings.blp",
    "Assets/DLC/Expansion1/platforms/windows/BLPs/strategicview/strategicview_improvements.blp",
    "Assets/DLC/Expansion2/Platforms/Windows/BLPs/strategicview/strategicview_features.blp",
    "Assets/DLC/Expansion2/Platforms/Windows/BLPs/strategicview/strategicview_districts.blp",
    "Assets/DLC/Expansion2/Platforms/Windows/BLPs/strategicview/strategicview_buildings.blp",
    "Assets/DLC/Expansion2/Platforms/Windows/BLPs/strategicview/strategicview_improvements.blp",
    "Assets/Base/Platforms/Windows/BLPs/leaders/leader_barbarossa.blp",
    "Assets/DLC/GreatBuilders/Platforms/Windows/BLPs/leaders/leader_ludwig_ii.blp",
    "Assets/Base/Platforms/Windows/BLPs/leaders/leader_hojo.blp",
    "Assets/DLC/GreatWarlords/Platforms/Windows/BLPs/leaders/leader_tokugawa.blp",
    "Assets/Base/Platforms/Windows/BLPs/leaders/leader_peter.blp",
    "Assets/DLC/Expansion1/platforms/windows/BLPs/leaders/leader_seondeok.blp",
    "Assets/DLC/GreatBuilders/Platforms/Windows/BLPs/leaders/leader_sejong.blp",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def iter_text_sources(game: Path) -> Iterable[Tuple[Path, str]]:
    assets = game / "Assets"
    for source in assets.rglob("*"):
        if source.is_file() and source.suffix.lower() in TEXT_EXTENSIONS:
            yield source, "rules-text-scripts"


def iter_selected_binaries(game: Path) -> Iterable[Tuple[Path, str]]:
    for relative in SELECTED_BINARY_PATHS:
        source = game / relative
        if source.is_file():
            yield source, "selected-art-or-core"
        else:
            print("警告：缺少可选文件：%s" % relative)


def copy_file(source: Path, destination: Path) -> Dict[str, object]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(source), str(destination))
    return {
        "path": destination.as_posix(),
        "size": destination.stat().st_size,
        "sha256": sha256(destination),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", type=Path, default=DEFAULT_GAME)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    game = args.game.expanduser().resolve()
    output = args.output.expanduser().resolve()

    if args.verify_only:
        manifest_path = output / "manifest.json"
        if not manifest_path.is_file():
            raise SystemExit("找不到备份清单：%s" % manifest_path)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        failures: List[str] = []
        for item in manifest["files"]:
            path = output / item["path"]
            if not path.is_file():
                failures.append("%s：文件不存在" % item["path"])
            elif path.stat().st_size != item["size"]:
                failures.append("%s：大小不符" % item["path"])
            elif sha256(path) != item["sha256"]:
                failures.append("%s：SHA-256 不符" % item["path"])
        if failures:
            raise SystemExit("\n".join(failures))
        print("校验通过：%d 个文件" % len(manifest["files"]))
        return

    if not game.is_dir():
        raise SystemExit("找不到 Civilization VI Contents 目录：%s" % game)

    candidates: Dict[str, Tuple[Path, str]] = {}
    for source, category in list(iter_text_sources(game)) + list(iter_selected_binaries(game)):
        relative = source.relative_to(game).as_posix()
        candidates[relative] = (source, category)
    for derived_dir in ("web/civ6-ui", "web/civ6-terrain"):
        root = PROJECT / derived_dir
        if root.is_dir():
            for source in root.rglob("*"):
                if source.is_file():
                    relative = "Derived/" + source.relative_to(PROJECT).as_posix()
                    candidates[relative] = (source, "derived-project-art")

    output.mkdir(parents=True, exist_ok=True)
    records: List[Dict[str, object]] = []
    total = len(candidates)
    for index, relative in enumerate(sorted(candidates), 1):
        source, category = candidates[relative]
        destination = output / relative
        record = copy_file(source, destination)
        record["path"] = relative
        record["category"] = category
        records.append(record)
        if index % 250 == 0 or index == total:
            print("已复制 %d/%d" % (index, total))

    manifest = {
        "format": 1,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_game_contents": str(game),
        "purpose": "Local first-party reference for the Civ VI district-planning demo",
        "scope": {
            "source_extensions": sorted(TEXT_EXTENSIONS),
            "selected_binary_paths": SELECTED_BINARY_PATHS,
            "derived_project_art": ["web/civ6-ui", "web/civ6-terrain"],
            "excluded": [
                "movies", "audio", "complete 3D model library",
                "unrelated leader packs", "game executables other than Civ6_Exe",
            ],
        },
        "file_count": len(records),
        "total_bytes": sum(int(item["size"]) for item in records),
        "files": records,
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    readme = """# Civilization VI 本机参考档案

此目录由 `Tools/backup_civ6_reference.py` 从本机正版 Steam 安装中生成，
仅用于本机的规则核对、解析复现、UI／地形素材研究和求职演示开发。

- `Assets/` 保留游戏原目录结构，可作为 `CIV6_ASSETS=<本目录>/Assets` 使用。
- `MacOS/` 与部分 `Binaries/` 仅用于闭源行为边界和符号层面的研究。
- `manifest.json` 记录每个文件的大小与 SHA-256。
- 此目录受 `.gitignore` 排除，不得提交、上传或随公开网页发布。
- 删除游戏前运行：
  `python3 Tools/backup_civ6_reference.py --verify-only`
"""
    (output / "README.md").write_text(readme, encoding="utf-8")
    print("完成：%d 个文件，%.1f MiB，目录 %s" % (
        len(records), manifest["total_bytes"] / 1024 / 1024, output))


if __name__ == "__main__":
    main()
