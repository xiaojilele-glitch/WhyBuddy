"""对照正文，把标题 A 档再筛一轮。

    cd slide-rule-python
    .venv/bin/python scripts/forum_fit_body.py              # 只判还没正文档的标题 A
    .venv/bin/python scripts/forum_fit_body.py --workers 4
    .venv/bin/python scripts/forum_fit_body.py --all        # 307 条标题 A 全部重判
    .venv/bin/python scripts/forum_fit_body.py --report

## 为什么不能覆盖 fit_grade

标题那一轮把「删帖删帖删帖」「111111你好。」也打成了 A。那是标题幻觉，
不是正文坐实。正文档写 `fit_body_*`，标题档留着，才能回答「307 里掉了多少」。

## 三条纪律（沿用 forum_fit_grade）

① 分批立刻写库。② 给模型看 1..N 行号，本地再映射 topic_id。
③ 漏判标 U，不许拿 C 填空——填空会把本该入选的踢掉还看不出来。

正文过短（删帖、乱码、只剩外链导航）不调模型，直接 U。缺证据就是缺。
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from forum_neon import FIT_GRADES, Store

BATCH = 8
RETRIES = 3
DEFAULT_WORKERS = 4
#: 帖子中位约 3500 字；开头通常是简介/角色/功能。更长的正文后半截是 TRAE
#: Session ID 和截图说明，喂进去只会稀释判据。
BODY_CHARS = 3200
#: 真机最短三条：6 字「删帖删帖删帖」、9 字「111111你好。」、104 字纯外链目录。
SHORT_BODY = 200

RUBRIC = """你在复核一批已经被标题判成 A 的参赛作品。现在给你看正文摘录。
标题不算证据。必须正文里能指出实体、角色、流转，才能维持 A。

判定基准产品 SlideRule：输入业务意图，输出企业应用数字孪生（数据实体 /
角色权限 / 审批流转 / 页面 / AI 能力）。只擅长表单+台账+角色+流转。

A = 正文能看出至少两类角色，以及申请/审批/派单/工单/台账状态流转之一。
    包装成小程序也算。
B = 正文主要是个人工具、内容、推荐、对话、分析、学习；或许有列表页，
    但没有多角色流转。
C = 正文是游戏、3D、硬件固件、音视频、图像生成、纯创作、模拟器、低代码
    底座（让别人去造系统，自己不是那套业务）。
U = 正文空洞、删帖、乱码、只剩链接/导航，无法坐实。不要猜成 A/B/C。

只输出 JSON：{"items":[{"i":行号,"grade":"A|B|C|U","why":"12字以内"}]}
行号是每段开头的数字，从 1 开始，必须和输入一一对应。"""


def clip_body(text: str, limit: int = BODY_CHARS) -> str:
    """去掉配图 markdown，截到预算。后半截 Session ID 对分档没有信息。"""
    raw = (text or "").replace("\x00", " ")
    raw = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", raw)
    raw = re.sub(r"\s+", " ", raw).strip()
    if len(raw) <= limit:
        return raw
    return raw[:limit] + "…"


def too_short(body: str) -> bool:
    return len(clip_body(body)) < SHORT_BODY


def parse_grades(
    items: list[Any],
    rows: list[tuple[int, str, str]],
) -> dict[int, tuple[str, str]]:
    """行号 1..N → topic_id。漏的、越界的、非法档都丢掉，不填空。

    ⚠ 2026-08-05 标题档用 topic_id 当行号，模型改写成 1、2、3…，374 条
    静默对不上。这里沿用同一条：模型只碰行号。
    """
    out: dict[int, tuple[str, str]] = {}
    if not isinstance(items, list):
        return out
    for it in items:
        if not isinstance(it, dict):
            continue
        grade = str(it.get("grade") or "").strip().upper()[:1]
        if grade not in FIT_GRADES:
            continue
        try:
            lineno = int(it["i"])
        except (KeyError, TypeError, ValueError):
            continue
        if not 1 <= lineno <= len(rows):
            continue
        out[rows[lineno - 1][0]] = (grade, str(it.get("why") or "")[:60])
    return out


def classify(rows: list[tuple[int, str, str]], model: str) -> dict[int, tuple[str, str]]:
    """rows = (topic_id, title, body)。返回 {topic_id: (档, 理由)}。"""
    import httpx

    user_lines = []
    for lineno, (_tid, title, body) in enumerate(rows, 1):
        user_lines.append(f"{lineno}. 标题：{title}\n正文：{clip_body(body)}")
    resp = httpx.post(
        f'{os.environ["LLM_BASE_URL"].rstrip("/")}/chat/completions',
        headers={"Authorization": f'Bearer {os.environ["LLM_API_KEY"]}'},
        json={
            "model": model,
            "stream": False,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": RUBRIC},
                {"role": "user", "content": "\n\n".join(user_lines)},
            ],
        },
        timeout=300,
    )
    resp.raise_for_status()
    payload = json.loads(resp.json()["choices"][0]["message"]["content"])
    return parse_grades(payload.get("items") or [], rows)


def write_back(db: Store, model: str, graded: dict[int, tuple[str, str]]) -> int:
    """一条语句更新整批。returning 数落地行，不信发出去的条数。"""
    if not graded:
        return 0
    rows, params = [], []
    for topic_id, (grade, why) in graded.items():
        base = len(params)
        rows.append(f"(${base + 1}::int, ${base + 2}, ${base + 3})")
        params.extend([topic_id, grade, why])
    params.append(model)
    landed = db.q(
        f"update forum_topic set fit_body_grade = v.g, fit_body_reason = v.r, "
        f"fit_body_model = ${len(params)}, fit_body_at = now() "
        f"from (values {', '.join(rows)}) as v(tid, g, r) "
        f"where forum_topic.topic_id = v.tid "
        f"returning forum_topic.topic_id",
        params,
    )
    return len(landed)


def report(db: Store) -> None:
    total_a = int(
        db.q("select count(*)::int as n from forum_topic where fit_grade='A'")[0]["n"]
    )
    rows = db.q(
        "select coalesce(fit_body_grade, '-') as g, count(*)::int as n "
        "from forum_topic where fit_grade='A' group by 1 order by 1"
    )
    print(f"\n标题 A 共 {total_a} 条；正文复核：")
    for r in rows:
        g, n = r["g"], int(r["n"])
        label = "还没复核" if g == "-" else FIT_GRADES.get(g, g)
        if g == "U":
            label = "正文不足以坐实（删帖/过短/只有链接）"
        bar = "█" * round(n / max(total_a, 1) * 36)
        print(f"  {g}  {n:>3} 帖  {bar:<36} {n / max(total_a, 1) * 100:5.1f}%  {label}")
    still = int(
        db.q(
            "select count(*)::int as n from forum_topic "
            "where fit_grade='A' and fit_body_grade='A'"
        )[0]["n"]
    )
    print(f"\n仍适合做应用（正文仍为 A）：{still} / {total_a}")


def _opt(argv: list[str], name: str, default: int) -> int:
    return int(argv[argv.index(name) + 1]) if name in argv else default


def main() -> None:
    argv = sys.argv[1:]
    args = set(argv)
    db = Store()
    db.ensure_table()

    if "--report" in args:
        report(db)
        return

    where = "where fit_grade = 'A'"
    if "--all" not in args:
        where += " and fit_body_grade is null"
    fetched = db.q(
        "select topic_id, title, left(coalesce(body_text,''), 4000) as body, "
        "length(coalesce(body_text,''))::int as body_len "
        f"from forum_topic {where} order by topic_id"
    )
    if not fetched:
        print("没有待复核的标题 A（要重判加 --all）")
        report(db)
        return

    short: dict[int, tuple[str, str]] = {}
    todo: list[tuple[int, str, str]] = []
    for r in fetched:
        tid = int(r["topic_id"])
        title = str(r["title"] or "")
        body = str(r["body"] or "")
        if too_short(body):
            short[tid] = ("U", "正文过短无法坐实")
        else:
            todo.append((tid, title, body))

    model = os.environ.get("LLM_MODEL") or ""
    if todo and (not model or not os.environ.get("LLM_API_KEY")):
        raise SystemExit("缺 LLM_MODEL / LLM_API_KEY")

    if short:
        landed = write_back(db, "short-body", short)
        print(f"正文过短直接 U：{landed} 条")

    chunks = [todo[i : i + BATCH] for i in range(0, len(todo), BATCH)]
    workers = int(_opt(argv, "--workers", DEFAULT_WORKERS))
    print(f"待模型复核 {len(todo)} 条，分 {len(chunks)} 批，并发 {workers}，模型 {model}")

    tally = {"done": 0, "failed": 0, "lost": 0, "n": 0}
    lock = threading.Lock()
    started = time.monotonic()

    def one(indexed: tuple[int, list[tuple[int, str, str]]]) -> None:
        n, chunk = indexed
        for attempt in range(RETRIES):
            try:
                t0 = time.perf_counter()
                graded = classify(chunk, model)
                with lock:
                    landed = write_back(db, model, graded)
                    tally["done"] += landed
                    tally["lost"] += len(graded) - landed
                    tally["n"] += 1
                    seen = tally["n"]
                notes = []
                if len(chunk) - len(graded):
                    notes.append(f"{len(chunk) - len(graded)} 条模型没给")
                if len(graded) - landed:
                    notes.append(f"⚠️ {len(graded) - landed} 条没落库")
                tail = ("，" + "，".join(notes) + "（留空，下次重跑会再判）") if notes else ""
                print(
                    f"  [{seen}/{len(chunks)}] 批 {n} 落地 {landed} 条 / "
                    f"{time.perf_counter() - t0:.0f}s{tail}",
                    flush=True,
                )
                return
            except Exception as exc:  # noqa: BLE001
                print(
                    f"  批 {n} 第 {attempt + 1} 次失败："
                    f"{type(exc).__name__} {str(exc)[:100]}",
                    flush=True,
                )
                time.sleep(3 * (attempt + 1))
        with lock:
            tally["failed"] += len(chunk)
            tally["n"] += 1

    indexed = list(enumerate(chunks, 1))
    if workers <= 1 or len(indexed) <= 1:
        for item in indexed:
            one(item)
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(one, indexed))

    dur = time.monotonic() - started
    parts = [f"模型落地 {tally['done']} 条", f"用时 {dur:.0f}s"]
    if tally["lost"]:
        parts.append(f"⚠️ {tally['lost']} 条判出来了但没落库")
    if tally["failed"]:
        parts.append(f"{tally['failed']} 条整批失败")
    if tally["lost"] or tally["failed"]:
        parts.append("重跑本命令会自动补上（只挑 fit_body_grade 为空的）")
    print("\n" + "，".join(parts))
    report(db)


if __name__ == "__main__":
    main()
