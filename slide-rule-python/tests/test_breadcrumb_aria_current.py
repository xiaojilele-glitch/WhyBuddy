"""面包屑当前节照 W3C ARIA APG 认 `aria-current="page"`（2026-08-15）。

## 真机形状：修复静静地不生效

第一版 `set_breadcrumb_current` 只认 `<nav aria-label="Breadcrumb">` 里的
最后一个 `<li>`——那是**汽修那一趟**的 markup。烘焙那趟 ouyi 写的是：

    <nav class="flex items-center text-sm text-slate-500">
      <span class="hover:text-slate-700 cursor-pointer">库存管理</span>
      <i class="fas fa-chevron-right"></i>
      <span>损耗登记</span>
    </nav>

裸 nav、没有 aria-label、用 `<span>` + 图标分隔符。于是四页面包屑一模一样，
**没有报错、没有告警、判据全绿**——我差点把它记成「这趟没触发」。

⚠ 拿一个样本的 markup 当通用结构，这是同一类错误的第五次
  （前四次：120s 落后者截止线、外链判据 94% 命中、main 抄整段、用例形状写错）。
  而这次最隐蔽：前几次都会红或者出事，这次是功能悄悄不工作。

## 认 aria-current，不自造属性

W3C ARIA APG 的 Breadcrumb 模式规定当前项打 `aria-current="page"`
（官方示例源码拉下来对过：aria-practices/content/patterns/breadcrumb/
examples/breadcrumb.html）：

    <li><a href="./breadcrumb.html" aria-current="page">Breadcrumb Example</a></li>

Bootstrap / Ant Design / Tailwind UI 的面包屑组件都照这个出。

而且这个属性在本仓**已经验证可行**：侧栏导航的 build_nav_items 一直在打它、
兜底 CSS 挂在它上面、真机截图上的蓝底高亮就是它——**已经活着穿过消毒器了**。
所以不另造 `data-crumb-current`：词表分叉是下一个对不齐的地方。
"""

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.page_shell import set_breadcrumb_current, unify_shell  # noqa: E402
from services.spec_page_html import build_page_html_prompt  # noqa: E402


def _text(header: str) -> str:
    nav = re.search(r"<nav\b[^>]*>[\s\S]*?</nav>", header or "")
    return " ".join(re.sub(r"<[^>]+>", " ", nav.group(0)).split()) if nav else ""


APG = (
    "<header>"
    '<nav aria-label="Breadcrumb"><ol>'
    '<li><a href="/">首页</a></li>'
    '<li><a href="/inv">库存管理</a></li>'
    '<li><a href="./x" aria-current="page">旧页名</a></li>'
    "</ol></nav></header>"
)

#: 烘焙那趟 ouyi 的真实写法：裸 nav、无 aria-label、span + 图标分隔
BARE = (
    '<header class="h-16">'
    '<nav class="flex items-center text-sm text-slate-500">'
    '<span class="hover:text-slate-700 cursor-pointer">库存管理</span>'
    '<i class="fas fa-chevron-right mx-2"></i>'
    "<span>损耗登记</span>"
    "</nav></header>"
)

#: 汽修那趟的写法：aria-label + li，当前节没有 aria-current
LI_ONLY = (
    "<header>"
    '<nav aria-label="Breadcrumb"><ol>'
    "<li>首页</li>"
    '<li><svg class="w-4 h-4"></svg></li>'
    '<li class="font-medium">服务接车</li>'
    "</ol></nav></header>"
)


class Test三种真机写法都认:
    def test_APG_标准_aria_current(self):
        out = set_breadcrumb_current(APG, "损耗登记簿")
        assert _text(out) == "首页 库存管理 损耗登记簿"

    def test_裸nav加span_烘焙那趟(self):
        """★ **第一版漏的就是这个**，四页面包屑一模一样却全绿。"""
        out = set_breadcrumb_current(BARE, "经营监控看板")
        assert _text(out) == "库存管理 经营监控看板"

    def test_当前节不在最后时_按aria_current取(self):
        """⚠ **变异测试逼出来的一条**。

        上面三条里当前节恰好都是最后一节，于是「认 aria-current」和
        「取最后一节」两条路径结果一样——**把 aria-current 那段整个删掉，
        13 条一条都不红**。判据没有区分度等于没判。

        真实场景里当前节后面常跟着东西：状态徽标、操作按钮、收藏图标。
        这时只有认 aria-current 才取得对。
        """
        src = (
            "<header>"
            '<nav aria-label="Breadcrumb"><ol>'
            '<li><a href="/">首页</a></li>'
            '<li><a href="./x" aria-current="page">旧页名</a></li>'
            '<li><span class="badge">草稿</span></li>'
            "</ol></nav></header>"
        )
        out = set_breadcrumb_current(src, "新页名")
        assert "新页名" in out and "旧页名" not in out
        assert "草稿" in out, "把当前节后面的徽标当成当前节改掉了"

    def test_li结构无aria_汽修那趟(self):
        out = set_breadcrumb_current(LI_ONLY, "库存明细与调拨页")
        assert _text(out) == "首页 库存明细与调拨页"


class Test前面的层级不许被吃:
    """⚠ 踩过：惰性组一路吞到最后一个闭合标签，把「首页 ›」连同分隔符换没了。"""

    @pytest.mark.parametrize("src,keep", [(APG, "首页"), (BARE, "库存管理"), (LI_ONLY, "首页")])
    def test_层级前缀还在(self, src, keep):
        assert keep in _text(set_breadcrumb_current(src, "新页名"))

    def test_分隔符还在(self):
        out = set_breadcrumb_current(BARE, "新页名")
        assert "fa-chevron-right" in out, "图标分隔符被吃了"

    def test_aria_current_属性保留(self):
        """换的是文本，不是整个节点——属性掉了下一轮就认不出来了。"""
        assert 'aria-current="page"' in set_breadcrumb_current(APG, "新页名")


class Test不许误伤:
    def test_没有面包屑就原样返回(self):
        h = '<header class="h-16"><span>顶栏</span></header>'
        assert set_breadcrumb_current(h, "新页") == h

    def test_页名为空时不动(self):
        assert set_breadcrumb_current(APG, "") == APG

    def test_页名里的尖括号被转义(self):
        out = set_breadcrumb_current(APG, "<script>x</script>")
        assert "<script>" not in out and "&lt;script&gt;" in out

    def test_侧栏的_aria_current_不受影响(self):
        """⚠ **本文件最要紧的一条**。侧栏导航和面包屑**都**会有
        aria-current="page"（真机每页 2 个就是这么来的）。

        取当前节必须限定在**面包屑那个 nav 里**——全页找会改到侧栏的菜单项，
        把某个菜单名换成页名，而那是用户一眼能看见的破坏。
        """
        page = (
            "<!doctype html><html><head></head><body>"
            '<aside class="w-64"><nav>'
            '<a class="flex" aria-current="page">智能订货台</a>'
            '<a class="flex">损耗登记簿</a></nav></aside>'
            + APG
            + '<main class="flex-1"><div>正文</div></main></body></html>'
        )
        spec = {"pages": [{"id": "p1", "name": "智能订货台"},
                          {"id": "p2", "name": "损耗登记簿"}]}
        out = unify_shell({"p1": page, "p2": page}, spec)["pages"]
        aside = re.search(r"<aside[\s\S]*?</aside>", out["p2"]).group(0)
        labels = re.findall(r"<a\b[^>]*>([\s\S]*?)</a>", aside)
        labels = [re.sub(r"<[^>]+>", "", x).strip() for x in labels]
        assert labels == ["智能订货台", "损耗登记簿"], f"侧栏菜单被改了：{labels}"


class Test生成侧要求按APG出:
    def test_提示词里写了_aria_current(self):
        """判据只能认它已知的形状。所以**生成侧也要引导** ——
        两边都做才闭环：模型按 APG 出 → 判据认得出 → 逐页改对。

        ⚠ 钉在**最终提示词**上，不钉某个常量：设计系统 2026-08-15 晚劈成了
          「契约 + 可注入风格」两半，钉常量的写法当天就失效了。而且钉提示词
          更准——真正送到模型面前的是它，不是任何一个中间常量。
        """
        p = build_page_html_prompt("某页")
        assert 'aria-current="page"' in p
        assert "Breadcrumb" in p

    def test_注入风格也冲不掉面包屑要求(self):
        """★ 劈成两半之后最要紧的一条：风格是外面给的，**契约必须还在**。

        注入方写「极简单栏、去掉一切导航装饰」这类描述是完全合法的，
        而它一旦把面包屑冲掉，set_breadcrumb_current 就没东西可改——
        四页面包屑一模一样，且判据全绿（今天刚这么栽过一次）。
        """
        p = build_page_html_prompt("某页", design_system="极简风，单栏，去掉一切导航装饰")
        assert 'aria-current="page"' in p and "Breadcrumb" in p
        assert "极简风" in p, "注入的风格没进去"
