"""单条记录作用域：`data-record`（2026-08-15）。

## 真机形状

烘焙那趟（gemini-3.5-flash）bind 挂了一页，重问 2 次都没改对：

    <h4 data-field=product_ref>：写在 data-rows 容器外面——没有「当前行」
    <strong data-field=stock_qty>：写在 data-rows 容器外面

那是 p1 右侧的「多因子自修正算法分析」面板——**主从视图的详情侧**，
展示当前选中商品的名称、库存、推荐值。

## ⚠ 病根是契约缺了原语，不是模型不会写

原来的词汇只有：

    data-rows   列表（**迭代 + 作用域**焊在一起）
    data-value  聚合数字

**「显示单条记录的某个字段」压根没有对应的词。** 详情卡是后台最常见的版式
之一，而模型能用的字段级动词只有 data-field 一个，它只能那么写。
重问两次不改，是因为它没有别的可选。

## 照 petite-vue 的 v-scope 做，不自创

拉到本地读过（scratchpad/oss/petite-vue）：它的 `v-scope` 和 `v-for`
走的是**同一个** `createScopedContext(ctx, data)`——

    walk.ts:44   ctx = createScopedContext(ctx, scope)        // v-scope
    for.ts:105   const childCtx = createScopedContext(ctx, data)  // v-for

而读字段的指令（v-text / :bind）**根本不关心作用域是循环建的还是 scope 建的**。
Alpine 的 `x-data` / `x-for` 同构。

所以我们也保持 `data-field` **一个词**，不另造 `data-record-field`——
词表分叉就是下一个对不齐的地方（本仓在动作词表上踩过）。
"""

import ast
import inspect
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.html_bindings import (  # noqa: E402
    DATA_SOURCE_KEYS,
    bind_page,
    build_prompt,
    check_bindings,
    check_coverage,
    scan_bindings,
    stamp_implicit_form_record,
)

MODEL = {
    "datamodel": {
        "entities": [
            {"id": "product", "name": "商品",
             "fields": [{"id": "name"}, {"id": "stock_qty"}, {"id": "price"}]},
            {"id": "store", "name": "门店", "fields": [{"id": "title"}]},
        ]
    }
}


def _paths(problems):
    return [p["path"] for p in problems]


class Test单条记录开作用域:
    def test_data_record_里的字段合法(self):
        """★ 真机挂的那个形状，现在应该过。"""
        html = (
            '<div data-record="product">'
            '<h4 data-field="name">示例</h4>'
            '<strong data-field="stock_qty">0</strong>'
            "</div>"
        )
        assert check_bindings(html, MODEL) == []

    def test_两个作用域都不在_照旧报错(self):
        """⚠ 反向：放开 data-record 不等于放开"哪儿都能写 data-field"。
        没有作用域就是没有"当前这条"，取不到东西。"""
        html = '<div><h4 data-field="name">示例</h4></div>'
        probs = check_bindings(html, MODEL)
        assert probs and "作用域外面" in probs[0]["message"]

    def test_报错话术要指路(self):
        """判据报了错还得告诉人怎么改——不然模型重问两次还是原样。
        真机那次的报错只说「写在 data-rows 外面」，而它要的根本不是 rows。"""
        probs = check_bindings('<h4 data-field="name">x</h4>', MODEL)
        msg = probs[0]["message"]
        assert "data-rows" in msg and "data-record" in msg

    def test_字段必须属于开作用域的实体(self):
        """⚠ 跟行内同一条纪律：拿商品的作用域去取门店的字段，
        字段是真的，取出来是别人的数据。"""
        html = '<div data-record="product"><h4 data-field="title">x</h4></div>'
        probs = check_bindings(html, MODEL)
        assert probs and "不是 'product' 的字段" in probs[0]["message"]

    def test_实体不存在要报(self):
        html = '<div data-record="nope"><h4 data-field="name">x</h4></div>'
        assert check_bindings(html, MODEL)


class Test作用域嵌套:
    def test_行内套记录_内层赢(self):
        """petite-vue 用原型链让内层作用域覆盖外层。这里验同样的方向：
        data-record 在 data-rows 里面时，字段按 data-record 的实体判。"""
        html = (
            '<tbody data-rows="store">'
            '<tr><td data-field="title">x</td>'
            '<div data-record="product"><span data-field="stock_qty">0</span></div>'
            "</tr></tbody>"
        )
        assert check_bindings(html, MODEL) == []

    def test_记录套行内_也认(self):
        html = (
            '<div data-record="store"><h4 data-field="title">x</h4>'
            '<tbody data-rows="product"><tr><td data-field="price">0</td></tr></tbody>'
            "</div>"
        )
        assert check_bindings(html, MODEL) == []

    def test_scan_把_record_当作用域(self):
        nodes = scan_bindings('<div data-record="product"><h4 data-field="name">x</h4></div>')
        field_node = next(n for n in nodes if "field" in n["attrs"])
        assert field_node["scope"] == "product"


class Test词表跨语言同步_绑定属性:
    """⚠ **本文件最要紧的一条**。

    前端 `BINDING_ATTRS` 是消毒白名单的唯一来源，而消毒用的是
    `ALLOW_DATA_ATTR: false`——**没列进去的 data-* 会被静默删掉**。
    删掉之后页面照常渲染、消毒器照常报成功、解释器 problems 也是空的
    （没有孔就没有错误的孔），**那个能力整条无声消失**。

    所以 Python 侧认得的每个属性，前端白名单里必须都有。
    """

    def _frontend_attrs(self) -> set:
        import pathlib

        root = pathlib.Path(__file__).resolve().parents[2] / "client"
        src = (root / "src/pages/sliderule/live-runtime/html-binding-runtime.ts").read_text(
            encoding="utf-8"
        )
        m = re.search(r"export const BINDING_ATTRS = \[(.*?)\] as const", src, re.S)
        assert m, "前端找不到 BINDING_ATTRS 数组了"
        return set(re.findall(r'"(data-[a-z-]+)"', m.group(1)))

    @pytest.mark.parametrize("attr", [
        "data-record", "data-record-id",
        "data-search", "data-filter", "data-match", "data-view", "data-delta",
    ])
    def test_新词必须进前端白名单(self, attr):
        assert attr in self._frontend_attrs(), (
            f"{attr} 不在前端 BINDING_ATTRS 里——消毒器会把它静默删掉，"
            f"详情卡的绑定整条无声消失"
        )

    def test_python_认得的属性前端都放行(self):
        """Exercise the parser and compare semantic keys with the sanitizer contract.

        The old test extracted a regex implementation line; HTMLParser removed
        that line while preserving the protocol. Mutating a parser key or a
        sanitizer attribute must still fail this check.
        """
        from services.html_bindings import scan_bindings

        front = self._frontend_attrs()
        markup = '<div ' + ' '.join(f"{key}='value'" for key in front) + '></div>'
        parsed = scan_bindings(markup)
        assert set(parsed[0]["attrs"]) == {key[5:] for key in front}
        tree = ast.parse(inspect.getsource(check_bindings))
        keys = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get" and isinstance(node.func.value, ast.Name) and node.func.value.id == "a":
                if node.args and isinstance(node.args[0], ast.Constant):
                    keys.add(node.args[0].value)
            if isinstance(node, ast.Compare) and isinstance(node.left, ast.Constant) and any(isinstance(op, ast.In) for op in node.ops) and any(isinstance(c, ast.Name) and c.id == "a" for c in node.comparators):
                keys.add(node.left.value)
        assert {"record", "field", "metric-field"} <= keys
        missing = [key for key in keys if f"data-{key}" not in front]
        assert not missing, f"这些属性 Python 认、前端会删：{missing}"


class Test覆盖闸认单条数据源:
    """2026-08-18/19 向导页：scan / check_bindings 认 data-record，
    check_coverage 还只认 rows/value/chart。表单打对了孔也整页失败。
    """

    WIZARD = (
        '<form data-record="product">'
        '<h4 data-field="name">示例</h4>'
        '<button data-action="createRecord" data-entity="product">提交</button>'
        "</form>"
    )

    def test_只有_data_record_的表单算有数据源(self):
        """正向：向导/建档页的合法形状必须过。"""
        assert check_coverage(self.WIZARD, MODEL) == []
        assert check_bindings(self.WIZARD, MODEL) == []

    def test_只有动作孔仍拦(self):
        """反向：放开 record 不等于「有个 createRecord 就算接上了」。"""
        html = '<button data-action="createRecord" data-entity="product">提交</button>'
        msgs = check_coverage(html, MODEL)
        assert msgs and "取不到数" in msgs[0]["message"]
        assert "data-record" in msgs[0]["message"], (
            "重问话术必须点出向导该用的词，否则模型会去硬套 data-rows"
        )

    def test_覆盖词表含_record_且前端选择器同步(self):
        assert "record" in DATA_SOURCE_KEYS
        # 只测 helper 会假绿：覆盖闸改了、前端 hasAnyDataSource 没改，
        # 徽标仍说「尚未接数据」。剥注释再抠函数体，头注里的词喂不绿。
        import pathlib

        ts = (
            pathlib.Path(__file__).resolve().parents[2]
            / "client/src/pages/sliderule/live-runtime/html-binding-runtime.ts"
        ).read_text(encoding="utf-8")
        stripped = re.sub(r"/\*[\s\S]*?\*/", "", ts)
        stripped = re.sub(r"//.*", "", stripped)
        fn = stripped[stripped.index("export function hasAnyDataSource") :]
        fn = fn[: fn.index("\n}")]
        assert "[data-record]" in fn, "前端 hasAnyDataSource 还不认 data-record"

    def test_提示词第一条硬性要求也把_record_算进去(self):
        user = build_prompt("<html></html>", MODEL, "p2")[-1]["content"]
        req1 = user.split("硬性要求")[1].split("2.")[0]
        assert "data-record" in req1, (
            "第 1 条还在说必须有 rows/value/chart——"
            "向导按第 2 条写了 data-record，第 1 条照样判死"
        )

    def test_提示词要求搜索筛选合计打孔(self):
        user = build_prompt("<html></html>", MODEL, "p1")[-1]["content"]
        assert "data-search" in user
        assert "data-filter" in user
        assert 'data-view="cart"' in user
        assert "data-value" in user


class Test搜索筛选购物车孔:
    def test_search_filter_实体必须存在(self):
        bad = '<input data-search="nope">'
        assert check_bindings(bad, MODEL)
        ok = '<input data-search="product">'
        assert check_bindings(ok, MODEL) == []

    def test_view_只许_cart(self):
        bad = '<div data-rows="product" data-view="shelf"></div>'
        assert check_bindings(bad, MODEL)
        ok = '<div data-rows="product" data-view="cart"></div>'
        assert check_bindings(ok, MODEL) == []

    def test_scan_认得_search_filter_view(self):
        nodes = scan_bindings(
            '<input data-search="product">'
            '<button data-filter="product" data-match="*">all</button>'
            '<div data-rows="product" data-view="cart"></div>'
        )
        keys = {k for n in nodes for k in n["attrs"]}
        assert {"search", "filter", "match", "view", "rows"} <= keys

    def test_addToCart_要写在行内(self):
        bad = '<button data-action="addToCart" data-entity="product">加购</button>'
        msgs = [p["message"] for p in check_bindings(bad, MODEL)]
        assert any("当前这一行" in m for m in msgs)
        ok = (
            '<div data-rows="product">'
            '<button data-action="addToCart" data-entity="product">加购</button>'
            "</div>"
        )
        assert check_bindings(ok, MODEL) == []

    def test_clearCart_checkout_不要当前行(self):
        for kind in ("clearCart", "checkout"):
            html = f'<button data-action="{kind}" data-entity="product">x</button>'
            assert check_bindings(html, MODEL) == [], kind

    def test_adjustCartQty_要写在行内(self):
        bad = (
            '<button data-action="adjustCartQty" data-entity="product"'
            ' data-delta="1">+</button>'
        )
        msgs = [p["message"] for p in check_bindings(bad, MODEL)]
        assert any("当前这一行" in m for m in msgs)


class Test表单隐式单条作用域:
    """对照 WHATWG form owner / HTMX / petite-vue 可省略的 v-scope：
    模型漏写 data-record 时，唯一写入实体的表单应被盖上，而不是整页 bind 失败。
    """

    BARE = (
        '<form class="w">'
        '<h4 data-field="name">示例</h4>'
        '<button data-action="createRecord" data-entity="product">提交</button>'
        "</form>"
    )

    def test_漏写_data_record_盖上唯一实体(self):
        out = stamp_implicit_form_record(self.BARE)
        assert 'data-record="product"' in out
        assert check_bindings(out, MODEL) == []
        assert check_coverage(out, MODEL) == []

    def test_两个写入实体不猜(self):
        html = (
            "<form>"
            '<span data-field="name">x</span>'
            '<button data-action="createRecord" data-entity="product">甲</button>'
            '<button data-action="createRecord" data-entity="store">乙</button>'
            "</form>"
        )
        assert stamp_implicit_form_record(html) == html
        assert check_bindings(html, MODEL)

    def test_只有动作孔不盖(self):
        html = (
            '<form><button data-action="createRecord" data-entity="product">'
            "提交</button></form>"
        )
        assert stamp_implicit_form_record(html) == html
        msgs = check_coverage(html, MODEL)
        assert msgs and "取不到数" in msgs[0]["message"]

    def test_已有_data_record_不改(self):
        html = (
            '<form data-record="product">'
            '<h4 data-field="name">示例</h4></form>'
        )
        assert stamp_implicit_form_record(html) == html

    def test_bind_page_先盖再过闸(self):
        """只测 stamp 会假绿：helper 对、bind_page 没接上，真机向导照挂。"""
        src = inspect.getsource(bind_page)
        assert src.index("stamp_implicit_form_record") < src.index("check_coverage")
        tree = ast.parse(src)
        names = [
            n.func.id
            for n in ast.walk(tree)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
        ]
        assert "neutralize_foreign_urls" in names
        assert "stamp_implicit_form_record" in names

    def test_bind_page_漏写也能过(self):
        full = (
            "<!DOCTYPE html><html><head>"
            '<script src="https://cdn.tailwindcss.com"></script>'
            "</head><body>"
            f"{self.BARE.replace('示例', '商品名')}"
            "</body></html>"
        )

        def llm(_messages, **_kwargs):
            return type("R", (), {"content": full})()

        out = bind_page("<html></html>", MODEL, "p2", llm_call=llm, max_reask=0)
        assert 'data-record="product"' in out
        assert check_bindings(out, MODEL) == []
        assert check_coverage(out, MODEL) == []
