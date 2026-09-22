# -*- coding: utf-8 -*-
"""整条真机建造：一句真需求 → 范围卡 → SPEC → 假设卡 → 画页面 → 结构 → 绑定。

    python scripts/run_full_build.py
    PROBE_TOPIC='…' PROBE_RAW=/tmp/raw.json python scripts/run_full_build.py

前置与 run_real_topics.py 相同：后端已起、`.env` 有真 key、
账号从 REAL_TOPIC_EMAIL / REAL_TOPIC_PASSWORD 读（不写进仓）。

跟 run_real_topics.py 的分工：那支只看**头几个事件**（有没有出复述卡、
有没有反问产品类型），收到就断开。这支相反——它把每一轮 SSE 读到底，
为的是看五条新机制在真机上到底露不露面：

    control_todo          老师傅自己列的活儿清单
    report_done → 判决    模型报完工，判决是 accepted 还是 not_achieved
    remember / recall     模型自己攒的记忆
    stationarity          原地打转停机（不该出现，出现了就是误伤）
    hop 前置              页面/结构/绑定的拦截语（缺 SPEC 时才该出现）

⚠ 载荷必须照抄真机那一发（本仓 §一之二）。三处照抄，不许自己拼：

    ① 停泊放行发的是 `{"skip": true}`，不是 `{"answer": …}`。
      前端 useSlideRuleSession:778 `void releaseRun({ skip: true })`。
    ② 放行之后**还要再发一轮**「假设已确认。继续画页面。」并带
      `forcedTool: "pages"`。第一版漏了这一轮，于是 SPEC 出完就
      factory_complete、页面 0 份，看着像回归，其实是探针少走一步——
      `rehearsal_control:2531` 明写「开始推演 = 第一件 spec，其余进待办」。
    ③ 放行要另一条线程。假设卡把 SSE 停在 run_pause_started 上等人，
      串行读完再放行 = 永远读不完（2026-09-09 两支探针各挂 14 分钟）。
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple
from urllib import error, request

BASE = os.environ.get("REAL_TOPIC_BASE", "http://127.0.0.1:9700")
API = "/api/sliderule"
KEY = os.environ.get("SLIDE_RULE_INTERNAL_KEY", "")
TOPIC = os.environ.get(
    "PROBE_TOPIC",
    "做一个社区图书角的借还系统：登记书目、扫码借出、到期提醒、管理员首页看在借清单",
)
DEADLINE = float(os.environ.get("PROBE_DEADLINE_SEC", "2400"))
OUT = os.environ.get("PROBE_RAW", "")
_opener = request.build_opener(request.ProxyHandler({}))


def _req(path: str, body: Optional[Dict[str, Any]], headers: Dict[str, str], method: str):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in headers.items():
        req.add_header(k, v)
    return req


def post(path: str, body: Dict[str, Any], headers: Dict[str, str]) -> str:
    try:
        return _opener.open(_req(path, body, headers, "POST"), timeout=60).read().decode("utf-8", "replace")
    except error.HTTPError as exc:
        return exc.read().decode("utf-8", "replace")


def get(path: str, headers: Dict[str, str]) -> str:
    try:
        return _opener.open(_req(path, None, headers, "GET"), timeout=60).read().decode("utf-8", "replace")
    except error.HTTPError as exc:
        return exc.read().decode("utf-8", "replace")


def main() -> int:
    email = os.environ.get("REAL_TOPIC_EMAIL", "")
    password = os.environ.get("REAL_TOPIC_PASSWORD", "")
    if not (email and password and KEY):
        print("跳过：缺账号或 SLIDE_RULE_INTERNAL_KEY。")
        return 0
    token = json.loads(post(f"{API}/account/login", {"email": email, "password": password}, {}))["token"]
    headers = {"Authorization": f"Bearer {token}", "x-internal-key": KEY}
    sid = f"probe-build-{int(time.time())}"
    post(f"{API}/sessions", {"sessionId": sid, "goal": {"text": ""}}, headers)
    print(f"[probe] session={sid}\n[probe] 话题：{TOPIC}", flush=True)

    released: set = set()
    seen: Counter = Counter()
    todos: List[str] = []
    flags: List[str] = []
    all_events: List[Dict[str, Any]] = []
    run_id = ""
    t0 = time.time()

    def release(rid: str) -> None:
        body = post(f"{API}/runs/{rid}/release", {"skip": True}, headers)
        print(f"  [放行] run={rid[:12]} -> {body.strip()[:60]}", flush=True)

    def snapshot() -> Tuple[int, List[str], str]:
        raw = get(f"{API}/sessions/{sid}", headers)
        try:
            st = json.loads(raw)
            st = st.get("session") or st.get("state") or st
        except Exception:
            return -1, [], "读不到"
        # ⚠ 页面落在 `specFirstPages.pages`。第一版读 `appBundle.pages`——
        #   spec-first 那条线上 appBundle 恒为 {}，于是真机明明
        #   「页面落库：3 份」，探针照样打印 0 份。判据读了一个永远空的键，
        #   长得跟"真的没画出来"一模一样（本仓 §三）。
        sfp = st.get("specFirstPages") or {}
        pages = (
            (sfp.get("pages") if isinstance(sfp, dict) else None)
            or (st.get("appBundle") or {}).get("pages")
            or st.get("pages")
            or []
        )
        # ⚠ factoryTodo 是**一串名字**（capability_plan.merge_factory_todo 返回
        #   tuple），不是 {"open": [...]}。第一版按后者读，于是待办永远打印
        #   `[]`——正好长得跟"清空了"一样（本仓 §三：正向判据齐全，反向缺失）。
        todo = st.get("factoryTodo")
        if isinstance(todo, dict):
            open_hops = todo.get("open") or []
        elif isinstance(todo, (list, tuple)):
            open_hops = list(todo)
        else:
            open_hops = []
        return len(pages), [str(x) for x in open_hops], str(st.get("runtimePhase"))

    turns: List[Tuple[str, Optional[str]]] = [
        (TOPIC, None),
        ("假设已确认。继续画页面。", "pages"),
        ("继续", None),
        ("继续", None),
    ]

    for idx, (text, forced) in enumerate(turns):
        if time.time() - t0 > DEADLINE:
            print("  [止] 到点了，不再发新轮", flush=True)
            break
        payload: Dict[str, Any] = {
            "sessionId": sid,
            "userText": text,
            "installedSkills": [],
            "activeConnectors": [],
            "preferredDevice": "desktop",
            "designSystemId": None,
        }
        if forced:
            payload["forcedTool"] = forced
        print(f"\n── 第 {idx + 1} 轮：{text[:24]}  forcedTool={forced}", flush=True)
        resp = _opener.open(_req(f"{API}/control-turn-stream", payload, headers, "POST"), timeout=DEADLINE)
        buf, stop = "", False
        while not stop and time.time() - t0 < DEADLINE:
            chunk = resp.read1(8192) if hasattr(resp, "read1") else resp.read(8192)
            if not chunk:
                break
            buf += chunk.decode("utf-8", "replace")
            while "\n\n" in buf:
                block, buf = buf.split("\n\n", 1)
                line = next((l for l in block.splitlines() if l.startswith("data:")), "")
                if not line:
                    continue
                try:
                    ev = json.loads(line[5:].strip())
                except Exception:
                    continue
                et = str(ev.get("type") or "")
                seen[et] += 1
                all_events.append(ev)
                el = int(time.time() - t0)
                if et == "control_handoff_factory":
                    run_id = str(ev.get("runId") or "")
                    print(f"  [点火] runId={run_id[:16]}  {el}s", flush=True)
                elif et == "control_todo":
                    todos.append(str(ev.get("line") or ""))
                    print(f"  [清单] {ev.get('line')}", flush=True)
                elif et == "control_tool_start":
                    print(f"  [工具] {ev.get('tool') or ev.get('name')}  {el}s", flush=True)
                elif et == "run_pause_started":
                    print(f"  [停泊] where={ev.get('where')}  {el}s", flush=True)
                    if run_id and run_id not in released:
                        released.add(run_id)
                        threading.Thread(target=release, args=(run_id,), daemon=True).start()
                elif et in ("stage", "stage_done", "phase_change"):
                    print(f"  [阶段] {ev.get('stage') or ev.get('phase')} {ev.get('ms') or ''}  {el}s", flush=True)
                elif et in ("control_stop", "control_error", "error", "run_error"):
                    flags.append(json.dumps(ev, ensure_ascii=False)[:400])
                    print(f"  [!] {et} {json.dumps(ev, ensure_ascii=False)[:220]}", flush=True)
                if et in ("complete", "factory_complete"):
                    print(f"  [收] {et}  {el}s", flush=True)
                    stop = True
                    break
        resp.close()
        n_pages, open_hops, phase = snapshot()
        print(f"  → 页面 {n_pages} 份 · 待办 {open_hops} · phase={phase}", flush=True)
        if n_pages > 0 and not open_hops:
            print("  [完] 页面出来了、待办清空，不再往下发", flush=True)
            break

    print("\n=== 事件计数 ===")
    for k, v in seen.most_common():
        print(f"  {v:>4}  {k}")
    n_pages, open_hops, phase = snapshot()
    print(f"\n清单行 {len(todos)} 条")
    print(f"页面落库：{n_pages} 份 · 待办 {open_hops} · runtimePhase={phase}")
    if flags:
        print("\n=== 需要看一眼的事件 ===")
        for f in flags:
            print("  " + f)
    if OUT:
        with open(OUT, "w", encoding="utf-8") as fh:
            json.dump(all_events, fh, ensure_ascii=False, indent=2)
        print(f"\n原始流：{OUT}")
    print(f"\n总耗时 {time.time() - t0:.0f}s · session={sid}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
