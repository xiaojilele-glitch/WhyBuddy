# -*- coding: utf-8 -*-
"""从 anthropics/skills 打出无 key 种子 zip。只进货架索引，不在逛商店时解压。"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from urllib.request import urlopen

ARCHIVE = "https://codeload.github.com/anthropics/skills/zip/refs/heads/main"
SEEDS = (
    "frontend-design",
    "web-artifacts-builder",
    "algorithmic-art",
    "brand-guidelines",
    "theme-factory",
    "canvas-design",
    "doc-coauthoring",
    "internal-comms",
)
OUT = Path(__file__).resolve().parent


def main() -> None:
    with urlopen(ARCHIVE, timeout=60) as resp:
        blob = resp.read()
    archive = zipfile.ZipFile(io.BytesIO(blob))
    names = archive.namelist()
    root = next(
        (name for name in names if name.endswith("/skills/") and name.count("/") == 2),
        "",
    )
    if not root:
        raise SystemExit("anthropic_skills_archive_shape")
    for slug in SEEDS:
        prefix = f"{root}{slug}/"
        members = [name for name in names if name.startswith(prefix) and not name.endswith("/")]
        if not any(name[len(prefix):].lower() == "skill.md" for name in members):
            raise SystemExit(f"missing_skill_md:{slug}")
        dest = OUT / f"{slug}.zip"
        with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as out:
            for name in members:
                rel = f"{slug}/{name[len(prefix):]}"
                out.writestr(rel, archive.read(name))
        print(dest.name, dest.stat().st_size)


if __name__ == "__main__":
    main()
