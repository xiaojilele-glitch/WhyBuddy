# -*- coding: utf-8 -*-
"""在已画好的页面上改一小块，而不是整页重画（2026-08-17）。

## 病灶

用户的迭代要求绝大多数是局部的——「菜单栏那个图标换一个」「客户看板下面那个
模块加点数据」「这一步流程不合理，调下顺序」。而系统把那一页从零重画：慢，
而且**重画等于让模型重新发明这一页的每一个元素**，用户没提的部分照样会变。

按需重画（refine_page_scope）把范围从"所有页"缩到"指令点到的页"，
这一层再从"整页重画"缩到"只改那几行"。

## 做法取自 Aider 的 SEARCH/REPLACE edit block

最该抄、也最容易抄漏的一条：**不做模糊匹配**。Aider 的
`replace_most_similar_chunk` 里编辑距离那一层被裸 `return` 短路掉了——
模糊匹配对错地方时，改动落在"看起来像"的位置上，而这种错在日志和判据里
跟成功长得一模一样。宁可如实失败、把真实原文回喂给模型重问。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.page_edit_blocks import (  # noqa: E402
    apply_edit_blocks,
    apply_one,
    build_edit_prompt,
    describe_failures,
    parse_edit_blocks,
)

HTML = """<!DOCTYPE html>
<html><body>
  <nav>
    <a class="item"><i class="fa fa-home"></i>首页</a>
    <a class="item"><i class="fa fa-user"></i>客户</a>
  </nav>
  <section id="board">
    <div class="card">暂无数据</div>
  </section>
</body></html>"""


def _blk(search, replace):
    return f"<<<<<<< SEARCH\n{search}\n=======\n{replace}\n>>>>>>> REPLACE"


class Test解析:
    def test_抠出一个块(self):
        got = parse_edit_blocks(_blk("旧内容", "新内容"))
        assert got == [("旧内容", "新内容")]

    def test_抠出多个块(self):
        text = _blk("a", "A") + "\n\n随便说点什么\n\n" + _blk("b", "B")
        assert parse_edit_blocks(text) == [("a", "A"), ("b", "B")]

    def test_容忍围栏(self):
        assert parse_edit_blocks("```html\n" + _blk("a", "A") + "\n```") == [("a", "A")]

    def test_允许替换成空_即删除(self):
        assert parse_edit_blocks("<<<<<<< SEARCH\na\n=======\n\n>>>>>>> REPLACE") == [("a", "")]

    def test_标记写错就当没有_不去猜(self):
        """反向判据：标记不完整不许模糊识别。

        猜错了会把一段不相干的内容当成 SEARCH，改到别处去。
        """
        assert parse_edit_blocks("<<<<<< SEARCH\na\n=======\nA\n>>>>>>> REPLACE") == []
        assert parse_edit_blocks("完全没有块的一段话") == []
        assert parse_edit_blocks(None) == []  # type: ignore[arg-type]

    def test_空SEARCH段丢掉(self):
        assert parse_edit_blocks("<<<<<<< SEARCH\n\n=======\nA\n>>>>>>> REPLACE") == []


class Test匹配:
    def test_完全一致(self):
        got = apply_one(HTML, '<i class="fa fa-home"></i>首页', '<i class="fa fa-house"></i>首页')
        assert got is not None and "fa-house" in got and "fa-home" not in got

    def test_只替换第一处(self):
        """Aider 原文：only replace the first match occurrence。"""
        got = apply_one('<a class="item">x</a>\n<a class="item">y</a>', '<a class="item">', "<b>")
        assert got.count("<b>") == 1 and got.count('<a class="item">') == 1

    def test_容忍行尾空白差异(self):
        got = apply_one(HTML, '    <div class="card">暂无数据</div>   ', "    <div>有数据</div>")
        assert got is not None and "有数据" in got

    def test_容忍模型多加的开头空行(self):
        got = apply_one(HTML, '\n  <section id="board">', '  <section id="board2">')
        assert got is not None and 'id="board2"' in got

    def test_匹配不上就返回None_不做模糊匹配(self):
        """★ 本文件最要紧的一条。

        `<div class="cart">` 跟原文的 `<div class="card">` 只差一个字母，
        模糊匹配会"贴心地"改掉它——而那正是改错地方。宁可失败。
        """
        assert apply_one(HTML, '<div class="cart">暂无数据</div>', "<div>X</div>") is None
        assert apply_one(HTML, "原文里压根没有这段", "X") is None

    def test_空SEARCH不匹配(self):
        assert apply_one(HTML, "", "X") is None


class Test套用:
    def test_多块依次套上(self):
        got = apply_edit_blocks(HTML, [("fa-home", "fa-house"), ("暂无数据", "12 条记录")])
        assert len(got["applied"]) == 2 and not got["failed"]
        assert "fa-house" in got["html"] and "12 条记录" in got["html"]

    def test_部分成功也如实返回(self):
        got = apply_edit_blocks(HTML, [("fa-home", "fa-house"), ("不存在的内容", "X")])
        assert len(got["applied"]) == 1 and len(got["failed"]) == 1
        assert "fa-house" in got["html"]

    def test_一块都没套上时html原样(self):
        """★ 调用方必须看 applied 数，不能只看 html。

        这里原样返回输入，正是"东西看着在其实没动"的温床——所以
        edit_page_html 里有一条专门的判据钉住"applied 为 0 就回落重画"。
        """
        got = apply_edit_blocks(HTML, [("不存在", "X")])
        assert got["applied"] == [] and got["html"] == HTML

    def test_不改动入参(self):
        before = HTML
        apply_edit_blocks(HTML, [("fa-home", "fa-house")])
        assert HTML == before


class Test提示词:
    def test_把整页原文喂进去(self):
        """SEARCH 要逐字符匹配，模型手里没原文就只能凭记忆编。"""
        user = build_edit_prompt("p1", HTML, "菜单栏图标换一个")[-1]["content"]
        assert 'fa fa-home' in user and "菜单栏图标换一个" in user

    def test_说清三条硬规则(self):
        user = build_edit_prompt("p1", HTML, "改点东西")[-1]["content"]
        assert "逐字符一致" in user, "没要求逐字符，SEARCH 必然对不上"
        assert "第一处" in user, "没说只替换第一处，模型会以为全局替换"
        assert "块要小" in user or "只包含要改的" in user

    def test_明确不许输出整页(self):
        """反向判据：不写死这条，模型会"顺手"把整页重发一遍——那就退回全量了。"""
        user = build_edit_prompt("p1", HTML, "改点东西")[-1]["content"]
        assert "不要输出整页" in user

    def test_明确不许动没提的地方(self):
        user = build_edit_prompt("p1", HTML, "改点东西")[-1]["content"]
        assert "没提的地方" in user


class Test失败回喂:
    def test_带上原文里最接近的几行(self):
        """照 Aider 的 find_similar_lines：光说"没匹配上"模型不知道差在哪。"""
        msg = describe_failures(HTML, [('<div class="cart">暂无数据</div>', "X")])
        assert "没能在原文里找到" in msg
        assert 'class="card"' in msg, "没把原文里最接近的行贴回去，模型改不动"

    def test_没有失败就不啰嗦(self):
        assert describe_failures(HTML, []) == ""

    def test_差一两个字符时也找得到(self):
        """★ 最需要提示的正是这种近似情形，子串包含在这时必然一条都找不到。"""
        from services.page_edit_blocks import find_similar_lines

        near = find_similar_lines('    <div class="cart">暂无数据</div>', HTML)
        assert any('class="card"' in ln for ln in near)

    def test_八竿子打不着的不硬凑(self):
        """反向判据：相似度太低就别给提示，给了只会误导。"""
        from services.page_edit_blocks import find_similar_lines

        assert find_similar_lines("完全无关的一段文字zzzz", HTML) == []


class Test改不动就回落整页重画:
    """★ 三道关，任何一关不过都必须回落——而且是回落到**重画**，不是"不改"。"""

    PAGE = {"id": "p1", "name": "工单页"}
    OK_HTML = (
        '<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script>'
        "</head><body><nav>菜单</nav><main>正文</main></body></html>"
    )

    def _rsp(self, text):
        class R:
            content = text

        return R()

    def test_模型没给出块就回落(self):
        from services.spec_page_html import edit_page_html

        got = edit_page_html(
            self.PAGE, self.OK_HTML, "改点东西",
            llm_call=lambda m, **k: self._rsp("好的，我建议这样改……（没有块）"),
        )
        assert got is None

    def test_一块都没匹配上就回落_不许把原样HTML当成改好了(self, capsys):
        """★ 最阴的一条：apply 失败时返回的是**原样 HTML**。

        不看 applied 数直接交出去，表现是"用户说了话、页面一个字没变、
        日志全绿"——本仓数得最多的那个形状。
        """
        from services.spec_page_html import edit_page_html

        blk = "<<<<<<< SEARCH\n原文里压根没有这段\n=======\nX\n>>>>>>> REPLACE"
        got = edit_page_html(
            self.PAGE, self.OK_HTML, "改点东西",
            llm_call=lambda m, **k: self._rsp(blk), max_attempts=1,
        )
        assert got is None, "一块都没套上却当成改好了"
        assert "没匹配上" in capsys.readouterr().out

    def test_改完过不了页面校验就回落(self, capsys):
        """局部改一样能把页面改坏——比如把 Tailwind 那行删掉。"""
        from services.spec_page_html import edit_page_html

        blk = (
            '<<<<<<< SEARCH\n<script src="https://cdn.tailwindcss.com"></script>\n'
            "=======\n\n>>>>>>> REPLACE"
        )
        got = edit_page_html(
            self.PAGE, self.OK_HTML, "把 tailwind 去掉",
            llm_call=lambda m, **k: self._rsp(blk), max_attempts=1,
        )
        assert got is None
        assert "没过校验" in capsys.readouterr().out

    def test_改成功时返回同款形状(self):
        from services.spec_page_html import edit_page_html

        blk = "<<<<<<< SEARCH\n<nav>菜单</nav>\n=======\n<nav>新菜单</nav>\n>>>>>>> REPLACE"
        got = edit_page_html(
            self.PAGE, self.OK_HTML, "菜单改个名",
            llm_call=lambda m, **k: self._rsp(blk),
        )
        assert got is not None
        assert got["pageId"] == "p1" and "新菜单" in got["html"]
        assert got["editedBlocks"] == 1
        assert "cdn.tailwindcss.com" in got["html"], "没改的部分被动了"

    def test_没有上一版或没有指令时不走这条路(self):
        from services.spec_page_html import edit_page_html

        boom = lambda m, **k: (_ for _ in ()).throw(AssertionError("不该调 LLM"))
        assert edit_page_html(self.PAGE, "", "改点东西", llm_call=boom) is None
        assert edit_page_html(self.PAGE, self.OK_HTML, "  ", llm_call=boom) is None


class Test接线_批量里能局部改:
    SPEC = {"pages": [{"id": "p1", "name": "工单页"}]}
    OK_HTML = (
        '<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script>'
        "</head><body><nav>菜单</nav><main>正文</main></body></html>"
    )

    def test_有基线和指令时走局部改_不整页重画(self, monkeypatch):
        from services import spec_page_html as sph

        redrew = []
        monkeypatch.setattr(
            sph, "generate_page_html",
            lambda pg, spec, **kw: redrew.append(str(pg.get("id"))) or {"html": "<html>重画</html>"},
        )
        monkeypatch.setattr(
            sph, "edit_page_html",
            lambda pg, prev, instr, **kw: {"html": "<html>局部改过</html>", "pageId": "p1"},
        )
        out = sph.generate_pages_parallel(
            self.SPEC, edit_base={"p1": self.OK_HTML}, edit_instruction="菜单改个名"
        )
        assert redrew == [], "有基线却还是整页重画了"
        assert out["pages"]["p1"] == "<html>局部改过</html>"

    def test_局部改不动时回落整页重画(self, monkeypatch):
        from services import spec_page_html as sph

        monkeypatch.setattr(
            sph, "generate_page_html", lambda pg, spec, **kw: {"html": "<html>重画</html>"}
        )
        monkeypatch.setattr(sph, "edit_page_html", lambda pg, prev, instr, **kw: None)
        out = sph.generate_pages_parallel(
            self.SPEC, edit_base={"p1": self.OK_HTML}, edit_instruction="改点东西"
        )
        assert out["pages"]["p1"] == "<html>重画</html>"

    def test_局部改抛异常也回落_不拖垮整批(self, monkeypatch):
        from services import spec_page_html as sph

        def boom(pg, prev, instr, **kw):
            raise RuntimeError("炸了")

        monkeypatch.setattr(
            sph, "generate_page_html", lambda pg, spec, **kw: {"html": "<html>重画</html>"}
        )
        monkeypatch.setattr(sph, "edit_page_html", boom)
        out = sph.generate_pages_parallel(
            self.SPEC, edit_base={"p1": self.OK_HTML}, edit_instruction="改点东西"
        )
        assert out["pages"]["p1"] == "<html>重画</html>"

    def test_没有基线时不走局部改(self, monkeypatch):
        """反向判据：新建应用没有上一版，不该有人去试局部改。"""
        from services import spec_page_html as sph

        monkeypatch.setattr(
            sph, "generate_page_html", lambda pg, spec, **kw: {"html": "<html>重画</html>"}
        )
        monkeypatch.setattr(
            sph, "edit_page_html",
            lambda *a, **k: (_ for _ in ()).throw(AssertionError("不该走局部改")),
        )
        out = sph.generate_pages_parallel(self.SPEC)
        assert out["pages"]["p1"] == "<html>重画</html>"


class Test端到端接线_基线要落到第3步:
    """★ 变异实测暴露的缺口（2026-08-17）：上面那些判据全绿，而把管道里
    `edit_base=...` 改成 `{}` 照样全绿——因为它们只测到 generate_pages_parallel
    这一层，没验证**run_spec_first 有没有把基线交下来**。

    这就是"函数写对了 ≠ 它被调用了"。今天已经在 set_refine_context 上栽过
    一次（两个调用点只改了一个），不能再栽第二次。
    """

    SPEC = {
        "rootNodeId": "n0", "version": 3, "appName": "维保云",
        "personas": [{"id": "u1", "name": "维修主管", "goals": ["派工"]}],
        "successCriteria": [{"id": "sc1", "text": "24 小时内派工"}],
        "nodes": [], "pages": [{"id": "p1", "name": "工单页"}],
    }

    def _drive(self, monkeypatch, *, refine, reuse_pages):
        import services.html_bindings as hb
        import services.html_structure as hs
        import services.model_assembly as ma
        import services.page_shell as ps
        import services.refine_page_scope as rps
        import services.spec_page_html as sph
        import services.spec_semantics as ss
        import services.spec_tree as spec_tree
        from services import spec_first_pipeline as sfp

        seen = {}
        monkeypatch.setattr(spec_tree, "generate_spec_tree", lambda g, **kw: dict(self.SPEC))
        # 作用域判定：点名 p1，于是 p1 不在照搬清单里，会走"生成"这条路
        monkeypatch.setattr(rps, "decide_pages_to_regenerate", lambda i, p, **kw: ["p1"])

        def fake_pages(spec, **kw):
            seen["edit_base"] = kw.get("edit_base")
            seen["edit_instruction"] = kw.get("edit_instruction")
            return {"pages": {"p1": "<html>x</html>"}, "failed": {}}

        monkeypatch.setattr(sph, "generate_pages_parallel", fake_pages)
        monkeypatch.setattr(ps, "unify_shell", lambda p, s, **kw: {"pages": dict(p)})
        monkeypatch.setattr(ps, "check_shell_consistency", lambda *a, **kw: [])
        monkeypatch.setattr(ps, "repair_pages_after_bind", lambda p, b, **kw: (dict(p), [], []))
        monkeypatch.setattr(hs, "derive_structure", lambda p, **kw: {"entities": [], "pages": []})
        monkeypatch.setattr(ss, "derive_semantics", lambda st, sp, **kw: {"roles": []})
        monkeypatch.setattr(
            ma, "assemble", lambda *a, **k: {"model": {"datamodel": {}}, "gate": {"passed": True}}
        )
        monkeypatch.setattr(hb, "bind_pages", lambda p, m, **kw: {"pages": dict(p), "failed": {}})

        sfp.run_spec_first(
            "做个工单系统",
            refine=({"instruction": "菜单栏图标换一个", "modelDigest": "d"} if refine else None),
            reuse_pages=reuse_pages,
        )
        return seen

    def test_精修时基线与指令都落到第3步(self, monkeypatch):
        prev = {"p1": "<html>旧的</html>"}
        seen = self._drive(monkeypatch, refine=True, reuse_pages=prev)
        assert seen["edit_base"] == prev, (
            "基线没交到第 3 步——局部改在生产路径上等于没有，而且完全静默"
        )
        assert seen["edit_instruction"] == "菜单栏图标换一个", (
            "指令没交下来，模型不知道要改什么"
        )

    def test_非精修轮不给基线也不给指令(self, monkeypatch):
        """反向判据：新建应用没有上一版，给了会让它去试局部改。"""
        seen = self._drive(monkeypatch, refine=False, reuse_pages={"p1": "<html>旧的</html>"})
        assert not seen["edit_base"]
        assert not seen["edit_instruction"]
