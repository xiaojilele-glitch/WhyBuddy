"""给体验区块标「通用主力 / 特定场景件」，写回 experience_block_catalog.json。

    cd slide-rule-python
    .venv/bin/python scripts/label_block_generality.py --dry-run   # 只看结果不落盘
    .venv/bin/python scripts/label_block_generality.py             # 只标还没标的
    .venv/bin/python scripts/label_block_generality.py --all       # 全部重标

## 这个字段是干什么的

组件库搜索排序里的**业务优先级**那一维（client/src/pages/sliderule/
component-search.ts 的 GENERALITY_BOOST）。

2026-08-09 区块从 26 涨到 111 之后，搜「做一个订单筛选」头四名是
BookingDirectoryFilter / IssueEventFilter / FacetedFilterPanel /
TimelineFilterBar，通用的 FilterBar 掉到第 14。

**这不是排序参数没调好。** 那几个在文本上完全等价：family 都是 `filter`、
能力标签都是同一串「筛选 过滤 查询 条件」、说明里也都在讲筛选。BM25 只能
看词，看不出「大部分应用要的是 FilterBar，只有做预订系统才要
BookingDirectoryFilter」——那是产品判断，语料里根本没有这个信息。

Algolia 的 customRanking 文档把这条讲得最直白：textual relevance 不包含
business relevance，后者必须**单独声明**，当同样相关时的分先后依据。
所以这里补的是数据，不是算法。

## 为什么让模型标而不是手写

111 条，手写要一下午，而且判据会随着人的疲劳漂移。模型对「这个区块名字和
说明像不像某个具体产品的专属件」判得相当稳——它见过 cal.com、sentry、
superset 这些产品。**但它只出初稿**：`--dry-run` 打全表给人过一遍，
改完再落盘。产品优先级最终得由人拍板。

## 两条纪律（都是踩过的）

**① 发 1..N 的行号，不发区块名。** 让模型原样抄回一串标识符，它有相当概率
"顺手规整一下"——scripts/forum_fit_grade.py 那次实测三分之一的批次会把
id 重编成 1,2,3…，静默丢了 374 条。发行号，本地映射回去，这条路就没有
出错余地。

**② 落盘只改 `generality` 一个键。** 目录是 Python 侧拼提示词白名单、TS 侧
做渲染器注册表的**同一份真相源**，整文件重排会让 diff 没法看，也容易把别的
字段写坏。这里逐块 setdefault，键序不动。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "services" / "data" / "experience_block_catalog.json"
BATCH = 25

RUBRIC = """你在给一个企业应用「体验区块库」挑**每一类能力里的默认首选**，用于搜索排序。

输入是同一个能力面下的所有区块（比如全都是"筛选"类）。它们在文字上高度相似，
你要回答的不是"哪个是筛选"，而是：

    一个普通企业应用（订单/工单/审批/库存/客户管理…）要做这件事，
    **默认应该先拿哪一个**？

首选的判据：
  · 换任何行业都成立，不预设业务对象；
  · 是这类能力最基本、最常见的那个形态，不是它的高级变体或特化版；
  · 名字里不带具体业务名词（预订、缺陷、告警、日程…）。

不是首选的：某个具体产品搬来的专属形态、高级/复杂变体、只在特定行业成立的。

**最多挑 {cap} 个**，宁少勿多——挑出来的会被加权排到所有人前面，
多挑一个就意味着把一个特化件推给了不需要它的人。其余一律 specific。

输出 JSON：{{"items":[{{"i":行号,"g":"generic"或"specific","why":"不超过20字"}}]}}
每一行都要有，行号原样用输入给的那个数字。"""


def load_catalog() -> dict[str, Any]:
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def label(rows: list[tuple[str, str]], model: str, cap: int) -> dict[str, tuple[str, str]]:
    """rows = [(type, 描述行)]，返回 {type: (generality, why)}。

    **一次只送同一个能力面**（见 main 的分组）。混着送的话模型答的是
    "这是不是通用组件"，几乎全都答 yes——实测 111 条混送标出 71 个 generic，
    连 TimelineFilterBar / FacetedFilterPanel 这种明显的特化件都进去了，
    等于没标。按能力面分组之后问题才变得可判：**这一组里默认拿哪个**。
    """
    import httpx

    # 网关 502 是常态（实测这一轮 14 次调用里撞上一次）。整轮跑完才落盘，
    # 中间挂一次就得全部重来——退避重试三次比"每批落盘"轻，14 次小调用够用。
    for attempt in range(3):
        try:
            return _label_once(rows, model, cap)
        except httpx.HTTPError as exc:
            if attempt == 2:
                raise
            print(f"    重试 {attempt + 1}/2：{str(exc)[:80]}")
            time.sleep(2 ** attempt)
    return {}


def _label_once(rows: list[tuple[str, str]], model: str, cap: int) -> dict[str, tuple[str, str]]:
    import httpx

    resp = httpx.post(
        f'{os.environ["LLM_BASE_URL"].rstrip("/")}/chat/completions',
        headers={"Authorization": f'Bearer {os.environ["LLM_API_KEY"]}'},
        json={
            "model": model,
            "stream": False,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": RUBRIC.format(cap=cap)},
                {
                    "role": "user",
                    "content": "\n".join(
                        f"{i}. {line}" for i, (_t, line) in enumerate(rows, 1)
                    ),
                },
            ],
        },
        timeout=300,
    )
    resp.raise_for_status()
    items = json.loads(resp.json()["choices"][0]["message"]["content"])["items"]
    out: dict[str, tuple[str, str]] = {}
    for it in items:
        g = str(it.get("g") or "").strip().lower()
        if g not in ("generic", "specific"):
            continue
        try:
            lineno = int(it["i"])
        except (KeyError, TypeError, ValueError):
            continue
        # 越界行号直接丢：宁可这条留空下次重标，也不能张冠李戴
        if not 1 <= lineno <= len(rows):
            continue
        out[rows[lineno - 1][0]] = (g, str(it.get("why") or "")[:40])
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="全部重标（默认只标还没标的）")
    ap.add_argument("--dry-run", action="store_true", help="只打表，不写文件")
    args = ap.parse_args()

    if not os.getenv("LLM_API_KEY") or not os.getenv("LLM_BASE_URL"):
        print("缺 LLM_API_KEY / LLM_BASE_URL", file=sys.stderr)
        return 2
    model = os.getenv("LLM_MODEL") or "gpt-5.5"

    catalog = load_catalog()
    blocks: list[dict[str, Any]] = catalog["blocks"]
    todo = [b for b in blocks if args.all or not b.get("generality")]
    print(f"目录 {len(blocks)} 个区块，待标 {len(todo)} 个，模型 {model}")
    if not todo:
        return 0

    # 按能力面分组：混着问模型只会全答 "通用"（见 label 的说明）
    groups: dict[str, list[dict[str, Any]]] = {}
    for b in todo:
        groups.setdefault(str(b.get("capability") or b.get("family") or "?"), []).append(b)

    def row_of(b: dict[str, Any]) -> tuple[str, str]:
        src = b.get("source")
        repo = src.get("repo", "-") if isinstance(src, dict) else "-"
        return (
            b["type"],
            f'{b["type"]}｜{b.get("description", "")[:90]}｜来源={repo}',
        )

    picked: dict[str, tuple[str, str]] = {}
    all_rows: list[tuple[str, str]] = []
    for cap_name, members in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        rows = [row_of(b) for b in members]
        all_rows.extend(rows)
        # 首选名额按组大小给，上限 4：一个能力面再大，默认选择也不该有五个
        quota = max(1, min(4, round(len(rows) / 4)))
        for start in range(0, len(rows), BATCH):
            batch = rows[start : start + BATCH]
            got = label(batch, model, quota)
            picked.update(got)
        n_generic = sum(1 for t, _ in rows if picked.get(t, ("", ""))[0] == "generic")
        print(f"  {cap_name:<14} {len(rows):>3} 个，名额 {quota}，挑中 {n_generic}")

    generic = sorted(t for t, (g, _) in picked.items() if g == "generic")
    print(f"\n首选 {len(generic)} / {len(all_rows)}：")
    for t in generic:
        print(f"   {t:<28} {picked[t][1]}")
    missing = [t for t, _ in all_rows if t not in picked]
    if missing:
        print(f"\n没标上的 {len(missing)} 个（留空，下次重跑）：{', '.join(missing)}")

    if args.dry_run:
        print("\n--dry-run：没有写文件")
        return 0

    # 送进去问过的，没被挑中就明确写 specific。
    #
    # 留空也能跑（搜索侧缺省按 1 算，与 specific 等价），但那样分不出
    # "问过、判为特化" 和 "还没问过"——下次跑又会把它们全再问一遍，
    # 而且人来审这张表时看不出哪些是模型真的看过的。
    asked = {t for t, _ in all_rows}
    labels = {
        b["type"]: (picked.get(b["type"], ("specific", ""))[0])
        for b in blocks
        if b["type"] in asked
    }
    written = insert_generality(labels)
    print(f"\n已写回 {CATALOG.relative_to(ROOT.parent)}（{written} 个区块）")
    return 0


#: 块级键的缩进。目录里 propsSchema 内部也有 "type"，靠缩进区分。
_BLOCK_TYPE_LINE = '      "type": "'


def insert_generality(labels: dict[str, str]) -> int:
    """按**行**插入 `generality`，不重新序列化整份 JSON。

    第一版是 `json.dumps(catalog, indent=2)` 整文件回写，结果 diff 是
    **5013 增 / 560 删**——因为原文件把短的嵌套对象压在一行
    （`"title": { "type": "string" }`），而 indent=2 会把它们全展开。
    111 个字段的改动淹在五千行重排里，没人审得动，也看不出有没有写坏别的。

    所以这里只做一件事：找到块级的 `"type": "X",` 那一行，紧跟着插一行。
    改动量 = 区块数，diff 一眼能过。缩进是判据——propsSchema 里也有 `type`，
    但它们缩进更深。
    """
    lines = CATALOG.read_text(encoding="utf-8").split("\n")
    out: list[str] = []
    hit = 0
    for line in lines:
        out.append(line)
        if not line.startswith(_BLOCK_TYPE_LINE):
            continue
        block_type = line[len(_BLOCK_TYPE_LINE) :].split('"', 1)[0]
        want = labels.get(block_type)
        if want is None:
            continue
        out.append(f'      "generality": "{want}",')
        hit += 1
    CATALOG.write_text("\n".join(out), encoding="utf-8")
    return hit


if __name__ == "__main__":
    raise SystemExit(main())
