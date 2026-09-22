#!/usr/bin/env python
"""从**跑完的真会话**里把成品页拉出来，查这四步是不是真的落到了成品上。

用法：shell_mark_audit.py <cookie 文件> [会话数]

⚠ 为什么必须从会话里查、不能只看单测：``data-shell`` 是 unify_shell 打的，
  而 bind **会整页重写**（``repair_pages_after_bind`` 只还原 aside/header）。
  标能不能活到成品，只有真机能回答。本仓「改了但装在不通电的插座上」栽过三次。
"""
import json
import re
import subprocess
import sys

BASE = "http://127.0.0.1:3000/api/sliderule"


def get(cookie: str, url: str):
    r = subprocess.run(["curl", "-s", "-b", cookie, url], capture_output=True)
    try:
        return json.loads(r.stdout.decode("utf-8", "replace"))
    except Exception:
        return {}


def main() -> int:
    cookie = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    ss = get(cookie, f"{BASE}/sessions").get("sessions", [])
    ss.sort(key=lambda s: s.get("lastActive") or "", reverse=True)
    bad = 0
    for s in ss[:limit]:
        sid = s["sessionId"]
        sp = ((get(cookie, f"{BASE}/sessions/{sid}").get("state") or {})
              .get("specFirstPages") or {})
        pages = sp.get("pages") or {}
        if not pages:
            continue
        dev = sp.get("device") or "?"
        want = ({"header", "main", "nav"} if dev == "phone"
                else {"aside", "header", "main"})
        print(f"\n{sid}  device={dev}  {len(pages)} 页   {s['goal'][:30]}")
        for pid, html in pages.items():
            # ⚠ 只认**开标签上**的标。写成 findall(r'data-shell="(\w+)"') 会把
            #   注入的 CSS 选择器文本（[data-shell="nav"]{…}）也算进来——
            #   2026-08-22 第一版就是这么给桌面页报出「有 nav 标」的假绿，
            #   而桌面分支根本不打 nav。
            marks = set(
                re.findall(r'<\w+\b[^>]*\bdata-shell="(\w+)"[^>]*>', html)
            )
            miss = want - marks
            theme = re.search(r'data-theme="(\w+)"', html)
            layered = "@layer sliderule-fallback" in html
            important_body = bool(
                re.search(r"html,body\{background-color:var\(--background\)!important", html)
            )
            ok = not miss and layered and not important_body
            if not ok:
                bad += 1
            print(f"   {pid:<22} 标={sorted(marks) or '无'}"
                  f"{'  ✗ 缺 ' + str(sorted(miss)) if miss else ''}"
                  f"  主题={theme.group(1) if theme else '?'}"
                  f"  分层兜底={'有' if layered else '✗无'}"
                  f"{'  ✗ 整页仍带 !important' if important_body else ''}")
    print(f"\n不合格 {bad} 页")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
