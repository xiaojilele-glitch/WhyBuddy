# -*- coding: utf-8 -*-
"""控制面技能目录与加载信封。抄 grok-build Skill 工具。

渐进披露：目录只给 name + description；正文只在 skill 工具回。
本模块是叶子：吃已经开箱的文本，不读 OSS、不读表。
"""

from __future__ import annotations

import re
import textwrap
from dataclasses import dataclass
from typing import Sequence

MAX_NAME_LEN = 64
MAX_DESCRIPTION_LEN = 1024

_SKILL_TOOL_LEAD = (
    "加载一份磁盘上的技能（SKILL.md）。"
    "目录只给名字和一句话；全文只在你调用这件工具时喂回来。"
    "不是应用市场那份语义档案。"
    "任务对得上下面某一份时再加载。"
    "技能目录在工程沙盒 .sliderule/skills/<name>/，脚本用 shell_exec 跑。"
)


@dataclass(frozen=True)
class SkillInfo:
    name: str
    description: str
    path: str
    body: str
    enabled: bool = True


def normalize_skill_name(name: str) -> str:
    out: list[str] = []
    for ch in (name or "").strip().lower():
        mapped = ch if ("a" <= ch <= "z" or "0" <= ch <= "9") else "-"
        if mapped == "-" and out and out[-1] == "-":
            continue
        out.append(mapped)
    return "".join(out).strip("-")


def is_valid_skill_name(name: str) -> bool:
    if not name or len(name) > MAX_NAME_LEN:
        return False
    if name.startswith("-") or name.endswith("-") or "--" in name:
        return False
    return all("a" <= ch <= "z" or "0" <= ch <= "9" or ch == "-" for ch in name)


def parse_skill_md(text: str, *, path: str, name: str = "") -> SkillInfo | None:
    frontmatter, body = _split_frontmatter(text or "")
    fields = _parse_frontmatter_scalars(frontmatter)
    slug = normalize_skill_name(fields.get("name") or name or _name_from_path(path))
    if not is_valid_skill_name(slug):
        return None
    description = (
        fields.get("description")
        or fields.get("when-to-use")
        or _first_paragraph(body)
    ).strip()[:MAX_DESCRIPTION_LEN]
    if not description:
        return None
    enabled = not (
        (fields.get("disable-model-invocation") or "").lower() == "true"
        or (fields.get("enabled") or "").lower() == "false"
    )
    return SkillInfo(
        name=slug,
        description=description,
        path=path,
        body=body,
        enabled=enabled,
    )


def catalog_xml(skills: Sequence[SkillInfo]) -> str:
    live = [s for s in skills if s.enabled]
    if not live:
        return (
            "<available_skills>\n"
            "(还没有已安装的技能。去技能商店安装完整包。)\n"
            "</available_skills>"
        )
    lines = ["<available_skills>"]
    for skill in live:
        lines.append("  <skill>")
        lines.append(f"    <name>{_xml_escape(skill.name)}</name>")
        lines.append(f"    <description>{_xml_escape(skill.description)}</description>")
        lines.append(f"    <location>{_xml_escape(skill.path)}</location>")
        lines.append("  </skill>")
    lines.append("</available_skills>")
    return "\n".join(lines)


def skill_tool_description(skills: Sequence[SkillInfo]) -> str:
    return f"{_SKILL_TOOL_LEAD}\n\n{catalog_xml(skills)}"


def build_skill_message(skill: SkillInfo, args: str | None = None) -> str:
    extra = f' args="{_xml_escape(args)}"' if args else ""
    return (
        f'<skill name="{_xml_escape(skill.name)}" '
        f'description="{_xml_escape(skill.description)}" '
        f'path="{_xml_escape(skill.path)}"{extra}>\n'
        f"{skill.body}\n"
        f"</skill>"
    )


def invoke_skill(skills: Sequence[SkillInfo], name: str, args: str | None = None) -> dict:
    raw = normalize_skill_name(str(name or ""))
    if not raw:
        return {"ok": False, "error": "skill_name_required"}
    live = [s for s in skills if s.enabled]
    match = next((s for s in live if s.name == raw), None)
    if match is None:
        disabled = next((s for s in skills if s.name == raw and not s.enabled), None)
        if disabled is not None:
            return {"ok": False, "error": "skill_disabled", "skill": raw}
        return {
            "ok": False,
            "error": "skill_not_found",
            "skill": raw,
            "available": [s.name for s in live],
        }
    return {"ok": True, "skill": match.name, "skill_message": build_skill_message(match, args)}


def filter_selected(skills: Sequence[SkillInfo], selected: Sequence[str] | None) -> list[SkillInfo]:
    """用户指定了就只留这些；空/None = 已装全部。"""
    if not selected:
        return list(skills)
    want = {normalize_skill_name(item) for item in selected if str(item or "").strip()}
    if not want:
        return list(skills)
    return [s for s in skills if s.name in want]


_MENTION_RE = re.compile(r"(?<![A-Za-z0-9_])@([A-Za-z0-9][\w.-]{0,63})")


def mentioned_skill_slugs(
    text: str,
    installed: Sequence[str] | None = None,
) -> list[str]:
    """这一轮正文里的 `@slug`。给了 installed 就只留已装的。"""
    found: list[str] = []
    seen: set[str] = set()
    for match in _MENTION_RE.finditer(text or ""):
        slug = normalize_skill_name(match.group(1))
        if not slug or slug in seen:
            continue
        seen.add(slug)
        found.append(slug)
    if not installed:
        return found
    allow = {normalize_skill_name(item) for item in installed if str(item or "").strip()}
    return [slug for slug in found if slug in allow]


def catalog_skill_slug(path: str) -> str | None:
    """`.sliderule/skills/<slug>/SKILL.md` 是目录标签，不是工程源码路径。

    ⚠ 2026-09-22 BABCJGGB44：回执带了这个 path，模型 file_read 得到
      project_file_not_found，接着在沙盒里 `find /`。种子在仓库 zip 里，
      工程树没有这份文件。
    """
    raw = str(path or "").strip().replace("\\", "/").lstrip("/")
    lowered = raw.lower()
    for prefix in ("home/ubuntu/", "home/user/workspace/", "workspace/", "app/"):
        if lowered.startswith(prefix):
            raw = raw[len(prefix):]
            lowered = raw.lower()
    match = re.fullmatch(
        r"(?:\.sliderule/)?skills/([A-Za-z0-9][\w.-]{0,63})/SKILL\.md",
        raw,
        flags=re.IGNORECASE,
    )
    if match is None:
        return None
    return normalize_skill_name(match.group(1))


def mentioned_skill_playbooks(skills: Sequence[SkillInfo]) -> str:
    """点名技能的名字和一句话。正文不进 system，也不在工程树里。"""
    live = [skill for skill in skills if skill.enabled]
    if not live:
        return ""
    names = "、".join(skill.name for skill in live)
    lines = [
        f"用户这一轮点名了技能：{names}。",
        "下面只给名字、一句话和目录标签。正文不在工程里。"
        "要原文调 skill，回执里就是全文。path 不是工程文件，不要 file_read，也不要在沙盒里 find。",
    ]
    for skill in live:
        lines.append(f"- {skill.name}：{skill.description}；path={skill.path}")
    return "\n".join(lines)


def _split_frontmatter(content: str) -> tuple[str, str]:
    text = (content or "").lstrip()
    if not text.startswith("---"):
        return "", content or ""
    rest = text[3:]
    if rest.startswith("\n"):
        rest = rest[1:]
    idx = rest.find("\n---")
    if idx < 0:
        return "", content or ""
    return rest[:idx], rest[idx + 4:].lstrip()


def _parse_frontmatter_scalars(frontmatter: str) -> dict[str, str]:
    out: dict[str, str] = {}
    lines = (frontmatter or "").splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line[:1] in " \t":
            i += 1
            continue
        if ":" not in line:
            i += 1
            continue
        key, _, raw = line.partition(":")
        key = key.strip()
        raw = raw.strip()
        if raw in ("|", ">", "|-", ">-", "|+", ">+"):
            block: list[str] = []
            i += 1
            while i < len(lines) and (not lines[i].strip() or lines[i][:1] in " \t"):
                block.append(lines[i])
                i += 1
            out[key] = textwrap.dedent("\n".join(block)).strip()
            continue
        if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
            raw = raw[1:-1]
        else:
            raw = raw.split(" #", 1)[0].strip()
        out[key] = raw
        i += 1
    return out


def _name_from_path(path: str) -> str:
    norm = (path or "").replace("\\", "/").rstrip("/")
    if norm.lower().endswith("/skill.md"):
        parent = norm.rsplit("/", 1)[0]
        return parent.rsplit("/", 1)[-1] if parent else ""
    return norm.rsplit("/", 1)[-1]


def _first_paragraph(body: str) -> str:
    for block in re.split(r"\n\s*\n", body or ""):
        line = block.strip()
        if line and not line.startswith("#"):
            return line.split("\n", 1)[0].strip()
    return ""


def _xml_escape(value: str) -> str:
    return (
        (value or "")
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
