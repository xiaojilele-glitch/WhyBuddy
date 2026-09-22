"""给 forum_topic 的话题打「SlideRule 能不能推演它」的分档，并写回库。

    cd slide-rule-python
    .venv/bin/python scripts/forum_fit_grade.py                    # 只判还没判过的
    .venv/bin/python scripts/forum_fit_grade.py --workers 6        # 并发（默认 6）
    .venv/bin/python scripts/forum_fit_grade.py --all      # 全部重判（换了标准时）
    .venv/bin/python scripts/forum_fit_grade.py --report   # 不调模型，只看现状

## 这个分档要回答什么

SlideRule 产出的是**企业应用数字孪生**——五系统模型（数据实体 / 角色权限 /
工作流 / 页面 / AI 能力）。它能推演的是「有实体、有角色、有流转」的业务系统。
一个 3D 竞速游戏、一个 ESP32 桌宠、一个音频插件都不是这个形状。

所以「这批话题对项目有没有用」不是感觉问题，是覆盖率问题：多少条落在能力
圈内。落在圈内的才是可用的意图语料（域识别回归集、示例库候选、相关性校验
的标定集）；圈外的只能当竞品情报。

## 三条实现纪律

**① 分批不逐条。** 逐条 299 次调用，每次还要驮网关注入的几千 token 系统
提示词。25 条一批共 12 次，对这种粗分类精度完全够。

**② 每批立刻写库。** 第一版写在 scratchpad 里的脚本是跑完才落盘，中途
ReadTimeout 一次就得从头再来（真发生过，批 7 超时重试）。现在每批一落，
挂了重跑接着上次走。

**③ 判不出来的标 U，不猜。** 模型漏判某个序号时补一个 C 是最省事的做法，
也是最坏的：它会悄悄把一条本该入选的语料踢掉，而且看不出来。
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from forum_neon import FIT_GRADES, Store

BATCH = 25
RETRIES = 3
#: 并发批数。模型侧是别人的网关，别开太猛；实测 6 路已经把 2000 条压进十分钟内。
DEFAULT_WORKERS = 6


def _opt(argv: list[str], name: str, default: int) -> int:
    """从命令行取 `--name 值`，没给就用默认。"""
    return int(argv[argv.index(name) + 1]) if name in argv else default

RUBRIC = """你在给一批参赛作品做能力圈归类。

判定基准产品叫 SlideRule：输入一句业务意图，输出一套「企业应用数字孪生」——
它生成的是五个系统的模型：数据实体表、角色权限、审批/流转工作流、页面布局、
AI 能力位。也就是说它只擅长**表单 + 台账 + 角色 + 流转**这一类业务系统。

给每个作品打一个档：
A = 正中靶心：本质就是一套业务系统（有明确的数据实体、有不同角色、有申请/
    审批/派单/流转/台账）。哪怕包装成小程序也算。
B = 半个：有结构化数据和管理界面，但没有多角色流转，主要价值在算法/内容/
    推荐/分析上。SlideRule 能推演出个骨架，但抓不住它真正的价值。
C = 圈外：游戏、3D、硬件固件、音视频处理、图像生成、纯创作工具、模拟器。
    没有"业务实体+角色"这个结构，SlideRule 推演不了。

只输出 JSON：{"items":[{"i":行号,"grade":"A|B|C","why":"12字以内"}]}
行号就是每行开头那个数字，从 1 开始，必须和输入一一对应，一条都不能少。"""


def classify(titles: list[tuple[int, str]], model: str) -> dict[int, tuple[str, str]]:
    """返回 {topic_id: (档位, 理由)}。

    ## 给模型看的是 1..N 的行号，不是 topic_id

    2026-08-05 真机代价：第一版把 topic_id 直接当行号发给模型，让它原样抄
    回来。实测同一批输入跑三次，**有一次它把序号重新编成了 1、2、3…**——
    那批 25 个 key 全都对不上真实 id，update 一行都匹配不到，还不报错。
    一轮下来静默丢了 374 条。

    模型"顺手把序号规整一下"是很自然的行为，提示词里那个"序号"更是在邀请
    它这么做。所以别让它碰 id：发 1..N（它编号也只能编成 1..N，编对编错
    都一样），本地再映射回 topic_id。这条通道就没有出错的余地了。
    """
    import httpx

    resp = httpx.post(
        f'{os.environ["LLM_BASE_URL"].rstrip("/")}/chat/completions',
        headers={"Authorization": f'Bearer {os.environ["LLM_API_KEY"]}'},
        json={
            "model": model, "stream": False,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": RUBRIC},
                {"role": "user", "content": "\n".join(
                    f"{lineno}. {title}"
                    for lineno, (_tid, title) in enumerate(titles, 1)
                )},
            ],
        },
        timeout=300,
    )
    resp.raise_for_status()
    items = json.loads(resp.json()["choices"][0]["message"]["content"])["items"]
    out: dict[int, tuple[str, str]] = {}
    for it in items:
        grade = str(it.get("grade") or "").strip().upper()[:1]
        if grade not in FIT_GRADES or grade == "U":
            continue
        try:
            lineno = int(it["i"])
        except (KeyError, TypeError, ValueError):
            continue
        # 越界的行号直接丢——宁可这条留空下次重判，也不能张冠李戴把
        # A 档的理由挂到别人身上
        if not 1 <= lineno <= len(titles):
            continue
        out[titles[lineno - 1][0]] = (grade, str(it.get("why") or "")[:60])
    return out


def write_back(db: Store, model: str, graded: dict[int, tuple[str, str]]) -> int:
    """一条语句更新整批，返回**真正落地的行数**。

    逐条 update 的话，2000 条就是 2000 次 HTTPS 往返。用 `from (values ...)`
    连接一次更新完——分档结果都是短字符串，一批 25 条离网关 1MB 的体积上限
    差着好几个量级，不需要像话题正文那样按字节切批。

    ## 为什么必须 `returning` 数一遍

    2026-08-05 真机代价：一轮 1693 条报告"写回 1686 条"，库里实际只多了
    1312 条——**374 条静默丢失**。update 的 where join 匹配不到行时不报错，
    只是什么都不做，于是脚本理直气壮地报了个假的成功数。

    这正是本项目反复栽的那一类：少几行不报错，比直接崩掉难查得多。所以这里
    不信"我发了多少"，只信"库里回了多少"，对不上就让调用方喊出来。
    """
    if not graded:
        return 0
    rows, params = [], []
    for topic_id, (grade, why) in graded.items():
        base = len(params)
        rows.append(f"(${base + 1}::int, ${base + 2}, ${base + 3})")
        params.extend([topic_id, grade, why])
    params.append(model)
    landed = db.q(
        f"update forum_topic set fit_grade = v.g, fit_reason = v.r, "
        f"fit_model = ${len(params)}, fit_at = now() "
        f"from (values {', '.join(rows)}) as v(tid, g, r) "
        f"where forum_topic.topic_id = v.tid "
        f"returning forum_topic.topic_id",
        params,
    )
    return len(landed)


def report(db: Store) -> None:
    rows = db.q(
        "select coalesce(fit_grade, 'U') as g, count(*)::int as n "
        "from forum_topic group by 1 order by 1"
    )
    total = sum(int(r["n"]) for r in rows) or 1
    print(f"\n共 {total} 条")
    for r in rows:
        g, n = r["g"], int(r["n"])
        bar = "█" * round(n / total * 36)
        print(f"  {g}  {n:>3} 帖  {bar:<36} {n / total * 100:5.1f}%  {FIT_GRADES.get(g, '')}")


def main() -> None:
    argv = sys.argv[1:]
    args = set(argv)
    db = Store()
    db.ensure_table()

    if "--report" in args:
        report(db)
        return

    where = "" if "--all" in args else "where fit_grade is null"
    rows: list[dict[str, Any]] = db.q(
        f"select topic_id, title from forum_topic {where} order by topic_id"
    )
    if not rows:
        print("没有待判定的话题（要重判全部加 --all）")
        report(db)
        return

    model = os.environ.get("LLM_MODEL") or ""
    if not model or not os.environ.get("LLM_API_KEY"):
        raise SystemExit("缺 LLM_MODEL / LLM_API_KEY")

    todo = [(int(r["topic_id"]), str(r["title"])) for r in rows]
    chunks = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
    workers = int(_opt(argv, "--workers", DEFAULT_WORKERS))
    print(f"待判 {len(todo)} 条，分 {len(chunks)} 批，并发 {workers}，模型 {model}")

    tally = {"done": 0, "failed": 0, "lost": 0, "n": 0}
    lock = threading.Lock()
    started = time.monotonic()

    def one(indexed: tuple[int, list[tuple[int, str]]]) -> None:
        n, chunk = indexed
        for attempt in range(RETRIES):
            try:
                t0 = time.perf_counter()
                graded = classify(chunk, model)
                # 每批立刻落库：中途挂掉重跑能接着上次走，不用从头再来。
                # Store 内部是一个 httpx.Client，多线程共用是安全的。
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
                    # 判出来了却没落进库——多半是模型把 topic_id 抄错了，
                    # 那个 id 在表里不存在，update 就静默匹配不到任何行
                    notes.append(f"⚠️ {len(graded) - landed} 条没落库")
                tail = ("，" + "，".join(notes) + "（留空，下次重跑会再判）") if notes else ""
                print(f"  [{seen}/{len(chunks)}] 批 {n} 落地 {landed} 条 / "
                      f"{time.perf_counter() - t0:.0f}s{tail}", flush=True)
                return
            except Exception as exc:  # noqa: BLE001 — 单批失败不拖垮整轮
                print(f"  批 {n} 第 {attempt + 1} 次失败："
                      f"{type(exc).__name__} {str(exc)[:100]}", flush=True)
                time.sleep(3 * (attempt + 1))
        with lock:
            tally["failed"] += len(chunk)
            tally["n"] += 1

    indexed = list(enumerate(chunks, 1))
    if workers <= 1:
        for item in indexed:
            one(item)
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(one, indexed))

    dur = time.monotonic() - started
    parts = [f"落地 {tally['done']} 条", f"用时 {dur:.0f}s"]
    if tally["lost"]:
        parts.append(f"⚠️ {tally['lost']} 条判出来了但没落库")
    if tally["failed"]:
        parts.append(f"{tally['failed']} 条整批失败")
    if tally["lost"] or tally["failed"]:
        parts.append("重跑本命令会自动补上（只挑 fit_grade 为空的）")
    print("\n" + "，".join(parts))
    report(db)


if __name__ == "__main__":
    main()
