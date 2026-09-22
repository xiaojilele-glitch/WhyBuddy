"""给存量应用补页面 id 别名表 —— 默认 dry-run，看清楚了再 --apply。

## 为什么需要它

别名表是 2026-08-28 才加的（提交 9357eea）。此前生成的应用，交付 HTML 里的
菜单孔烧的是**草稿 id**（p1..pN），而页键早已被流水线第 4.5 步改成语义 id，
那张映射当时没人记。宿主 `resolveActivePageId` 查不到就静默回落当前页——
表现是**菜单点了没反应，且没有任何一处报错**。

真机：sr-20260827191954（药房，4 个孔全废）、sr-20260827201847（巡检，5 个
全废）。修复之后新生成的自动带表；存量这批只能反推补上。

## ⚠ 按名字锚，不按顺序

`page_id_freeze` 模块头写死了「顺序不当锚：顺序会变，名字不会」。
2026-08-28 新跑的一轮把这条坐实了——那一场的真实映射是

    p1→service_desk   p2→book_list   p3→borrow_center
    p4→overdue_penalty_ledger        p5→reader_archive

而 pages 字典第一个键是 `book_list`。**按顺序反推会把 p1 判给 book_list，
全盘错位。** 锚点是每个孔同一个 `<a>` 里的标签文字：`build_nav_items` 写
标签和 data-page-id 是同一次动作，天然同源。

推不出来的**不动**（标签对不上、标签重名、同一个孔在不同页指向不同标签）。
留一个点不动的菜单项，好过把用户送到错的那一页——跟 backfill_session_owner
那条"宁可留着无主也不猜主人"同一个取舍。

## 为什么直接写库，不走 save_session

持久层有单调守卫（persistence.py 的 `_monotonic_key`）：同一个 lastTurnId
且核心集合没有增长的写，会被**退回旧值**，而 `specFirstPages` 不在
publishClosure / modelVersions 那几个豁免键里。也就是说走 save_session 的
回填会**静默失效**——落库返回成功，库里一个字没变。

所以照 backfill_session_owner 的做法：在网关上 jsonb_set 精确写那一个键。
只加 `specFirstPages.pageIdAliases`，不碰 payload 的任何其它部分。

## 用法

    cd slide-rule-python
    .venv/bin/python scripts/backfill_page_id_aliases.py            # 看要改什么
    .venv/bin/python scripts/backfill_page_id_aliases.py --apply    # 真写
    .venv/bin/python scripts/backfill_page_id_aliases.py --limit 5  # 只看前几条
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app  # noqa: F401,E402  —— 触发 .env 加载
from services.app_store import HttpSqlGateway, http_api_credentials  # noqa: E402
from services.page_id_freeze import (  # noqa: E402
    dangling_nav_holes,
    infer_page_id_aliases,
)

APPLY = "--apply" in sys.argv


def _limit() -> int:
    if "--limit" in sys.argv:
        i = sys.argv.index("--limit")
        if i + 1 < len(sys.argv):
            try:
                return int(sys.argv[i + 1])
            except ValueError:
                pass
    return 0


def _payload(row: dict) -> dict:
    p = row.get("payload")
    if isinstance(p, str):
        try:
            p = json.loads(p)
        except ValueError:
            p = {}
    return p if isinstance(p, dict) else {}


def main() -> int:
    url, key = http_api_credentials()
    if not (url and key):
        print("没配 APP_STORE_HTTP_API_URL / _KEY，这个脚本只处理库后端。")
        return 1
    g = HttpSqlGateway(url, key)

    rows = g.query("select session_id, payload from sliderule_session", [])

    total = len(rows)
    no_pages = 0
    healthy = 0
    todo: list[tuple[str, dict, list[str], list[str]]] = []
    partial: list[tuple[str, list[str]]] = []

    for r in rows:
        sid = r["session_id"]
        sf = _payload(r).get("specFirstPages")
        if not isinstance(sf, dict) or not isinstance(sf.get("pages"), dict) or not sf["pages"]:
            no_pages += 1
            continue
        existing = sf.get("pageIdAliases")
        nav = sf.get("navItems")
        bad_before = dangling_nav_holes(sf["pages"], existing, nav)
        if not bad_before:
            healthy += 1
            continue
        inferred = infer_page_id_aliases(sf["pages"], nav, existing)
        bad_after = dangling_nav_holes(sf["pages"], inferred, nav)
        if inferred and len(bad_after) < len(bad_before):
            todo.append((sid, inferred, bad_before, bad_after))
            if bad_after:
                partial.append((sid, bad_after))
        else:
            partial.append((sid, bad_before))

    print(f"会话总数              {total}")
    print(f"  没有交付页          {no_pages}")
    print(f"  菜单本来就是好的    {healthy}")
    print(f"  能补上              {len(todo)}")
    print(f"  补不动 / 补不全     {len(partial)}   ← 对不上就不填，不猜")
    print()

    if not todo:
        print("没有可补的。")
        return 0

    shown = _limit() or len(todo)
    for sid, aliases, before, after in todo[:shown]:
        fixed = len(before) - len(after)
        tail = f"（仍有 {after} 补不动）" if after else ""
        print(f"  {sid}  修好 {fixed}/{len(before)} 个孔 {tail}")
        for old, new in sorted(aliases.items()):
            print(f"      {old:6s} → {new}")
    if shown < len(todo):
        print(f"  …… 还有 {len(todo) - shown} 条（去掉 --limit 看全部）")
    print()

    if partial:
        print("补不动的（保持现状，那几个菜单项仍然点不动）：")
        for sid, holes in partial[:10]:
            print(f"  {sid}  {holes}")
        if len(partial) > 10:
            print(f"  …… 还有 {len(partial) - 10} 条")
        print()

    if not APPLY:
        print("这是 dry-run。确认无误后加 --apply 真写。")
        return 0

    ok = 0
    for sid, aliases, _b, _a in todo:
        # payload 是唯一真相。只 set 这一个键，不碰别的——走 save_session 会被
        # 单调守卫退回（见模块头）。
        g.query(
            "update sliderule_session"
            " set payload = jsonb_set(payload, '{specFirstPages,pageIdAliases}',"
            "                          $2::jsonb, true)"
            " where session_id = $1",
            [sid, json.dumps(aliases, ensure_ascii=False)],
        )
        ok += 1
    print(f"写完 {ok} 条。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
