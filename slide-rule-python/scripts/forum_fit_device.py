"""给正文 A 档标主交付端：phone / desktop / both / unknown。

    .venv/bin/python scripts/forum_fit_device.py
    .venv/bin/python scripts/forum_fit_device.py --report

词表跟 device_policy 一致（desktop/phone）。both 是业务系统常见形态
（C 端小程序 + B 端后台），unknown 是正文没写端——缺证据不猜。
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from forum_fit_body import clip_body
from forum_neon import Store

BATCH = 10
RETRIES = 3
DEFAULT_WORKERS = 4
DEVICES = ("phone", "desktop", "both", "unknown")
LABELS = {
    "phone": "纯移动：小程序 / App / H5",
    "desktop": "纯 PC：网页后台 / 桌面客户端 / 中台",
    "both": "双端：C 端手机 + B 端电脑",
    "unknown": "正文看不出主交付端",
}

RUBRIC = """你在给参赛作品标主交付端。只看正文里产品怎么给用户用，不看「微信通知」这种旁支。

phone = 主界面是小程序、手机 App、H5、竖屏。没有单独的电脑后台作为产品。
desktop = 主界面是 PC 网页、桌面客户端、管理后台、中台、工作台。没有小程序/App 当用户主入口。
both = 正文同时写了 C 端手机（小程序/App）和 B 端电脑后台，两套都是要交付的。
unknown = 看不出，或只给了可下载 HTML/演示视频，没说跑在哪。

「发到微信群」「管理后台还在规划」不算。标题带小程序只是线索，正文全是 PC 截图就标 desktop。

只输出 JSON：{"items":[{"i":行号,"device":"phone|desktop|both|unknown","why":"12字以内"}]}
行号从 1 开始，必须和输入一一对应。"""


def parse_devices(
    items: list[Any],
    rows: list[tuple[int, str, str]],
) -> dict[int, tuple[str, str]]:
    out: dict[int, tuple[str, str]] = {}
    if not isinstance(items, list):
        return out
    for it in items:
        if not isinstance(it, dict):
            continue
        device = str(it.get("device") or "").strip().lower()
        if device not in DEVICES:
            continue
        try:
            lineno = int(it["i"])
        except (KeyError, TypeError, ValueError):
            continue
        if not 1 <= lineno <= len(rows):
            continue
        out[rows[lineno - 1][0]] = (device, str(it.get("why") or "")[:60])
    return out


def classify(rows: list[tuple[int, str, str]], model: str) -> dict[int, tuple[str, str]]:
    import httpx

    user_lines = [
        f"{n}. 标题：{title}\n正文：{clip_body(body, 2200)}"
        for n, (_tid, title, body) in enumerate(rows, 1)
    ]
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
    return parse_devices(payload.get("items") or [], rows)


def write_back(db: Store, model: str, graded: dict[int, tuple[str, str]]) -> int:
    if not graded:
        return 0
    rows, params = [], []
    for topic_id, (device, why) in graded.items():
        base = len(params)
        rows.append(f"(${base + 1}::int, ${base + 2}, ${base + 3})")
        params.extend([topic_id, device, why])
    params.append(model)
    landed = db.q(
        f"update forum_topic set fit_device = v.d, fit_device_why = v.r, "
        f"fit_device_model = ${len(params)}, fit_device_at = now() "
        f"from (values {', '.join(rows)}) as v(tid, d, r) "
        f"where forum_topic.topic_id = v.tid "
        f"returning forum_topic.topic_id",
        params,
    )
    return len(landed)


def report(db: Store) -> None:
    total = int(
        db.q(
            "select count(*)::int as n from forum_topic "
            "where fit_grade='A' and fit_body_grade='A'"
        )[0]["n"]
    )
    rows = db.q(
        "select coalesce(fit_device, '-') as g, count(*)::int as n "
        "from forum_topic where fit_grade='A' and fit_body_grade='A' "
        "group by 1 order by 1"
    )
    print(f"\n正文 A 共 {total} 条；主交付端：")
    for r in rows:
        g, n = r["g"], int(r["n"])
        label = "还没标" if g == "-" else LABELS.get(g, g)
        print(f"  {g:<8} {n:>3}  {n / max(total, 1) * 100:5.1f}%  {label}")


def list_bucket(db: Store, device: str) -> None:
    rows = db.q(
        "select title, views, fit_device_why from forum_topic "
        "where fit_grade='A' and fit_body_grade='A' and fit_device=$1 "
        "order by views desc nulls last",
        [device],
    )
    print(f"\n===== {device} {len(rows)} · {LABELS[device]} =====")
    for r in rows:
        print(f"  {(r['title'] or '')[:72]}")


def _opt(argv: list[str], name: str, default: int) -> int:
    return int(argv[argv.index(name) + 1]) if name in argv else default


def main() -> None:
    argv = sys.argv[1:]
    args = set(argv)
    db = Store()
    db.ensure_table()

    if "--report" in args:
        report(db)
        if "--list" in args:
            for d in DEVICES:
                list_bucket(db, d)
        return

    where = "where fit_grade='A' and fit_body_grade='A'"
    if "--all" not in args:
        where += " and fit_device is null"
    fetched = db.q(
        "select topic_id, title, left(coalesce(body_text,''), 2800) as body "
        f"from forum_topic {where} order by topic_id"
    )
    if not fetched:
        print("没有待标设备的正文 A（要重判加 --all）")
        report(db)
        return

    model = os.environ.get("LLM_MODEL") or ""
    if not model or not os.environ.get("LLM_API_KEY"):
        raise SystemExit("缺 LLM_MODEL / LLM_API_KEY")

    todo = [
        (int(r["topic_id"]), str(r["title"] or ""), str(r["body"] or ""))
        for r in fetched
    ]
    chunks = [todo[i : i + BATCH] for i in range(0, len(todo), BATCH)]
    workers = int(_opt(argv, "--workers", DEFAULT_WORKERS))
    print(f"待标 {len(todo)} 条，分 {len(chunks)} 批，并发 {workers}，模型 {model}")

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
                miss = len(chunk) - len(graded)
                extra = f"，{miss} 条模型没给" if miss else ""
                print(
                    f"  [{seen}/{len(chunks)}] 批 {n} 落地 {landed} 条 / "
                    f"{time.perf_counter() - t0:.0f}s{extra}",
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

    print(f"\n落地 {tally['done']} 条，用时 {time.monotonic() - started:.0f}s")
    if tally["failed"] or tally["lost"]:
        print(f"失败 {tally['failed']}，没落库 {tally['lost']}；重跑会补空")
    report(db)
    for d in DEVICES:
        list_bucket(db, d)


if __name__ == "__main__":
    main()
