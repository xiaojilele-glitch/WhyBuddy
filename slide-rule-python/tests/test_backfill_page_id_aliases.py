"""给存量产物反推页面 id 别名表（2026-08-28）。

## 为什么需要反推

别名表是 2026-08-28 才加的。此前生成的应用，交付 HTML 里的菜单孔烧的是草稿
id（p1..pN），页键早已被第 4.5 步改成语义 id，而那张映射当时没人记。宿主查
不到就静默回落——菜单点了没反应，且没有任何一处报错。

## ⚠ 本文件最要紧的一条：按名字锚，不按顺序

`page_id_freeze` 模块头写死了「顺序不当锚：顺序会变，名字不会」。2026-08-28
真机新跑一轮把这条坐实了——那一场（社区图书馆）的**真实**映射是

    p1→service_desk   p2→book_list   p3→borrow_center
    p4→overdue_penalty_ledger        p5→reader_archive

而 pages 字典第一个键是 `book_list`。按顺序反推会把 p1 判给 book_list，
**全盘错位**。下面 `test_顺序法会判错_不能拿来当锚` 用的就是这一场的
真实数据，且顺手断言"按顺序会错"——不然这条判据只是碰巧过。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.page_id_freeze import (  # noqa: E402
    dangling_nav_holes,
    infer_page_id_aliases,
    rewrite_html_page_ids,
)


def _nav(pid: str, label: str, current: bool = False) -> str:
    cur = ' aria-current="page"' if current else ""
    return f'<a data-page-id="{pid}"{cur}><span class="i">◆</span><span>{label}</span></a>'


def _page(holes) -> str:
    links = "\n".join(_nav(pid, label) for pid, label in holes)
    return f"<html><body><aside><nav>{links}</nav></aside><main>正文</main></body></html>"


#: 2026-08-28 真机（社区图书馆借还系统）那一场，一字不改。
REAL = [
    ("p1", "service_desk", "借还书服务台"),
    ("p2", "book_list", "馆藏图书列表"),
    ("p3", "borrow_center", "借阅记录与续借中心"),
    ("p4", "overdue_penalty_ledger", "逾期与赔偿结算台账"),
    ("p5", "reader_archive", "读者档案管理"),
]
#: pages 字典的真实顺序（**跟 p1..p5 的顺序不一样**，这正是不能按顺序的原因）
REAL_PAGE_ORDER = [
    "book_list",
    "service_desk",
    "borrow_center",
    "reader_archive",
    "overdue_penalty_ledger",
]


def _real_blob():
    holes = [(h, name) for h, _pid, name in REAL]
    pages = {pid: _page(holes) for pid in REAL_PAGE_ORDER}
    nav = [{"id": pid, "name": name} for _h, pid, name in REAL]
    return pages, nav


class Test按名字锚不按顺序:
    def test_真机那一场反推得一字不差(self):
        pages, nav = _real_blob()
        got = infer_page_id_aliases(pages, nav)
        assert got == {h: pid for h, pid, _n in REAL}

    def test_顺序法会判错_不能拿来当锚(self):
        """⚠ 反向判据：证明"按顺序"这条捷径确实是错的，不是我多虑。

        没有这一条，上面那条可能只是碰巧——万一 pages 的顺序恰好等于
        p1..pN，两种做法给出同一个答案，判据就咬不住任何东西。
        """
        pages, _nav = _real_blob()
        by_order = {
            f"p{i + 1}": pid for i, pid in enumerate(pages.keys())
        }
        truth = {h: pid for h, pid, _n in REAL}
        wrong = sorted(k for k in truth if by_order.get(k) != truth[k])
        # 这一场按顺序会判错 4/5：p3 恰好蒙对（第三项两边都是 borrow_center）。
        # ⚠ 写死这个集合而不是"至少错一条"：蒙对的那一条正说明**顺序法的对错
        #   是运气**，将来谁换夹具，这条会当场红，逼他重新确认新夹具还咬不咬得住。
        assert wrong == ["p1", "p2", "p4", "p5"], (
            f"按顺序反推的错法变了（{wrong}）——换夹具了？重新确认它还咬得住"
        )
        assert by_order != truth

    def test_标签带页字后缀也对得上(self):
        """真机 sr-20260827072032：HTML 里是「闭环验真报告」，navItems 里是
        「闭环验真报告页」——`build_nav_items` 写标签时剥掉了那个「页」。

        ⚠ 修法是复用**生产那一侧同一个函数**（page_shell.nav_tab_label），
          不在反推这边另写一套剥法（CLAUDE.md §4）。
        """
        pages = {"rpt": _page([("p1", "闭环验真报告")])}
        nav = [{"id": "rpt", "name": "闭环验真报告页"}]
        assert infer_page_id_aliases(pages, nav) == {"p1": "rpt"}


class Test对不上就不填:
    def test_标签重名整个作废(self):
        pages = {"a": _page([("p1", "工作台")]), "b": _page([("p2", "工作台")])}
        nav = [{"id": "a", "name": "工作台"}, {"id": "b", "name": "工作台"}]
        assert infer_page_id_aliases(pages, nav) == {}

    def test_同一个孔在不同页指向不同标签就作废(self):
        """产物本身不自洽时不猜——两页的侧栏对不上，说明壳统一出过问题。"""
        pages = {
            "a": _page([("p1", "甲页")]),
            "b": _page([("p1", "乙页")]),
        }
        nav = [{"id": "a", "name": "甲页"}, {"id": "b", "name": "乙页"}]
        assert infer_page_id_aliases(pages, nav) == {}

    def test_标签在导航里找不到就不填(self):
        pages = {"a": _page([("p9", "查无此页")])}
        nav = [{"id": "a", "name": "甲页"}]
        assert infer_page_id_aliases(pages, nav) == {}

    def test_已有别名赢过反推(self):
        """已有的是**改名当时记下来的**，是事实；反推是重建。冲突以事实为准。"""
        pages, nav = _real_blob()
        got = infer_page_id_aliases(pages, nav, {"p1": "borrow_center"})
        assert got["p1"] == "borrow_center"

    def test_孔本来就指得到页就不需要别名(self):
        pages = {"a": _page([("a", "甲页")])}
        nav = [{"id": "a", "name": "甲页"}]
        assert infer_page_id_aliases(pages, nav) == {}


class Test判定点不动的口径:
    def test_导航里有成品却缺的页_不算点不动(self):
        """⚠ 2026-08-28 写这条判定时第一版就错在这儿，把 13 个好会话报成坏的。

        全集不是 `pages` 的键，是**前端会渲染出来的那批页**：
        `specLivePageIds` 先放 navItems 的全部 id，再补 pages 里多出来的键。
        所以「导航里有、成品却缺」的那一页仍在清单里，只是 html 换成了
        missingPageHtml 的骨架——点进去看到「这一页没有成品界面」，那是
        **如实降级，不是点了没反应**（2026-08-20 Foclip 那次专门修的）。
        """
        pages = {"a": _page([("a", "甲页"), ("b", "乙页")])}
        nav = [{"id": "a", "name": "甲页"}, {"id": "b", "name": "乙页"}]
        assert dangling_nav_holes(pages, None, nav) == []
        # 不给 navItems 就只能按 pages 的键判——会把 b 误报成坏的
        assert dangling_nav_holes(pages, None) == ["b"]

    def test_真机坏掉的那一场_补之前坏补之后好(self):
        pages, nav = _real_blob()
        assert dangling_nav_holes(pages, None, nav) == ["p1", "p2", "p3", "p4", "p5"]
        got = infer_page_id_aliases(pages, nav)
        assert dangling_nav_holes(pages, got, nav) == []

    def test_链式别名也跟得到底(self):
        pages = {"final": _page([("p1", "甲页")])}
        nav = [{"id": "final", "name": "甲页"}]
        assert dangling_nav_holes(pages, {"p1": "mid", "mid": "final"}, nav) == []

    def test_别名成环不死循环(self):
        pages = {"a": _page([("x", "甲页")])}
        nav = [{"id": "a", "name": "甲页"}]
        assert dangling_nav_holes(pages, {"x": "y", "y": "x"}, nav) == ["x"]


class Test改键同时改HTML孔:
    def test_孔跟着映射走_点得动(self):
        """真机形态：页键已经是语义 id，孔还是 p1。改完孔必须对得上键。"""
        mapping = {h: pid for h, pid, _n in REAL}
        pages, nav = _real_blob()
        assert dangling_nav_holes(pages, None, nav) == ["p1", "p2", "p3", "p4", "p5"]
        rewritten = rewrite_html_page_ids(pages, mapping)
        assert dangling_nav_holes(rewritten, None, nav) == []
        html = rewritten["book_list"]
        assert 'data-page-id="p1"' not in html
        assert 'data-page-id="book_list"' in html
        assert 'data-page-id="service_desk"' in html

    def test_p1_不许误伤_p10(self):
        html = '<a data-page-id="p1">甲</a><a data-page-id="p10">乙</a>'
        got = rewrite_html_page_ids({"p10": html}, {"p1": "alpha"})
        assert 'data-page-id="alpha"' in got["p10"]
        assert 'data-page-id="p10"' in got["p10"]

    def test_空映射不动(self):
        pages = {"p1": '<a data-page-id="p1">甲</a>'}
        assert rewrite_html_page_ids(pages, {}) is pages
