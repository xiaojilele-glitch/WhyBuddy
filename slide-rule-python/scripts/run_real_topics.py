# -*- coding: utf-8 -*-
"""真实话题夜跑：真 LLM、真 HTTP、真会话，不开浏览器。

## 为什么要有这一份

`tests/` 里那套跑的是 `ControlHarness` —— 桩掉 LLM，喂回一个写死的
tool_call。它能证明「拿到这个 tool_call 之后分发对不对」，**证明不了**
「真模型看着这一轮的工具清单会不会挑那件工具」。第 2 / 5 / 7 格那几条
（问候不弹问卷、真产品第一句进环、不问产品类型）恰恰全是后者——
判据全绿而真机翻车，本仓 §一 记了三次。

浏览器跑能验，但一轮几十秒、还得盯着看。脚本跑同一条 HTTP，
一次把几条话题跑完，醒了看报告。

## 跑法

    python scripts/run_real_topics.py                  # 全部
    python scripts/run_real_topics.py --only greeting  # 只跑一条
    python scripts/run_real_topics.py --base http://127.0.0.1:9700

前置：后端已起（`uvicorn app:app --port 9700`），`.env` 里有真 LLM key
与登录账号。缺任何一样都**跳过并说清楚**，不当失败——CI 上没有真 key。

账号从环境变量读，不写进仓：REAL_TOPIC_EMAIL / REAL_TOPIC_PASSWORD。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from urllib import error, request

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "data" / "checkpoints" / "real-topics-report.md"
BASE = os.environ.get("REAL_TOPIC_BASE", "http://127.0.0.1:9700")
API = "/api/sliderule"


def _post_stream(
    url: str,
    body: Dict[str, Any],
    headers: Dict[str, str],
    *,
    stop_types: tuple = ("complete",),
    max_seconds: int = 240,
) -> List[Dict[str, Any]]:
    """边收边判，拿到判据就断开——**不等它把整个应用建完**。

    ⚠ 2026-09-08：第一版把整条 SSE 读完才解析。真产品第一句会一路建到
      交付（真机 >15 分钟，一个 HTTP 请求同步跑完），脚本 900 秒超时，
      于是「第 5/7 格」永远拿不到结论。而这些判据要看的是**头几个事件**：
      有没有出复述卡、有没有反过来问产品类型。收到就够了，剩下的建它的。
    """
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in headers.items():
        req.add_header(k, v)
    opener = request.build_opener(request.ProxyHandler({}))
    out: List[Dict[str, Any]] = []
    deadline = time.time() + max_seconds
    try:
        resp = opener.open(req, timeout=max_seconds)
    except error.HTTPError as exc:
        body_text = ""
        try:
            body_text = exc.read().decode("utf-8", "replace")[:600]
        except Exception:  # noqa: BLE001
            pass
        raise RuntimeError(f"HTTP {exc.code} {url}\n{body_text}") from None
    try:
        for raw_line in resp:
            line = raw_line.decode("utf-8", "replace").strip()
            if line.startswith("data:"):
                payload = line[5:].strip()
                if payload:
                    try:
                        out.append(json.loads(payload))
                    except json.JSONDecodeError:
                        pass
                    if str(out[-1].get("type") or "") in stop_types:
                        break
            if time.time() > deadline:
                out.append({"type": "__timeout__"})
                break
    finally:
        resp.close()
    return out


def _post(url: str, body: Dict[str, Any], headers: Dict[str, str], timeout: int = 900) -> str:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in headers.items():
        req.add_header(k, v)
    # 本机直连，别走 agent proxy（NO_PROXY 在容器里已含 127.0.0.1，
    # 但 urllib 仍会读 registry/env，显式用 ProxyHandler({}) 更稳）。
    opener = request.build_opener(request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", "replace")
    except error.HTTPError as exc:
        # ⚠ 只报「HTTP 400」等于什么都没说。服务端的正文里写着到底哪个字段
        #   不合法，把它带出来——不然下一个人还得再手 curl 一遍。
        body = ""
        try:
            body = exc.read().decode("utf-8", "replace")[:600]
        except Exception:  # noqa: BLE001
            pass
        raise RuntimeError(f"HTTP {exc.code} {url}\n{body}") from None


def parse_sse(text: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for line in (text or "").splitlines():
        s = line.strip()
        if not s.startswith("data:"):
            continue
        raw = s[5:].strip()
        if not raw:
            continue
        try:
            out.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return out


def types_of(events: List[Dict[str, Any]]) -> List[str]:
    return [str(e.get("type") or "") for e in events]


@dataclass
class Scenario:
    key: str
    title: str
    panel: str
    turns: List[str]
    check: Callable[[List[List[Dict[str, Any]]]], List[str]]
    seed_goal: str = ""
    #: 收到其中任一事件就断开。真产品会一路建到交付，判据不必等它建完。
    stop_types: tuple = ("complete",)


def _first(events: List[Dict[str, Any]], t: str) -> Optional[Dict[str, Any]]:
    for e in events:
        if str(e.get("type") or "") == t:
            return e
    return None


# ── 判据：每条都写「哪一格 / 错了会看见什么」 ───────────────────────
def check_greeting(rounds: List[List[Dict[str, Any]]]) -> List[str]:
    """第 2 格：问候不许弹产品问卷，也不许开范围卡。"""
    bad: List[str] = []
    ev = rounds[0]
    ts = types_of(ev)
    if "control_scope_card" in ts:
        card = _first(ev, "control_scope_card") or {}
        bad.append(f"问候开了范围卡：restatement={card.get('restatement')!r}")
    if "control_clarify" in ts:
        bad.append("问候弹了澄清问卷（第 2 格就是要干掉这个）")
    if "complete" not in ts:
        bad.append(f"没有终止事件，前端会转圈：{ts}")
    if "control_handoff_factory" in ts:
        bad.append("问候点着了工厂")
    return bad


def check_real_product(rounds: List[List[Dict[str, Any]]]) -> List[str]:
    """第 5/7 格：真产品第一句要被复述认下来，不许反过来考产品类型。"""
    bad: List[str] = []
    ev = rounds[0]
    ts = types_of(ev)
    # 断在 handoff 上是**故意的**（不等它建完），此时没有 complete 不算问题；
    # 一路到底却没有 complete 才是前端转圈那条伤。
    if "complete" not in ts and "control_handoff_factory" not in ts:
        bad.append(f"既没点火也没有终止事件：{ts}")
    if "__timeout__" in ts:
        bad.append(f"到判据超时都没收到该收的事件：{ts}")
    if "control_clarify" in ts:
        bad.append("真产品第一句还在弹澄清问卷")
    card = _first(ev, "control_scope_card")
    if card is None:
        bad.append(f"没出复述卡：{ts}")
    else:
        r = str(card.get("restatement") or "")
        if not r:
            bad.append("复述卡是空的")
        # 第 5 格：卡上不许拿产品类型当必答题
        for w in ("请选择", "产品类型", "先选"):
            if w in r:
                bad.append(f"复述句里在考产品类型：{r!r}")
                break
    ask = _first(ev, "control_ask_user")
    if ask is not None:
        q = str(ask.get("question") or "")
        for w in ("类型", "平台", "设备", "端"):
            if w in q:
                bad.append(f"真产品第一句反过来问类型/设备：{q!r}")
                break
    return bad


def check_hop_is_one(rounds: List[List[Dict[str, Any]]]) -> List[str]:
    """第 4 格：点一件跑一件，不许把课表焊回来。"""
    bad: List[str] = []
    ev = rounds[-1]
    ts = types_of(ev)
    if "complete" not in ts:
        bad.append(f"没有终止事件：{ts}")
    for e in ev:
        if str(e.get("type") or "") != "control_handoff_factory":
            continue
        tools = e.get("tools") or (e.get("goal") or {}).get("tools")
        if isinstance(tools, (list, tuple)) and len(tools) > 1:
            bad.append(f"一次交回焊了 {len(tools)} 跳：{list(tools)}")
    return bad


def check_slash_ignites(rounds: List[List[Dict[str, Any]]]) -> List[str]:
    """2026-09-09 拆闸：`/推演 <真产品>` 直接点火，不要求再点一次按钮。

    反向面在 check_greeting：没有产品时一次火都不点。
    """
    bad: List[str] = []
    ev = rounds[0]
    ts = types_of(ev)
    if "control_handoff_factory" not in ts:
        bad.append(f"有真产品的 /推演 没点火（门禁是不是又装回去了）：{ts}")
    if "control_scope_card" not in ts:
        bad.append(f"点火了但没给复述回执——用户看不到你认成了什么：{ts}")
    if "control_clarify" in ts:
        bad.append("clarify 又出现了（应已整件退役）")
    return bad


def check_no_questionnaire(rounds: List[List[Dict[str, Any]]]) -> List[str]:
    """含糊的产品话也不许弹模板问卷——维度问题归 SPEC 假设卡。"""
    bad: List[str] = []
    ev = rounds[0]
    ts = types_of(ev)
    if "control_clarify" in ts:
        bad.append(f"含糊产品话弹了澄清问卷：{ts}")
    if "complete" not in ts and "control_handoff_factory" not in ts:
        bad.append(f"既没点火也没有终止事件：{ts}")
    return bad


def check_gibberish_never_builds(rounds: List[List[Dict[str, Any]]]) -> List[str]:
    """乱码不许被当成产品名造出来（2026-09-09 真机 sfljsdlf 那次的形状）。

    第一轮问候 → 系统问一句；第二轮回一串乱码 → 不许「我认成了：xxx」+ 开工。
    """
    bad: List[str] = []
    for i, ev in enumerate(rounds):
        ts = types_of(ev)
        if "control_handoff_factory" in ts:
            bad.append(f"第 {i + 1} 轮就点了火：{ts}")
        card = _first(ev, "control_scope_card")
        if card is not None:
            bad.append(f"第 {i + 1} 轮把乱码复述成了产品：{card.get('restatement')!r}")
    if "complete" not in types_of(rounds[-1]):
        bad.append(f"最后一轮没有终止事件：{types_of(rounds[-1])}")
    return bad


def check_topic_survives_a_short_confirm(
    rounds: List[List[Dict[str, Any]]]
) -> List[str]:
    """说过产品之后只回一句短确认，话题不许丢。

    2026-09-09 修的那个缺口：只看最后一句，短确认就判空，于是反过来问
    「想做什么应用」——用户会读成"你刚才说的我没听见"。
    """
    bad: List[str] = []
    last = rounds[-1]
    ts = types_of(last)
    ask = _first(last, "control_ask_user")
    if ask is not None and "想做什么应用" in str(ask.get("question") or ""):
        bad.append("短确认之后把前面说过的话题丢了，又问「想做什么应用」")
    if "control_handoff_factory" not in ts and "control_scope_card" not in ts:
        bad.append(f"既没认下来也没开工：{ts}")
    return bad


def check_long_vague_is_not_a_product(
    rounds: List[List[Dict[str, Any]]]
) -> List[str]:
    """一长段没有产品的废话，不许因为"字够多"就开工。

    CLAUDE.md 记过反过来的坑：靠字数判断"够不够具体"，100 字废话照样放行。
    """
    bad: List[str] = []
    ts = types_of(rounds[0])
    if "control_handoff_factory" in ts:
        card = _first(rounds[0], "control_scope_card") or {}
        bad.append(
            f"一段没有产品的长文被当成产品开工了：{card.get('restatement')!r}"
        )
    return bad


SCENARIOS: List[Scenario] = [
    Scenario(
        key="greeting",
        title="问候不弹问卷",
        panel="第 2 格",
        turns=["你好"],
        check=check_greeting,
    ),
    Scenario(
        key="fruit-shop",
        title="真产品第一句进环",
        panel="第 5/7 格",
        turns=["做个水果店收银台"],
        check=check_real_product,
        stop_types=("control_handoff_factory", "complete"),
    ),
    Scenario(
        key="clinic",
        title="另一句真产品（换话题，防止只对水果店调好）",
        panel="第 5/7 格",
        turns=["做一个社区诊所的挂号与排队叫号系统"],
        check=check_real_product,
        stop_types=("control_handoff_factory", "complete"),
    ),
    Scenario(
        key="capability-question",
        title="你能做什么 —— 是提问不是产品",
        panel="第 2 格",
        turns=["你能做什么"],
        check=check_greeting,
    ),
    Scenario(
        key="slash-ignites",
        title="/推演 带真产品直接点火（门禁已拆）",
        panel="第 5/7 格",
        turns=["/推演 做一个社区书店的库存与会员系统"],
        check=check_slash_ignites,
        stop_types=("control_handoff_factory", "complete"),
    ),
    Scenario(
        key="vague-product",
        title="含糊产品话不弹模板问卷（clarify 已退役）",
        panel="第 2 格",
        turns=["做个诊所系统"],
        check=check_no_questionnaire,
        stop_types=("control_handoff_factory", "complete"),
    ),
    Scenario(
        key="gibberish",
        title="乱码回执不许被造成应用",
        panel="第 2 格",
        turns=["你好", "sfljsdlf"],
        check=check_gibberish_never_builds,
    ),
    Scenario(
        key="topic-survives",
        title="说完产品再回一句短确认，话题不许丢",
        panel="第 3 格",
        turns=["做一个门店排班与考勤系统", "就按上面这个推演"],
        check=check_topic_survives_a_short_confirm,
        stop_types=("control_handoff_factory", "complete"),
    ),
    Scenario(
        key="long-vague",
        title="长篇废话不是产品（不许按字数放行）",
        panel="第 2 格",
        turns=[
            "我最近在想一些事情，感觉现在的工作方式有很多可以改进的地方，"
            "团队之间沟通的成本挺高的，信息也比较散，"
            "有时候一件事要问好几个人才能弄清楚，效率上确实还有提升空间，"
            "你觉得呢，这种情况一般大家都是怎么处理的"
        ],
        check=check_long_vague_is_not_a_product,
        # 断在 handoff 上：这条要是红了，它会一路造到 SPEC（真机几分钟），
        # 判据窗口会先超时，报出来的就成了「超时」而不是「它把废话当产品了」。
        stop_types=("control_handoff_factory", "complete"),
    ),
    Scenario(
        key="english-product",
        title="英文产品话同样进环（不是只认中文）",
        panel="第 5/7 格",
        turns=["Build a small inventory tracker for a coffee shop"],
        check=check_real_product,
        stop_types=("control_handoff_factory", "complete"),
    ),
    Scenario(
        key="followup-change",
        title="造完之后再提一句改动（续做不是新话题）",
        panel="第 3 格",
        turns=["做一个宠物店会员卡系统", "再加一个到期提醒"],
        check=check_topic_survives_a_short_confirm,
        stop_types=("control_handoff_factory", "complete"),
    ),
    Scenario(
        key="chitchat",
        title="闲聊句不许被当成产品开卡（真机截图 2026-09-09）",
        panel="第 2 格",
        turns=["ksdfjlsdf", "你好啊", "困了，想去睡觉"],
        check=check_gibberish_never_builds,
    ),
]


def login(email: str, password: str) -> str:
    body = _post(f"{BASE}{API}/account/login", {"email": email, "password": password}, {})
    tok = json.loads(body).get("token")
    if not tok:
        raise RuntimeError(f"登录没拿到 token：{body[:200]}")
    return str(tok)


def run_scenario(sc: Scenario, token: str, key: str) -> Dict[str, Any]:
    sid = f"real-{sc.key}-{int(time.time())}"
    headers = {"Authorization": f"Bearer {token}", "x-internal-key": key}
    # 会话得先存在：control-turn-stream 在开 SSE 之前就 load_session，
    # 拿不到直接 400（那段注释写了为什么不能等流开了再报）。
    # goal 传空串，跟前端 `createSessionId()` 同一份载荷。省掉 goal 会走
    # 服务端兜底——那条路曾把 goal 填成字面量 "default"（见该路由注释）。
    _post(f"{BASE}{API}/sessions", {"sessionId": sid, "goal": {"text": ""}}, headers)
    rounds: List[List[Dict[str, Any]]] = []
    started = time.time()
    for text in sc.turns:
        payload = {
            "sessionId": sid,
            "userText": text,
            "installedSkills": [],
            "activeConnectors": [],
            "preferredDevice": "desktop",
            "designSystemId": None,
        }
        events = _post_stream(
            f"{BASE}{API}/control-turn-stream",
            payload,
            headers,
            stop_types=sc.stop_types,
        )
        # 原始流留档：判据只看事件名，出问题时要看字段（restatement 是什么、
        # 谁点的火）。不留档就得重跑一次真 LLM。
        dump = REPORT.parent / "raw" / f"{sid}-{len(rounds)}.json"
        dump.parent.mkdir(parents=True, exist_ok=True)
        dump.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
        rounds.append(events)
    problems = sc.check(rounds)
    return {
        "key": sc.key,
        "title": sc.title,
        "panel": sc.panel,
        "sessionId": sid,
        "seconds": round(time.time() - started, 1),
        "events": [types_of(r) for r in rounds],
        "problems": problems,
        "ok": not problems,
    }


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只跑这个 key")
    ap.add_argument("--base", help="后端地址")
    args = ap.parse_args(argv)
    global BASE
    if args.base:
        BASE = args.base

    email = os.environ.get("REAL_TOPIC_EMAIL", "")
    password = os.environ.get("REAL_TOPIC_PASSWORD", "")
    key = os.environ.get("SLIDE_RULE_INTERNAL_KEY", "")
    if not (email and password and key):
        print("跳过：缺 REAL_TOPIC_EMAIL / REAL_TOPIC_PASSWORD / SLIDE_RULE_INTERNAL_KEY。")
        return 0
    try:
        request.build_opener(request.ProxyHandler({})).open(f"{BASE}/health", timeout=5)
    except (error.URLError, OSError) as exc:
        print(f"跳过：后端不在 {BASE}（{exc}）。先起 uvicorn。")
        return 0

    token = login(email, password)
    picked = [s for s in SCENARIOS if not args.only or s.key == args.only]
    results: List[Dict[str, Any]] = []
    for sc in picked:
        print(f"── {sc.panel} {sc.title} …", flush=True)
        try:
            r = run_scenario(sc, token, key)
        except Exception as exc:  # noqa: BLE001 — 一条炸了不许拖垮其余
            r = {
                "key": sc.key, "title": sc.title, "panel": sc.panel,
                "seconds": 0, "events": [], "ok": False,
                "problems": [f"跑挂了：{type(exc).__name__}: {exc}"],
            }
        results.append(r)
        mark = "✅" if r["ok"] else "❌"
        print(f"   {mark} {r['seconds']}s  {r['events']}")
        for p in r["problems"]:
            print(f"      · {p}")

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 真实话题夜跑报告",
        "",
        f"- 时间：{datetime.now(timezone.utc).isoformat()}",
        f"- 后端：{BASE}",
        f"- 模型：{os.environ.get('LLM_MODEL', '(未读到)')}",
        "",
        "| 格 | 话题 | 结果 | 秒 | 事件 |",
        "|---|---|---|---:|---|",
    ]
    for r in results:
        mark = "✅" if r["ok"] else "❌"
        ev = " / ".join(",".join(x) for x in r["events"]) or "—"
        lines.append(f"| {r['panel']} | {r['title']} | {mark} | {r['seconds']} | `{ev}` |")
    bad = [r for r in results if not r["ok"]]
    if bad:
        lines += ["", "## 问题"]
        for r in bad:
            lines.append(f"### {r['panel']} {r['title']}（{r.get('sessionId','')}）")
            for p in r["problems"]:
                lines.append(f"- {p}")
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n报告：{REPORT}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
