"""画布手动换图：查询阶梯 + 只回白名单图床。

⚠ 这条链路跟自动画页的 fill_stock_placeholders **取舍相反**：
  自动那条 fail-open（搜不到留占位图，不能拖垮推演），
  这条是用户点了按钮在等，搜不到必须如实回空，不许伪造绿灯。

正向：整句搜不到时会逐级退让到搜得到的短词。
反向：退让不许无限放宽（说明性尾词不单独成词）；候选不许出白名单。
"""

import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.spec_page_html import _ALLOWED_HOSTS  # noqa: E402
from services.stock_images import (  # noqa: E402
    STOCK_IMAGE_HOSTS,
    fill_stock_placeholders,
    build_query_ladder,
    search_replacement_images,
)


def _fetch(rows):
    """假 Openverse。返回一个 fetch_fn，记录被搜过的词。"""
    seen = []

    def fetch(query):
        seen.append(query)
        return {"results": rows.get(query, [])}

    fetch.seen = seen  # type: ignore[attr-defined]
    return fetch


def _row(url, license_="cc0", title="t"):
    return {"url": url, "license": license_, "title": title, "tags": []}


class Test查询阶梯:
    def test_整句在最前_先尽量保住原意(self):
        ladder = build_query_ladder("ancient book page manuscript", "tall")
        assert ladder[0] == ("ancient book page manuscript", "tall")
        # ⚠ aspect 不能一路带到底：真机实测 aspect=square 会把 4 条结果砍成 0。
        assert ladder[1] == ("ancient book page manuscript", None)

    def test_逐级变短_而且截的是尾巴不是开头(self):
        """⚠ 2026-08-25 A/B 改的方向：**英语名词短语的主体在最后**。

        第一版截前缀，真机上把主体整个扔掉：
            fresh organic red apples basket          -> fresh organic red
            customer picking up groceries order ...  -> customer picking up
        搜回来的图跟画面无关，正是模块头那条"错图比没图更糟"要挡的。
        """
        ladder = build_query_ladder("fresh organic red apples basket", None)
        queries = [q for q, _ in ladder]
        assert queries[0] == "fresh organic red apples basket"
        # 单调不变长
        assert all(
            len(queries[i + 1]) <= len(queries[i]) for i in range(len(queries) - 1)
        )
        # 主体（apples / basket）在最短那一级仍然在
        shortest = queries[-1].lower()
        assert "apples" in shortest or "basket" in shortest
        # 反向：不许退成一串只有修饰词的碎片
        assert shortest != "fresh organic red"
        assert not shortest.startswith("fresh organic")

    def test_并列处切断_只取第一个短语(self):
        """⚠ and/or 是短语分界，不是虚词。第一版把 and 当虚词删掉，
        'advanced mathematics textbook and pet book' 会粘成一句，
        截尾巴截出 'textbook pet book' 这种跨短语的碎片。"""
        ladder = build_query_ladder(
            "advanced mathematics textbook and pet book", None
        )
        for q, _ in ladder:
            low = q.lower()
            # 第二个短语的词一个都不许混进来
            assert "pet" not in low.split()
            assert "book" not in low.split() or "textbook" in low
        assert ladder[0][0] == "advanced mathematics textbook"

    def test_尾词删到只剩一个词就退回_不许把主体删没(self):
        """⚠ 'Admin avatar portrait' 三个词全是说明性尾词，全删只剩 'Admin'——
        搜出来是管理面板截图、admin 标志，什么都可能。宁可保留说明词。"""
        queries = [q for q, _ in build_query_ladder("Admin avatar portrait", None)]
        assert "Admin" not in queries
        assert all(len(q.split()) >= 2 for q in queries)

    def test_退到最短时仍然带着主体词_而不是退成一堆说明词(self):
        """⚠ 这条第一版写成「ladder 里不许出现 'badge' 这个词」——**变异咬不住**：
        把去尾词那步删掉，最短一级恰好还是同样的两个词，判据照样绿。
        真正要钉的语义是"退让不许把主体退没了"，所以取真机那条说明词在**前面**
        的 alt（1674f484 / 810f460c 都是这个形状：portrait of Zhang ...）——
        不去尾词的话最短一级会退成 "portrait Zhang"，搜出来是肖像画不是园艺师。
        """
        ladder = build_query_ladder("portrait of Zhang master landscaper", None)
        shortest = ladder[-1][0].lower().split()
        # 主体词还在
        assert "zhang" in shortest or "landscaper" in shortest
        # 说明词没有反客为主
        assert "portrait" not in shortest

    def test_虚词不进检索词(self):
        ladder = build_query_ladder("Cat climbing frame and rest zone", None)
        assert all(" and " not in q for q, _ in ladder)

    def test_全是标点或中文时回空_调用方据此提示粘地址(self):
        assert build_query_ladder("——", None) == []
        assert build_query_ladder("", None) == []

    def test_不去重会重复请求_同一对只出现一次(self):
        ladder = build_query_ladder("Business license", None)
        assert len(ladder) == len(set(ladder))


class Test搜替换图:
    def test_整句落空就退到短词(self):
        fetch = _fetch(
            {
                "ancient book page manuscript": [],
                "book page manuscript": [],
                "page manuscript": [_row("https://images.unsplash.com/photo-ok")],
            }
        )
        out = search_replacement_images(
            "ancient book page manuscript", "https://placehold.co/80x100", fetch_fn=fetch
        )
        assert out["query"] == "page manuscript"
        assert out["candidates"]
        # 反向：确实**逐级**试过，不是一上来就搜短词
        assert "ancient book page manuscript" in fetch.seen[0]

    def test_搜不到如实回空_不回落占位图(self):
        out = search_replacement_images(
            "zzz", "https://placehold.co/40x40", fetch_fn=_fetch({})
        )
        assert out["candidates"] == []
        assert out["query"] == ""
        # ⚠ 反向：绝不许拿 placehold.co 冒充"换成功了"
        assert not any(
            "placehold" in str(c.get("url", "")) for c in out["candidates"]
        )
        # 试过的词要带回去，前端才能说清"搜了这些都没有"
        assert out["tried"]

    def test_候选只出unsplash(self):
        fetch = _fetch(
            {
                "cat": [
                    _row("https://evil.example.com/a.jpg"),
                    _row("https://live.staticflickr.com/1/ok.jpg"),
                    _row("https://images.unsplash.com/photo-ok"),
                ]
            }
        )
        out = search_replacement_images("cat", "", fetch_fn=fetch)
        urls = [c["url"] for c in out["candidates"]]
        assert urls == ["https://images.unsplash.com/photo-ok"]
        assert not any("flickr" in u for u in urls)
        assert not any("evil" in u for u in urls)

    def test_只有flickr就回空_不把别的图床冒充成功(self):
        fetch = _fetch(
            {"cat": [_row("https://live.staticflickr.com/1/ok.jpg")]}
        )
        out = search_replacement_images("cat", "", fetch_fn=fetch)
        assert out["candidates"] == []

    def test_白名单已在画页闸里_换完再精修不会被判未授权外链(self):
        # ⚠ 这条不是风格问题：真机踩过 Unsplash 写进 HTML 整页校验失败。
        #    换进去的图如果不在 _ALLOWED_HOSTS 里，下一轮精修会整页红。
        for host in STOCK_IMAGE_HOSTS:
            assert host in _ALLOWED_HOSTS

    def test_某一级挂了继续退下一级_不整个失败(self):
        def fetch(query):
            if query == "orange tabby rescue cat":
                raise TimeoutError("boom")
            return {"results": [_row("https://images.unsplash.com/photo-ok")]}

        out = search_replacement_images("orange tabby rescue cat", "", fetch_fn=fetch)
        assert out["candidates"]


class Test自动链路也用上了阶梯:
    """⚠ 纯函数写对 ≠ 自动画页真的用上了（本仓第一条纪律）。

    2026-08-25 之前 fill 只搜整句，那是线上 77%(49/64) 的图还是 placehold.co
    的根因。这一组钉的是"阶梯真的接在 fill 上"，不是"阶梯这个函数存在"。
    """

    def test_fill_整句落空会退到短词_而不是留占位图(self):
        html = (
            '<img src="https://placehold.co/200x200" '
            'alt="Dog standard boarding cage facility">'
        )
        fetch = _fetch(
            {
                # 整句 + 各中间级都空，只有最短那级有货
                "boarding cage": [_row("https://images.unsplash.com/photo-ok-dog")]
            }
        )
        out = fill_stock_placeholders(html, spec={}, goal="", fetch_fn=fetch)
        assert "images.unsplash.com/photo-ok-dog" in out
        # 反向：占位图必须真的没了，不是"换了但两个都在"
        assert "placehold.co" not in out
        # 反向：确实是**退让**到的，第一次问的仍是整句
        assert fetch.seen[0] == "Dog standard boarding cage facility"

    def test_只搜整句时这条会红_证明判据咬得住阶梯(self):
        """把阶梯砍成只剩整句，上面那条就该失败——这里直接把语义写出来：
        整句搜不到时，fill **必须**还问过更短的词。"""
        html = (
            '<img src="https://placehold.co/200x200" '
            'alt="Dog standard boarding cage facility">'
        )
        fetch = _fetch({})
        fill_stock_placeholders(html, spec={}, goal="", fetch_fn=fetch)
        assert len(fetch.seen) > 1, "整句落空后没有退让——阶梯没接上 fill"
        assert fetch.seen[-1] != fetch.seen[0]

    def test_超预算就把剩下的留成占位图_不拖垮画页(self):
        """搜图是**增强**：超了预算留占位图，绝不把画页拖成"等图"。"""
        import services.stock_images as SI

        slow_calls = []

        def slow(query):
            slow_calls.append(query)
            time.sleep(0.05)
            return {"results": []}

        html = "".join(
            f'<img src="https://placehold.co/200x200" alt="topic number {i} scene">'
            for i in range(6)
        )
        old = SI._FILL_BUDGET_S
        try:
            SI._FILL_BUDGET_S = 0.0  # 预算当场用尽
            out = fill_stock_placeholders(html, spec={}, goal="", fetch_fn=slow)
        finally:
            SI._FILL_BUDGET_S = old
        # 预算为 0 → 一个查询都不该发出去，页面原样带着占位图回来
        assert slow_calls == []
        assert out.count("placehold.co") == 6

    def test_超预算不写缓存_否则一次超时会放大成整轮不搜图(self):
        import services.stock_images as SI

        cache: dict = {}
        SI._resolve_query(
            "some long alt phrase",
            fetch_fn=lambda q: {"results": []},
            aspect=None,
            cache=cache,
            deadline=time.monotonic() - 1,  # 已经超了
        )
        assert cache == {}, "超预算写了缓存，后面的页会以为这词搜过、没有"

    def test_同一个词在一页里只解析一次(self):
        """一个 key 对应多张 <img> 时重复解析等于白打图库，还烧预算。

        ⚠ 第一版这条**变异咬不住**：假 fetch 瞬间返回，第一个线程先写完缓存，
          另外两个正好命中缓存，把"没去重"这件事盖住了。解析是并发的，判据
          必须让几个线程真的同时在飞——所以这里的 fetch 要慢一点。
        """
        html = (
            '<img src="https://placehold.co/40x40" alt="administrator avatar portrait">'
            '<img src="https://placehold.co/40x40" alt="administrator avatar portrait">'
            '<img src="https://placehold.co/40x40" alt="administrator avatar portrait">'
        )
        seen: list = []
        lock = threading.Lock()

        def slow_fetch(query):
            with lock:
                seen.append(query)
            time.sleep(0.12)  # 够长，去重没做的话三个线程会同时在飞
            return {
                "results": [_row("https://images.unsplash.com/photo-ok")]
                if query == "administrator avatar portrait"
                else []
            }

        out = fill_stock_placeholders(html, spec={}, goal="", fetch_fn=slow_fetch)
        assert seen.count("administrator avatar portrait") == 1, seen
        # 三张都换掉了
        assert out.count("images.unsplash.com/photo-ok") == 3
