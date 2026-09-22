"""交付物里不许出现生成方的品牌、域名（2026-08-15）。

## 真机形状

连锁药房那趟，p3「库存效期看板」的页脚：

    © 2024 欧亿智能库存效期管理系统 | 全局同步延迟 < 1s | 唯一官方: https://www.rcouyi.com

**中转站自己的域名被写进了客户的产品里。** 同一天还见过它拿这个名字当产品名：
欧亿智造系统 / 欧亿口腔 / 欧亿医疗连锁。

根源是中转站往请求里注入的人设（跟 agentic-pick 那次「你好！我是 OuYi」同源），
只是这次泄漏到了产出里。外壳漂移是排版问题，这个是**交付事故**。

## ⚠ 本文件最要紧的一条：不许拦「品牌名」

同一天的产出里有士卓曼 (Straumann BLT)、诺贝尔 (Nobel Biocare)、Bio-Oss 骨粉、
瑞士ITI种植体——**那些是正确的领域细节，是这个模型最值钱的地方**。
做通用品牌词过滤会把好东西一起杀掉。

所以判据收窄成两条机械可判的：
  ① 白名单之外的外部主机
  ② 生成方自己的身份（欧亿 / OuYi / rcouyi）

下面 `Test领域品牌不许被误伤` 那组就是钉这一半的——**把判据写成"扫所有 http 链接"
或"扫所有品牌词"也能让正向变绿**，而那会让整条链退回到没有领域细节的通用页面。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.spec_page_html import (  # noqa: E402
    neutralize_foreign_urls,
    scan_foreign_references,
    validate_page_html,
)


def blocking(markup: str):
    return scan_foreign_references(markup)[0]


def notes(markup: str):
    return scan_foreign_references(markup)[1]

_HEAD = (
    "<!doctype html><html><head>"
    '<script src="https://cdn.tailwindcss.com"></script></head><body>'
)
_TAIL = "</body></html>"


def _page(inner: str) -> str:
    """一份能过其余所有判据的最小页面，只有 inner 是变量。"""
    return _HEAD + "中文占位 张师傅 20XX-XX-XX" + inner + _TAIL


class Test供应商身份:
    def test_页脚那行真机原文被拦下(self):
        """★ 真机挂的就是这一条。"""
        out = blocking(
            '<footer>© 2024 欧亿智能库存效期管理系统 | 唯一官方: https://www.rcouyi.com</footer>'
        )
        assert out, "真机那行页脚居然放行了"
        assert any("供应商" in p for p in out)
        assert any("外部链接" in p for p in out), "域名那半也该单独报"

    @pytest.mark.parametrize("word", ["欧亿智造系统", "OuYi 助手", "rcouyi", "由 ouyi 提供"])
    def test_各种写法都拦(self, word):
        assert blocking(f"<footer>{word}</footer>")

    def test_接进主判据(self):
        """⚠ 光有函数不算数——得真的挂在 validate_page_html 上，
        否则第 3 步和 bind 都不会调它。"""
        probs = validate_page_html(_page("<footer>欧亿智能系统</footer>"))
        assert any("供应商" in p for p in probs)


class Test外部链接:
    def test_白名单放行(self):
        """提示词点名要引 tailwind CDN、允许 placehold.co——它们不能报。"""
        assert not blocking(
            '<script src="https://cdn.tailwindcss.com"></script>'
            '<img src="https://placehold.co/600x400">'
            '<img src="https://images.unsplash.com/photo-ok">'
            '<link href="https://fonts.googleapis.com/css2?family=Inter">'
        )

    def test_子域也放行(self):
        assert not blocking('<img src="https://img.placehold.co/x.png">')

    @pytest.mark.parametrize(
        "url",
        [
            "https://www.rcouyi.com",
            "http://evil.example.com/track.js",
            "https://analytics.somevendor.io/t.gif",
        ],
    )
    def test_白名单之外一律报(self, url):
        """⚠ 这里刻意**不放**公共 CDN（cdnjs/unpkg/jsdelivr）——
        它们归「只提醒」那一档，见 Test上线前那次量出来的两个坑。
        第一版把 jsdelivr 写在这里，跟后来那档规则直接打架。"""
        out = blocking(f'<script src="{url}"></script>')
        assert any("外部链接" in p for p in out), f"{url} 被放行了"

    def test_干净页面不报(self):
        assert validate_page_html(_page("<table><tr><td>阿莫西林胶囊</td></tr></table>")) == []


class Test领域品牌不许被误伤:
    """⚠ **本文件最要紧的一组**。

    把判据写成「扫所有品牌词」或「扫所有 http 链接」也能让上面几条变绿，
    但会把这个模型最值钱的领域细节一起杀掉——那比页脚多一行域名糟得多。
    """

    @pytest.mark.parametrize(
        "text",
        [
            "士卓曼 (Straumann) - BLX 系列 Φ4.5mm × L12mm",
            "诺贝尔Nobel种植体 1.8% 损耗",
            "Bio-Oss 骨粉 0.5g ×1",
            "瑞士ITI种植体 · 阿莫西林胶囊 BT2023050122",
            "全髋关节置换术 (All-on-4)",
        ],
    )
    def test_真实领域品牌照常放行(self, text):
        assert blocking(f"<div>{text}</div>") == [], (
            f"领域细节被误杀了：{text}"
        )

    def test_品牌名带官网也只报链接不报品牌(self):
        """边界：万一模型给领域品牌配了官网，报的应该是「外部链接」这一条，
        而不是把品牌名本身当违规——两者的修法不同。"""
        out = blocking('<a href="https://www.straumann.com">士卓曼</a>')
        assert len(out) == 1 and "外部链接" in out[0]


class Test上线前那次量出来的两个坑:
    """⚠ **本文件第二要紧的一组**。第一版把所有命中都当阻断，
    拿 35 份真机产出一量：**94% 命中**——每页都要重问、整步必挂，
    判据本身会变成事故。同 120s 落后者截止线那次的错法：
    拿一批数据推的规则套到另一批上，没量就上线。
    """

    def test_xmlns_不是链接(self):
        """★ 铁误报：每个内联 SVG 都有 xmlns，第一版当场把 w3.org 报出来。"""
        svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>'
        assert blocking(svg) == [], "xmlns 又被当成外链了"

    @pytest.mark.parametrize(
        "host", ["cdnjs.cloudflare.com", "unpkg.com", "cdn.jsdelivr.net"]
    )
    def test_公共_CDN_只提醒不阻断(self, host):
        """35 份真机产出里 17 份引了这类 CDN。阻断它等于打死一半以上的页面。
        要不要收敛依赖是产品决策，不该由校验规则替人做主。"""
        m = f'<script src="https://{host}/x.js"></script>'
        assert blocking(m) == [], f"{host} 被当成阻断项了"
        assert notes(m), f"{host} 连提醒都没有——那这条信息就丢了"

    def test_提醒项不进主判据(self):
        """⚠ 反向那半：提醒必须**真的**不阻断。
        把 notes 也接进 validate_page_html 也能让上面变绿一半，
        但整步会照样挂。"""
        page = _page('<script src="https://cdnjs.cloudflare.com/x.js"></script>')
        assert validate_page_html(page) == []

    def test_真事故仍然阻断(self):
        """⚠ 放宽之后，最该拦的那个必须还拦得住。"""
        assert blocking('<footer>唯一官方: https://www.rcouyi.com</footer>')


class Test示例外链剥掉而不是整页扔掉:
    """2026-08-20 Foclip：示例 href 把拾取工作台整页判死刑，菜单还在。"""

    def test_脏页校验仍报_剥完就过(self):
        """正向：留下正文。反向：不剥的话 validate 必须还红——否则判据打空。"""
        raw = _page('<a href="https://tech.example.com/clip">来源条目</a>')
        assert any("外部链接" in p for p in validate_page_html(raw))
        cleaned = neutralize_foreign_urls(raw)
        assert "tech.example.com" not in cleaned
        assert "来源条目" in cleaned
        assert validate_page_html(cleaned) == []

    def test_白名单和_xmlns_不动(self):
        raw = _page(
            '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
            '<img src="https://placehold.co/600x300">'
        )
        assert neutralize_foreign_urls(raw) == raw

    def test_供应商字样不靠剥链接放行(self):
        """欧亿是品牌泄漏，剥掉 rcouyi.com 之后字还在，必须继续 fail-closed。"""
        raw = _page("<footer>欧亿智能库存效期管理系统</footer>")
        assert any("供应商" in p for p in validate_page_html(neutralize_foreign_urls(raw)))

