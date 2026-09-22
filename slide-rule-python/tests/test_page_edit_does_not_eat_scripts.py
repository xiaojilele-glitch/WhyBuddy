# -*- coding: utf-8 -*-
"""点选编辑存一次，不许顺手把页面里的东西带走（2026-09-05 真机）。

## 事故

`PATCH /apps/{id}/pages/{pid}` 此前只查四件事：应用在不在、html 空不空、
超不超字节上限、这一页存不存在。**内容一个字都不看。**

而客户端存回来的那份，是把「消过毒的 body」拼回文档——消毒器的
`FORBID_TAGS` 里有 `script`（那是给**展示**用的：舞台不跑页面脚本，页面是
数据绑定驱动的木偶）。于是：

    真机 sr-20260904232526（汉字连线消除小游戏）
    三页各带 2~3 个内联 <script>，最多 880 字符，整局逻辑全在里面
    用户改一个标题 → 存完游戏变成一张死图
    接口返回 {"ok": true, "bytes": 12345}

客户端那一侧已经修了（ClickEditStage.preservedScripts）。这份判据钉的是
**服务端那道闸**——点选编辑不是唯一会 PATCH 这个接口的路（画布、脚本、
以后的别的客户端都会），"一次无关的编辑把交付物里的东西悄悄带走"这件事，
不该靠每个客户端各自记得。
"""

import pytest

from services.page_edit_guard import edit_losses, losses_message

# 真机那一页的形状（截短）
GAME_BEFORE = (
    '<!DOCTYPE html><html><head><title>限时消除对战台</title>'
    '<script>window.__CFG={grid:8};</script></head>'
    '<body><h1 data-field="page.title">限时消除对战台</h1>'
    '<div id="board" data-rows="cell"></div><input name="nick">'
    '<script>function tick(){}</script></body></html>'
)
# 消毒器吃掉 script 之后存回来的那份
GAME_AFTER_EATEN = (
    '<!DOCTYPE html><html><head><title>限时消除对战台</title></head>'
    '<body><h1 data-field="page.title">限时消除对战台（改过）</h1>'
    '<div id="board" data-rows="cell"></div><input name="nick"></body></html>'
)


class Test带走了什么要说出来:
    def test_事故本体_脚本被吃掉要报出来(self):
        """★ 这条红 = 又变回「改个标题把游戏存没了还说 ok」。"""
        losses = edit_losses(GAME_BEFORE, GAME_AFTER_EATEN)
        kinds = {x["kind"] for x in losses}
        assert "scripts" in kinds, f"脚本从 2 个变 0 个，体检一声没吭：{losses}"
        one = next(x for x in losses if x["kind"] == "scripts")
        assert (one["before"], one["after"], one["lost"]) == (2, 0, 2)

    def test_说的是人话_而且不甩锅给用户(self):
        """★ 措辞要紧：脚本被吃掉**不是用户删的**，是编辑器的问题。
        写成"你删了东西"会让人去找自己哪一步点错了。"""
        msg = losses_message(edit_losses(GAME_BEFORE, GAME_AFTER_EATEN))
        assert "页面脚本 2→0" in msg
        assert "不是你删的" in msg

    def test_数据孔少了也要报(self):
        """打孔那一步的产物被编辑器吃掉，页面就不再显示真数据——
        跟脚本同一类「闸绿但东西没了」。"""
        after = GAME_BEFORE.replace(' data-field="page.title"', "").replace(' data-rows="cell"', "")
        kinds = {x["kind"] for x in edit_losses(GAME_BEFORE, after)}
        assert "dataHoles" in kinds

    def test_表单控件少了也要报(self):
        after = GAME_BEFORE.replace('<input name="nick">', "")
        kinds = {x["kind"] for x in edit_losses(GAME_BEFORE, after)}
        assert "controls" in kinds


class Test别见谁都报:
    def test_只改文字不报(self):
        after = GAME_BEFORE.replace("限时消除对战台</h1>", "限时消除对战台（改过）</h1>")
        assert edit_losses(GAME_BEFORE, after) == []

    def test_加东西不报(self):
        """★ 反向配对：编辑的常态就是加东西，报了会被人关掉。"""
        after = GAME_BEFORE.replace("</body>", '<script>function extra(){}</script><input name="b"></body>')
        assert edit_losses(GAME_BEFORE, after) == []

    def test_原样存回不报(self):
        assert edit_losses(GAME_BEFORE, GAME_BEFORE) == []
        assert losses_message([]) == ""

    def test_体检自己不许炸(self):
        for bad in (None, "", "<not a doc", "<html>"):
            assert isinstance(edit_losses(bad, bad), list)


class Test接在真链路上:
    """§1：光有函数不算数，得证明**保存那条路**真的调了它、而且取对了页面。"""

    def test_保存路由里真的调了体检(self):
        import ast
        import inspect

        from routes import sliderule_full as r

        fn = None
        for node in ast.walk(ast.parse(inspect.getsource(r))):
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "patch_generated_app_page":
                fn = node
        assert fn is not None, "保存路由改名了——判据跟着失效"
        calls = {
            getattr(c.func, "id", getattr(c.func, "attr", None))
            for c in ast.walk(fn) if isinstance(c, ast.Call)
        }
        assert "edit_losses" in calls, "保存路由没做体检"
        assert "record_verdict" in calls or "_gate_record" in calls, "没记进闸的体检台账"

    def test_取的是pages下面那一层_不是外面那层(self):
        """★ 第一版就写错了一层：取 `pages_json[page_id]` 永远是空串，
        于是体检永远说「没损失」——**一道恒绿的闸比没有闸更糟**。
        （存的位置见 app_store.update_page_html：pages_json["pages"][page_id]）
        """
        import inspect

        from routes import sliderule_full as r

        src = inspect.getsource(r.patch_generated_app_page)
        assert '.get("pages")' in src, "没往 pages 里再取一层，读到的永远是空"

    def test_响应里如实带出来(self):
        """接口不许只说 ok——带走了什么要让调用方看得见。"""
        import inspect

        from routes import sliderule_full as r

        assert '"losses"' in inspect.getsource(r.patch_generated_app_page)

    def test_人话那句也一并带出来_不留给前端各自拼(self):
        """★ §4：措辞只该有一处。

        2026-09-05：第一版只回 `losses` 数组，前端要显提示就得自己拼一句。
        三个写回点（点选编辑保存 / 画布元素编辑 / 画布换图）各拼一遍，
        改口径时漏掉一处就是"只改一半"。所以人话由 `losses_message` 出。
        """
        import inspect

        from routes import sliderule_full as r

        src = inspect.getsource(r.patch_generated_app_page)
        assert '"lossesMessage"' in src, "响应没带人话那句，前端只能各拼各的"
        assert "losses_message(" in src, "人话不是 losses_message 出的——多出了第二套口径"

