"""库存图直挂 URL，不下载。

正向：搜到的 https 图床地址进画页提示词。
反向：模型自己编的图床、页脚乱挂的域名仍拦；调用点真在 generate_pages 之前。
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.spec_page_html import (  # noqa: E402
    build_page_html_prompt,
    scan_foreign_references,
)
from services.stock_images import (  # noqa: E402
    STOCK_IMAGE_HOSTS,
    _queries,
    attach_stock_images,
    fill_stock_placeholders,
    lookup_stock_images,
    render_stock_images,
)

团购 = {
    "appName": "邻里团长台",
    "pages": [
        {"id": "p1", "name": "今日看板", "purpose": "看团购苹果和蔬菜销量"},
    ],
}


def _openverse(
    title: str,
    url: str,
    license_: str = "cc0",
    tags=None,
) -> dict:
    row = {"title": title, "thumbnail": url, "url": url, "license": license_}
    if tags is not None:
        row["tags"] = tags
    return row


def _fetch_ok(_query: str) -> dict:
    return {
        "results": [
            _openverse(
                "Fuji apples",
                "https://images.unsplash.com/photo-real-apple?w=200",
            ),
            _openverse(
                "Leafy greens",
                "https://upload.wikimedia.org/wikipedia/commons/veg.jpg",
            ),
        ]
    }


class Test查表只收白名单图床:
    def test_注入搜到的真地址(self):
        hits = lookup_stock_images(团购, goal="社区团购门店工作台", fetch_fn=_fetch_ok)
        assert hits
        assert all(h["url"].startswith("https://") for h in hits)
        assert any("unsplash.com" in h["url"] for h in hits)
        assert not any("wikimedia" in h["url"] for h in hits)
        assert not any("flickr" in h["url"] for h in hits)

    def test_编出来的图床不进名单(self):
        def fake(_q: str) -> dict:
            return {
                "results": [
                    _openverse("x", "https://evil.example.com/a.jpg"),
                    _openverse("y", "https://images.unsplash.com/photo-ok"),
                ]
            }

        hits = lookup_stock_images(团购, goal="团购苹果", fetch_fn=fake)
        urls = [h["url"] for h in hits]
        assert "https://images.unsplash.com/photo-ok" in urls
        assert not any("evil.example.com" in u for u in urls)

    def test_搜挂了返回空不炸(self):
        def boom(_q: str) -> dict:
            raise RuntimeError("openverse down")

        assert lookup_stock_images(团购, goal="团购", fetch_fn=boom) == []

    def test_直挂原图不用_openverse_缩略图代理(self):
        """2026-08-19：thumbnail 是 api.openverse.org，优先拿它等于搜到 8 条注入 0 条。"""

        def fake(_q: str) -> dict:
            return {
                "results": [
                    {
                        "title": "Fuji",
                        "thumbnail": "https://api.openverse.org/v1/images/abc/thumb/",
                        "url": "https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?ixlib=foo",
                        "license": "cc0",
                    }
                ]
            }

        hits = lookup_stock_images(团购, goal="团购苹果", fetch_fn=fake)
        assert hits
        assert "photo-1560806887-1e4cd0b6cbd6" in hits[0]["url"]
        assert "auto=format" in hits[0]["url"]
        assert "openverse.org" not in hits[0]["url"]

    def test_新注入丢掉flickr只挂unsplash(self):
        """2026-08-31：用户要 Unsplash。Flickr 过闸但不进新注入。"""

        def fake(_q: str) -> dict:
            return {
                "results": [
                    _openverse("x", "https://live.staticflickr.com/1/a.jpg"),
                    _openverse("y", "https://images.unsplash.com/photo-ok"),
                ]
            }

        hits = lookup_stock_images(团购, goal="团购苹果", fetch_fn=fake)
        urls = [h["url"] for h in hits]
        assert urls == ["https://images.unsplash.com/photo-ok"]
        assert not any("flickr" in u for u in urls)

    def test_只有flickr就空_不许硬塞(self):
        def fake(_q: str) -> dict:
            return {
                "results": [_openverse("x", "https://live.staticflickr.com/1/a.jpg")]
            }

        assert lookup_stock_images(团购, goal="团购苹果", fetch_fn=fake) == []

    def test_flickr_与_rawpixel_子域过闸(self):
        from services.stock_images import _host_ok

        assert _host_ok("https://live.staticflickr.com/1/a.jpg")
        assert _host_ok("https://images.rawpixel.com/x.jpg")
        assert not _host_ok("https://api.openverse.org/v1/images/abc/thumb/")


class Test提示词和闸:
    def test_渲染段含完整_URL(self):
        hits = lookup_stock_images(团购, goal="团购苹果", fetch_fn=_fetch_ok)
        text = render_stock_images(hits)
        assert "https://images.unsplash.com/photo-real-apple?w=200" in text
        assert "不要另编图床地址" in text

    def test_贴到风格段后面(self):
        out = attach_stock_images("暖橙色后台", "## 库存图\n- x：https://images.unsplash.com/a")
        assert out.startswith("暖橙色后台")
        assert "https://images.unsplash.com/a" in out

    def test_unsplash_直链不再整页丢掉(self):
        """2026-08-15 / 08-19：闸把 images.unsplash.com 当未授权外链，整页重问丢掉。"""
        blocking, _ = scan_foreign_references(
            '<img src="https://images.unsplash.com/photo-real-apple">'
        )
        assert blocking == [], blocking
        blocking, _ = scan_foreign_references(
            '<img src="https://live.staticflickr.com/1/a.jpg">'
            '<img src="https://images.rawpixel.com/x.jpg">'
        )
        assert blocking == [], blocking

    def test_页脚乱挂域名仍拦(self):
        blocking, _ = scan_foreign_references(
            '<footer>唯一官方: https://www.rcouyi.com</footer>'
        )
        assert blocking

    def test_画页提示词不再塞一袋地址(self):
        """screenshot-to-code disabled + tteg：占位 + alt，不让模型粘贴 URL。"""
        p = build_page_html_prompt("x")
        assert "Image generation is disabled for this request." in p
        assert "Do not invent unsplash or pexels photo IDs" in p
        assert "placehold.co" in p
        assert "exact https addresses" not in p
        assert "库存图 URLs" not in p
        assert "img alt" in p or "search query" in p


class Test查询跟着话题走:
    """2026-08-20：满电青年卡上出现枇杷——词表对不上就搜生鲜。"""

    def test_电动车不搜生鲜(self):
        spec = {
            "appName": "满电青年",
            "pages": [
                {
                    "name": "充电桩地图",
                    "purpose": "给外卖骑手和通勤用户找附近充电桩",
                },
                {"name": "电池健康", "purpose": "看电池健康检测"},
            ],
        }
        goal = "【生活娱乐赛道】满电青年——电动车一站式综合服务平台"
        qs = _queries(spec, goal)
        blob = " ".join(qs).lower()
        assert qs, "电动车话题必须能产出查询，不能空着又去生鲜默认"
        assert "groceries" not in blob
        assert "fruit" not in blob
        assert "apple" not in blob
        # ⚠ 真机第二趟：purpose 里的「外卖骑手」把 food delivery 塞进前三条。
        # 删掉 _reconcile_queries 里丢掉 _FOOD_EN 的那行，这条必红。
        assert "takeaway" not in blob
        assert "food" not in blob
        assert any(
            "electric" in q.lower() or "charg" in q.lower() or "battery" in q.lower()
            for q in qs
        )

        seen: list[str] = []

        def fetch(q: str) -> dict:
            seen.append(q)
            return {"results": []}

        lookup_stock_images(spec, goal=goal, fetch_fn=fetch)
        assert seen == qs

    def test_团购话题仍搜生鲜(self):
        qs = _queries(团购, "社区团购门店工作台")
        blob = " ".join(qs).lower()
        assert "groc" in blob or "apple" in blob or "vegetable" in blob or "fruit" in blob

    def test_词表对不上也不回落生鲜(self):
        qs = _queries(
            {"appName": "星盘台", "pages": [{"name": "排盘", "purpose": "排本命盘"}]},
            "星盘排盘工作台",
        )
        blob = " ".join(qs).lower()
        assert "fresh groceries produce" not in qs
        assert "groc" not in blob
        assert "fruit" not in blob
        assert "apple" not in blob

    def test_源码去掉注释后没有生鲜默认回落(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        src = open(
            os.path.join(root, "services", "stock_images.py"),
            encoding="utf-8",
        ).read()
        stripped = re.sub(r'""".*?"""', "", src, flags=re.S)
        stripped = re.sub(r"#.*", "", stripped)
        fn = stripped[stripped.index("def _queries") : stripped.index("def _fetch_openverse")]
        assert "fresh groceries produce" not in fn
        assert "found or" not in fn

    def test_默认拉取走unsplash不打openverse(self):
        # 2026-08-31：活路径换 Unsplash。把 _unsplash_api 调用删掉、改回
        # Openverse，这条必红。
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        src = open(
            os.path.join(root, "services", "stock_images.py"),
            encoding="utf-8",
        ).read()
        stripped = re.sub(r'""".*?"""', "", src, flags=re.S)
        stripped = re.sub(r"#.*", "", stripped)
        assert "https://api.unsplash.com/search/photos" in stripped
        fn = stripped[
            stripped.index("def _default_fetch") : stripped.index("def lookup_stock_images")
        ]
        assert "_unsplash_api(" in fn
        assert "_catalog_fetch(" in fn
        assert "api.openverse.org" not in fn
        api = stripped[
            stripped.index("def _unsplash_api") : stripped.index("def _default_fetch")
        ]
        assert "_UNSPLASH_SEARCH" in api
        assert "content_filter" in api
        assert "Client-ID" in api


class Test检索结果必须跟话题:
    """查询对了仍可能把番茄排在第一。注入前按标题/标签丢掉。"""

    _EV = {
        "appName": "满电青年",
        "pages": [
            {
                "name": "充电桩地图",
                "purpose": "给外卖骑手和通勤用户找附近充电桩",
            }
        ],
    }
    _GOAL = "【生活娱乐赛道】满电青年——电动车一站式综合服务平台"

    def test_电动车宁可空也不要苹果图(self):
        # _fetch_ok 是团购那组生鲜。车辆查询吃到它必须吐空，不能再注入。
        hits = lookup_stock_images(self._EV, goal=self._GOAL, fetch_fn=_fetch_ok)
        assert hits == []

    def test_电动车丢掉番茄留下充电桩(self):
        def fake(_q: str) -> dict:
            return {
                "results": [
                    _openverse(
                        "Ripe tomatoes and peppers",
                        "https://images.unsplash.com/photo-tomato",
                        tags=["tomato", "pepper", "vegetable"],
                    ),
                    _openverse(
                        "EV charging station",
                        "https://images.unsplash.com/photo-charger",
                        tags=["ev", "charging"],
                    ),
                ]
            }

        hits = lookup_stock_images(self._EV, goal=self._GOAL, fetch_fn=fake)
        blob = " ".join(f"{h.get('label', '')} {h['url']}" for h in hits).lower()
        assert "tomato" not in blob
        assert "pepper" not in blob
        assert "charger" in blob

    def test_团购仍收下生鲜照片(self):
        def fake(_q: str) -> dict:
            return {
                "results": [
                    _openverse(
                        "Ripe tomatoes and peppers",
                        "https://images.unsplash.com/photo-tomato",
                        tags=["tomato", "pepper"],
                    )
                ]
            }

        hits = lookup_stock_images(团购, goal="社区团购门店工作台", fetch_fn=fake)
        assert any("tomato" in h["url"] for h in hits)


class Test按格换图:
    """screenshot-to-code：页面落地后按 alt 换 src。反向：全局袋子会把番茄贴进充电桩。"""

    _EV = Test检索结果必须跟话题._EV
    _GOAL = Test检索结果必须跟话题._GOAL

    def test_充电桩占位换成充电桩图不要番茄(self):
        html = (
            '<img src="https://placehold.co/600x400" alt="ev charging station">'
            '<img src="https://placehold.co/80x80" alt="外卖骑手头像">'
        )
        seen: list[str] = []

        def fake(q: str) -> dict:
            seen.append(q)
            return {
                "results": [
                    _openverse(
                        "Ripe tomatoes and peppers",
                        "https://images.unsplash.com/photo-tomato",
                        tags=["tomato", "pepper"],
                    ),
                    _openverse(
                        "EV charging station",
                        "https://images.unsplash.com/photo-charger",
                        tags=["ev", "charging"],
                    ),
                    _openverse(
                        "Electric scooter rider",
                        "https://images.unsplash.com/photo-scooter",
                        tags=["scooter", "electric"],
                    ),
                ]
            }

        out = fill_stock_placeholders(
            html, spec=self._EV, goal=self._GOAL, fetch_fn=fake
        )
        blob = " ".join(seen).lower()
        assert "takeaway" not in blob
        assert "food" not in blob
        assert "tomato" not in out
        assert "placehold.co" not in out
        assert "photo-charger" in out or "photo-scooter" in out

    def test_同一_alt_只搜一次(self):
        html = (
            '<img src="https://placehold.co/40x40" alt="ev charging station">'
            '<img src="https://placehold.co/80x80" alt="ev charging station">'
        )
        seen: list[str] = []

        def fake(q: str) -> dict:
            seen.append(q)
            return {
                "results": [
                    _openverse(
                        "EV charging station",
                        "https://images.unsplash.com/photo-charger",
                        tags=["ev"],
                    )
                ]
            }

        fill_stock_placeholders(html, spec=self._EV, goal=self._GOAL, fetch_fn=fake)
        assert seen == ["ev charging station"]

    def test_搜空就留占位(self):
        html = '<img src="https://placehold.co/600x400" alt="ev charging station">'

        def fake(_q: str) -> dict:
            return {"results": []}

        out = fill_stock_placeholders(
            html, spec=self._EV, goal=self._GOAL, fetch_fn=fake
        )
        assert "placehold.co" in out

    def test_模板英文alt不印在卡片上_改搜话题(self):
        """⚠ 2026-08-21 素材雷达：placehold.co?text=AI+Workflow+Video。"""
        from services.stock_images import _img_search_query

        spec = {
            "appName": "内容雷达",
            "pages": [{"name": "首页", "purpose": "看自媒体素材封面"}],
        }
        goal = "面向自媒体创作者与内容团队的素材雷达"
        topics = _queries(spec, goal)
        blob = " ".join(topics).lower()
        assert "creator" in blob or "footage" in blob or "filming" in blob
        assert _img_search_query("AI Workflow Video", topics) != "AI Workflow Video"

        html = (
            '<img src="https://placehold.co/600x400?text=AI+Workflow+Video" '
            'alt="AI Workflow Video">'
        )

        def fake(_q: str) -> dict:
            return {"results": []}

        out = fill_stock_placeholders(html, spec=spec, goal=goal, fetch_fn=fake)
        assert "AI+Workflow" not in out
        assert "text=" not in out.lower()
        assert "placehold.co" in out
        assert 'alt="AI Workflow Video"' in out


class TestUnsplash目录退路:
    """没 key 时不能再打 Openverse（超时 + 没有 unsplash 源）。
    整词命中才换；对不上留占位——错图比没图更糟。"""

    def test_没key时fill挂用户那张林间图(self, monkeypatch):
        monkeypatch.delenv("UNSPLASH_ACCESS_KEY", raising=False)
        monkeypatch.delenv("UNSPLASH_API_KEY", raising=False)
        html = (
            '<img src="https://placehold.co/1200x800" '
            'alt="morning forest trail mist">'
        )
        out = fill_stock_placeholders(html, spec={}, goal="")
        assert "photo-1500530855697-b586d89ba3ee" in out
        assert "auto=format" in out
        assert "fit=crop" in out
        assert "placehold.co" not in out

    def test_对不上词就留占位_不许硬塞林间图(self, monkeypatch):
        monkeypatch.delenv("UNSPLASH_ACCESS_KEY", raising=False)
        monkeypatch.delenv("UNSPLASH_API_KEY", raising=False)
        html = (
            '<img src="https://placehold.co/600x400" '
            'alt="natal chart astrology zodiac">'
        )
        out = fill_stock_placeholders(html, spec={}, goal="")
        assert "placehold.co" in out
        assert "photo-1500530855697-b586d89ba3ee" not in out
        assert "images.unsplash.com" not in out


class Test接在画页之后:
    def test_主链路先画再按格填(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        src = open(
            os.path.join(root, "services", "spec_first_pipeline.py"),
            encoding="utf-8",
        ).read()
        stripped = re.sub(r'""".*?"""', "", src, flags=re.S)
        stripped = re.sub(r"#.*", "", stripped)
        pages = stripped[
            stripped.index("specfirst.pages") : stripped.index("specfirst.shell")
        ]
        assert "attach_stock_images(" not in pages
        assert "lookup_stock_images(" not in pages
        i = pages.index("generate_pages_parallel(")
        # 嵌套函数定义可能出现在调用 generate 之前；真正换的是返回后的 pages。
        assert "fill_stock_placeholders(" in pages
        assert pages.rindex("_fill_html(") > i
        bind = stripped[stripped.index("repair_pages_after_bind(") :]
        assert "_fill_html(" in bind[:4000]
        # 删掉画页后的 _fill_html，这条必红——提示词不再塞 URL，不填就没有真图。

    def test_图床名单两边一致(self):
        from services import spec_page_html as sph
        from services.stock_images import FILL_IMAGE_HOSTS

        for host in STOCK_IMAGE_HOSTS:
            assert host in sph._ALLOWED_HOSTS
        for host in FILL_IMAGE_HOSTS:
            assert host in sph._ALLOWED_HOSTS
            assert host in STOCK_IMAGE_HOSTS
