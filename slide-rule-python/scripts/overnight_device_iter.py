"""过夜：10 个新话题 ×（首轮 + 2 次精修），PC/移动对半，落 HTML + 截图 + 机械查验。

用法（仓根）：
    slide-rule-python\\.venv\\Scripts\\python.exe slide-rule-python/scripts/overnight_device_iter.py

产物：.manus-logs/overnight-iter-0820/
走的是活路径 run_spec_first（与 drive-full-stream 同一条生成链），不是 GEN5。
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

_PY_DIR = Path(__file__).resolve().parent.parent
_ROOT = _PY_DIR.parent
sys.path.insert(0, str(_PY_DIR))

from stdio_utf8 import configure_stdio_utf8

configure_stdio_utf8()

OUT = _ROOT / ".manus-logs" / "overnight-iter-0820"

TOPICS = [
    ("phone", "社区团长的团购订单核销与缺货登记"),
    ("phone", "幼儿园晨检与接送确认"),
    ("phone", "汽修车间的工单派发与零件领用"),
    ("phone", "物业报修进度跟踪"),
    ("phone", "诊所复诊预约与随访任务"),
    ("desktop", "律所工时与案件台账"),
    ("desktop", "药店近效期库存台账"),
    ("desktop", "工厂设备点检与故障闭环"),
    ("desktop", "学校课后托管排班与签到"),
    ("desktop", "电商客服工单与退换货审核"),
]

ITERS = [
    "把第一页改成真正的业务列表，去掉个人中心、设置入口和退出登录当首页。",
    "底栏钉在屏幕底部，主列表可上下滚动，列表信息更密一点，不要一排图标漂在正中。",
]


def _load_env_file(path: Path) -> int:
    loaded = 0
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return 0
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
            loaded += 1
    return loaded


def inspect_html(html: str, device: str) -> list[str]:
    """机械查验。每条都是『不该有』或『该有却没有』。

    标签是否存在要看注释外的活 DOM。律所 r0 把 ``<aside>`` 写进未闭合注释，
    源码 grep 假绿、截图没有侧栏。
    """
    from services.page_shell import outside_html_comments

    visible = outside_html_comments(html)
    low = html.lower()
    body = html[low.find("<body") :] if "<body" in low else html
    findings: list[str] = []
    if device == "phone":
        if re.search(r"<aside\b", visible, re.I):
            findings.append("phone 仍有 <aside>")
        if not re.search(r"<nav\b", visible, re.I):
            findings.append("phone 没有 <nav>")
        if not re.search(r"<header\b", visible, re.I):
            findings.append("phone 没有 <header>")
        if not re.search(r"<main\b", visible, re.I):
            findings.append("phone 没有 <main>")
        if "sliderule-phone-fill" not in html:
            findings.append("phone 缺铺满 CSS")
        if "overflow-y:auto" not in html and "overflow-y: auto" not in html:
            findings.append("phone 铺满 CSS 没有 overflow-y:auto")
        if 'body>div[class*="items-center"]{' in html:
            findings.append("铺满 CSS 仍用 items-center 单独选择器（会拉高顶栏）")
        main_m = re.search(r"<main\b[^>]*>[\s\S]{0,1600}", visible, re.I)
        chunk = main_m.group(0) if main_m else body[:1800]
        if re.search(r"退出(当前)?(账号|登录)", chunk) and not re.search(
            r"(列表|工单|订单|预约|报修|核销|晨检)", chunk
        ):
            findings.append("main 像个人中心（退出登录、没有业务列表）")
        if re.search(r"<!--(?:(?!-->).)*?<nav\b", html, re.I | re.S):
            findings.append("phone 底栏困在未闭合注释里")
        if re.search(r'data-page-id="[^"]+"[^>]*data-page-id="', html, re.I):
            findings.append("同一链接叠了两个 data-page-id")
    else:
        if re.search(r"<!--(?:(?!-->).)*?<aside\b", html, re.I | re.S):
            findings.append("desktop 侧栏困在未闭合注释里")
        if not re.search(r"<aside\b", visible, re.I):
            findings.append("desktop 没有 <aside>")
        if not re.search(r"<header\b", visible, re.I):
            findings.append("desktop 没有 <header>")
    return findings


def _write_report(rows: list[dict], extra: dict | None = None) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    payload = {"updatedAt": time.time(), "runs": rows}
    if extra:
        payload.update(extra)
    (OUT / "report.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (OUT / "STATUS.json").write_text(
        json.dumps(
            {
                "updatedAt": time.time(),
                "done": extra.get("done") if extra else False,
                "runs": len(rows),
                "withFindings": sum(1 for r in rows if r.get("findings")),
                "failed": sum(1 for r in rows if not r.get("ok")),
                "last": rows[-1] if rows else None,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def _screenshot_dir(html_dir: Path, device: str) -> str:
    shot = _PY_DIR / "scripts" / "overnight_shot.mjs"
    r = subprocess.run(
        ["node", str(shot), str(html_dir), device],
        cwd=str(_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
    )
    tail = ((r.stdout or "") + "\n" + (r.stderr or "")).strip()[-400:]
    if r.returncode != 0:
        return f"shot exit {r.returncode}: {tail}"
    return tail


def _load_prior_model(slug: str, rnd: int) -> tuple[object, object]:
    for prev in range(rnd - 1, -1, -1):
        p = OUT / slug / f"r{prev}" / "model.json"
        pages_p = OUT / slug / f"r{prev}" / "pages.json"
        if p.is_file():
            model = json.loads(p.read_text(encoding="utf-8"))
            pages = json.loads(pages_p.read_text(encoding="utf-8")) if pages_p.is_file() else None
            return model, pages
    return None, None


def main() -> int:
    n_root = _load_env_file(_ROOT / ".env")
    n_py = _load_env_file(_PY_DIR / ".env")
    key_len = len(os.environ.get("LLM_API_KEY") or "")
    print(
        f"[overnight] env root={n_root} py={n_py} "
        f"LLM_API_KEY={'set('+str(key_len)+')' if key_len else 'UNSET'} "
        f"MODEL={os.environ.get('LLM_MODEL', 'unset')}"
    )
    if not key_len:
        print("[overnight] 没有 LLM_API_KEY，推演会走模板/blocked。照跑并记下来。")

    from services.spec_first_pipeline import model_refine_digest, run_spec_first

    OUT.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    if (OUT / "report.json").is_file():
        try:
            prev = json.loads((OUT / "report.json").read_text(encoding="utf-8"))
            rows = list(prev.get("runs") or [])
        except Exception:
            rows = []

    done_keys = {f"{r.get('topic')}|{r.get('round')}" for r in rows if r.get("ok")}

    for i, (device, goal) in enumerate(TOPICS, start=1):
        slug = f"{i:02d}-{device}"
        prev_model = None
        prev_pages = None
        for rnd, instruction in enumerate(["", *ITERS], start=0):
            key = f"{goal}|{rnd}"
            if key in done_keys:
                print(f"[overnight] skip done {slug} r{rnd}")
                prev_model, prev_pages = _load_prior_model(slug, rnd + 1)
                continue
            if prev_model is None and rnd > 0:
                prev_model, prev_pages = _load_prior_model(slug, rnd)
            t0 = time.time()
            rec: dict = {
                "topic": goal,
                "device": device,
                "round": rnd,
                "slug": slug,
                "ok": False,
                "seconds": 0,
                "findings": [],
                "error": "",
            }
            try:
                kw: dict = {"preferred_device": device}
                if rnd > 0 and prev_model is not None:
                    kw["refine"] = {
                        "instruction": instruction,
                        "modelDigest": model_refine_digest(prev_model),
                    }
                    kw["reuse_model"] = prev_model
                    if prev_pages:
                        kw["reuse_pages"] = prev_pages
                print(f"[overnight] {slug} r{rnd} {goal[:24]}…", flush=True)
                out = run_spec_first(goal, **kw)
                pages = (out.get("pages") or {}) if isinstance(out, dict) else {}
                dest = OUT / slug / f"r{rnd}"
                dest.mkdir(parents=True, exist_ok=True)
                findings: list[str] = []
                for pid, html in pages.items():
                    (dest / f"{pid}.html").write_text(html, encoding="utf-8")
                    findings.extend(f"{pid}: {x}" for x in inspect_html(html, device))
                model = out.get("model") if isinstance(out, dict) else None
                if model is not None:
                    (dest / "model.json").write_text(
                        json.dumps(model, ensure_ascii=False), encoding="utf-8"
                    )
                (dest / "pages.json").write_text(
                    json.dumps(pages, ensure_ascii=False), encoding="utf-8"
                )
                rec["pageCount"] = len(pages)
                rec["findings"] = findings
                rec["ok"] = True
                rec["dir"] = str(dest)
                prev_model = model
                prev_pages = pages
                try:
                    rec["shot"] = _screenshot_dir(dest, device)
                except Exception as exc:
                    rec["shotError"] = str(exc)[:200]
            except Exception as exc:
                rec["error"] = str(exc)[:400]
                print(f"[overnight] FAIL {slug} r{rnd}: {rec['error']}", flush=True)
            rec["seconds"] = round(time.time() - t0, 1)
            rows.append(rec)
            _write_report(rows)
            print(
                f"[overnight] {slug} r{rnd} {rec['seconds']}s "
                f"findings={len(rec['findings'])} ok={rec['ok']}",
                flush=True,
            )

    open_findings = [r for r in rows if r.get("findings")]
    print(f"[overnight] done runs={len(rows)} with_findings={len(open_findings)}", flush=True)
    _write_report(rows, extra={"done": True})
    (OUT / "DONE").write_text("ok\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
