# -*- coding: utf-8 -*-
"""第 7 格夜间闸：每个阶段一套 pytest，失败继续跑，写一份醒了能看的报告。

抄 grok-build validate.rs 的心：用真编排 + 桩 host 证明路通，花掉真机
之前先红。这里的桩是 ControlHarness，不是第二套逻辑。
"""
from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
PY = ROOT / ".venv" / "Scripts" / "python.exe"
if not PY.exists():
    PY = ROOT / ".venv" / "bin" / "python"
if not PY.exists():
    PY = Path(sys.executable)

REPORT = ROOT / "data" / "checkpoints" / "panel7-night-report.md"

STAGES = [
    (
        "1-prompt-not-handbook",
        "提示词是把这件事做完，不是类型/设备门",
        [
            "tests/test_control_prompt_is_not_a_handbook.py",
            "tests/test_panel7_craftsman_picks_the_path.py::Test提示词不教课表",
        ],
    ),
    (
        "2-hops-atomic",
        "hop 仍是原子工具，不许把课表焊回来",
        [
            "tests/test_hops_are_atomic_tools.py",
            "tests/test_refine_goes_one_hop.py",
        ],
    ),
    (
        "3-host-picks-path",
        "host 交回后再挑下一跳；水果店不问类型",
        [
            "tests/test_panel7_craftsman_picks_the_path.py::TestHost自己挑下一跳",
            "tests/test_control_write_returns_to_loop.py",
        ],
    ),
    (
        "4-permission-not-product-type",
        "批准不管产品形态",
        [
            "tests/test_panel7_craftsman_picks_the_path.py::Test批准不管产品形态",
            "tests/test_control_ask_user_parks.py",
        ],
    ),
    (
        "5-cap-speech-not-quota",
        "工厂出过货，不许把额度用完当完工台词",
        [
            "tests/test_control_caps_stop_without_ignition.py",
        ],
    ),
    (
        "6-ask-same-turn",
        "问人是同一轮回执",
        [
            "tests/test_control_ask_user_parks.py",
            "tests/test_cheap_followup_is_not_a_product.py",
        ],
    ),
]


def _run(stage_id: str, files: list[str]) -> tuple[int, str]:
    cmd = [
        str(PY),
        "-m",
        "pytest",
        "-q",
        "--tb=line",
        *[str(ROOT / f) if not f.startswith("tests/") else str(ROOT / f) for f in files],
    ]
    # files are already relative to slide-rule-python
    cmd = [str(PY), "-m", "pytest", "-q", "--tb=line", *files]
    proc = subprocess.run(
        cmd,
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    out = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
    return proc.returncode, out[-8000:]


def main() -> int:
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 第 7 格夜间报告",
        "",
        f"- 时间 {datetime.now(timezone.utc).isoformat()}",
        f"- python `{PY}`",
        "",
        "目标：同一个老师傅，更像老师傅。第 6 格不重开。第 4 格 hop 原子性不许回退。",
        "",
    ]
    worst = 0
    for stage_id, title, files in STAGES:
        print(f"== {stage_id} {title}", flush=True)
        code, out = _run(stage_id, files)
        worst = max(worst, code)
        status = "PASS" if code == 0 else "FAIL"
        print(f"   {status} exit={code}", flush=True)
        lines.append(f"## {stage_id} — {status}")
        lines.append("")
        lines.append(title)
        lines.append("")
        lines.append("```")
        lines.append("\n".join(files))
        lines.append("```")
        lines.append("")
        lines.append("```")
        lines.append(out.strip() or "(no output)")
        lines.append("```")
        lines.append("")
    lines.append("## 总评")
    lines.append("")
    if worst == 0:
        lines.append("六阶段全绿。引擎若在跑，需要重启 :9700 才吃到 rehearsal_control.py。")
    else:
        lines.append("有阶段红。先看上面 FAIL 的 traceback，不要拿额度台词当完工。")
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"report {REPORT} worst={worst}", flush=True)
    return worst


if __name__ == "__main__":
    raise SystemExit(main())
