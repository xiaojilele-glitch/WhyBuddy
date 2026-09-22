"""第 6.5 步：给第 3 步的 HTML 打 data-* 绑定孔（2026-08-13）。

判据分三层，每层守一件不同的事：

  · check_bindings   每个孔都指到真东西，且 data-field 在所在列表的作用域内
  · check_coverage   整页至少有一个数据源 —— 守"一个孔都没打也能全绿"那个洞
  · 版式不许被毁     只加属性、不动 class 和文案
"""

from __future__ import annotations

from services.html_bindings import (
    ACTION_KINDS,
    build_prompt,
    check_bindings,
    check_coverage,
    scan_bindings,
)

MODEL = {
    "datamodel": {"entities": [
        {"id": "vehicle", "name": "车辆", "fields": [
            {"id": "plate", "name": "车牌", "type": "string"},
            {"id": "price", "name": "评估价", "type": "number"},
            {"id": "status", "name": "状态", "type": "enum"}]},
        {"id": "customer", "name": "客户", "fields": [
            {"id": "cust_name", "name": "姓名", "type": "string"}]},
    ]}
}

GOOD = """<!DOCTYPE html><html lang="zh-CN"><head>
<script src="https://cdn.tailwindcss.com"></script></head><body>
<main>
  <span data-value="vehicle" data-aggregate="count">1,234</span>
  <div data-chart="donut" data-entity="vehicle" data-dimension="status" data-metric="count"></div>
  <table><tbody data-rows="vehicle" data-sort="price" data-order="desc" data-limit="8">
    <tr>
      <td data-field="plate">京A·XXXXX</td>
      <td data-field="price">¥ ××,×××</td>
      <td><button data-action="openRecord" data-entity="vehicle">查看</button></td>
    </tr>
  </tbody></table>
  <button data-action="createRecord" data-entity="vehicle">新建收车</button>
</main></body></html>"""


def 失败原因(html: str) -> str:
    probs = check_bindings(html, MODEL) + check_coverage(html, MODEL)
    assert probs, "这份该被拦下来，却过了"
    return "｜".join(p["message"] for p in probs)


class Test合法件:
    def test_零问题(self):
        assert check_bindings(GOOD, MODEL) == []
        assert check_coverage(GOOD, MODEL) == []

    def test_扫得出全部绑定(self):
        kinds = {k for n in scan_bindings(GOOD) for k in n["attrs"]
                 if k in ("rows", "field", "value", "chart", "action")}
        assert kinds == {"rows", "field", "value", "chart", "action"}


class Test作用域_不只是存在性:
    """data-field 光"是个真字段"不够，必须是所在 data-rows 那个实体的字段。"""

    def test_拦_取了别的实体的字段(self):
        # cust_name 是真字段，但它属于 customer，而这一行是 vehicle
        bad = GOOD.replace('data-field="plate"', 'data-field="cust_name"')
        assert "不是 'vehicle' 的字段" in 失败原因(bad)

    def test_拦_data_field_写在列表外面(self):
        # ⚠ 断言钉**行为**不钉措辞（2026-08-15 改）：原来写的是
        #   `"没有「当前行」" in ...`，加了 data-record 之后话术改成
        #   「没有「当前这条」」，用例当场红——而行为一点没变。
        #   钉措辞的判据会在每次改文案时假红，久了就没人信它。
        bad = GOOD.replace("<main>", '<main><span data-field="plate">X</span>')
        msg = 失败原因(bad)
        assert "作用域外面" in msg or "当前" in msg
        assert "data-rows" in msg and "data-record" in msg, "报错要指出两种容器怎么选"

    def test_嵌套标签内也能算出作用域(self):
        nested = GOOD.replace(
            '<td data-field="plate">京A·XXXXX</td>',
            '<td><div><span data-field="plate">京A·XXXXX</span></div></td>')
        assert check_bindings(nested, MODEL) == []

    def test_闭合之后作用域要弹掉(self):
        after = GOOD.replace("</main>", '<span data-field="plate">跑到外面了</span></main>')
        msg = 失败原因(after)
        assert "作用域外面" in msg or "当前" in msg


class Test每个孔都要指到真东西:
    def test_拦_实体是编的(self):
        assert "不存在" in 失败原因(GOOD.replace('data-rows="vehicle"', 'data-rows="ghost"'))

    def test_拦_字段是编的(self):
        assert "不是" in 失败原因(GOOD.replace('data-field="price"', 'data-field="幻觉"'))

    def test_拦_聚合词不在表里(self):
        assert "聚合只能是" in 失败原因(GOOD.replace('data-aggregate="count"', 'data-aggregate="median"'))

    def test_拦_图表维度不是该实体的字段(self):
        assert "维度" in 失败原因(GOOD.replace('data-dimension="status"', 'data-dimension="cust_name"'))

    def test_拦_动作不在三种里(self):
        assert "动作只能是" in 失败原因(GOOD.replace('data-action="openRecord"', 'data-action="delete"'))

    def test_拦_动作没写实体(self):
        bad = GOOD.replace('<button data-action="createRecord" data-entity="vehicle">',
                           '<button data-action="createRecord">')
        assert "不知道操作哪张表" in 失败原因(bad)

    def test_拦_openRecord_写在列表外(self):
        bad = GOOD.replace('<button data-action="createRecord" data-entity="vehicle">新建收车</button>',
                           '<button data-action="openRecord" data-entity="vehicle">查看</button>')
        assert "当前这一行" in 失败原因(bad)

    def test_createRecord_可以在列表外(self):
        # 它不需要当前行，页头那个"新建"就用它
        assert check_bindings(GOOD, MODEL) == []

    def test_自由树不再手抄词表(self):
        """收拢后（2026-08-14 晚）ActionRef.kind 是 `str` + 查 ACTION_KINDS 校验，
        Python 侧词表只有 html_bindings 一份。这条 AST 看门从"抄词对比"改成
        "不许再出现手抄词"——行为面（词表词全过、词表外被拒且报出整张表）
        由 Test词表跨语言同步.test_自由树校验查的是同一份表 守着。

        ⚠ 走 AST 取，不 import：freeform_block 的 ActionRef 定义在函数内部
        （它的校验器要闭包 entities），import 不到。而拿字符串搜 "openRecord"
        又会命中注释和提示词正文——判据必须钉在**真实语句**上。
        """
        import ast
        import pathlib

        path = (pathlib.Path(__file__).resolve().parent.parent
                / "services" / "freeform_block.py")
        src = path.read_text(encoding="utf-8")
        kind_ann = None
        for node in ast.walk(ast.parse(src)):
            if not (isinstance(node, ast.ClassDef) and node.name == "ActionRef"):
                continue
            for stmt in node.body:
                if (isinstance(stmt, ast.AnnAssign)
                        and getattr(stmt.target, "id", None) == "kind"):
                    kind_ann = stmt.annotation
        assert kind_ann is not None, "freeform_block 里找不到 ActionRef.kind 了"
        literals = {
            s.value for s in ast.walk(kind_ann)
            if isinstance(s, ast.Constant) and isinstance(s.value, str)
        }
        assert literals == set(), f"ActionRef.kind 又出现手抄词了：{literals}——词表只有 html_bindings 一份"
        assert "from services.html_bindings import ACTION_KINDS" in src, (
            "freeform_block 不再查 html_bindings.ACTION_KINDS 了——校验去哪了？"
        )


class Test一个孔都没打也要被拦:
    """⚠ 守今天反复出现的那个形状：闸全绿、东西没做。

    一份没打孔的 HTML，check_bindings 返回**空列表**——没有绑定就没有错误的
    绑定，看起来完美通过。所以另立一条 check_coverage。
    """

    def test_没打孔时_check_bindings_是空的(self):
        plain = "<html><body><main><table><tr><td>写死的</td></tr></table></main></body></html>"
        assert check_bindings(plain, MODEL) == [], "这正是问题所在，不是笔误"

    def test_但_check_coverage_拦得住(self):
        plain = "<html><body><main><table><tr><td>写死的</td></tr></table></main></body></html>"
        assert "还是死的静态页" in 失败原因(plain)

    def test_只有_field_和_action_没有数据源也拦(self):
        没数据源 = ('<html><body><main><table><tr>'
                    '<td data-field="plate">X</td></tr></table></main></body></html>')
        assert "取不到数" in 失败原因(没数据源)


class Test提示词:
    def test_把实体字段全摊开_并禁止新造(self):
        user = build_prompt(GOOD, MODEL, "p1")[-1]["content"]
        assert "vehicle" in user and "plate" in user and "评估价" in user
        assert "一个都不许新造" in user

    def test_明说版式不许动(self):
        user = build_prompt(GOOD, MODEL, "p1")[-1]["content"]
        assert "不增删元素" in user and "不动 class" in user

    def test_把作用域那条写进去(self):
        """提示词必须讲清「字段属于开作用域的那个实体」，且两种容器都要出现。
        ⚠ 同样钉规则不钉原句——加 data-record 时这条为措辞红过一次。"""
        user = build_prompt(GOOD, MODEL, "p1")[-1]["content"]
        assert "data-rows" in user and "data-record" in user
        assert "别的表的字段" in user or "不是所在" in user or "必须属于" in user

    def test_挑不到就不绑_不要造(self):
        user = build_prompt(GOOD, MODEL, "p1")[-1]["content"]
        assert "不要造一个看着像的 id" in user

    def test_打孔不许剥hidden浮层(self):
        """绑定提示词写「不动 class」，打孔仍把 hidden 剥掉。要点名。"""
        user = build_prompt(GOOD, MODEL, "p1")[-1]["content"]
        assert "hidden" in user
        assert "不许剥" in user

    def test_行模板不是装饰层(self):
        """2026-08-31 会聚通：now-line 放成 data-rows 第一个子元素，
        运行时按实体数克隆红线。提示词必须把「那一行带着绑定孔」说清。"""
        user = build_prompt(GOOD, MODEL, "p1")[-1]["content"]
        assert "行模板" in user
        assert "data-field" in user and "data-cell" in user
        assert "第一个子元素" in user or "兄弟" in user

    def test_矩阵不许只留一行把日程复印(self):
        """2026-09-01 会席宝：提示词「只留一行」把另外七间的块删掉，
        运行时再按第一行复印。日历/排期/甘特都中。后台宽表仍只留一行。"""
        user = build_prompt(GOOD, MODEL, "p1")[-1]["content"]
        assert "甘特" in user
        assert "复印" in user
        assert "只留一行" in user
        assert "时间块" in user or "日程" in user

    def test_校验器原话回喂(self):
        user = build_prompt(GOOD, MODEL, "p1", "某某字段不是 vehicle 的字段")[-1]["content"]
        assert "某某字段不是 vehicle 的字段" in user and "只改这些地方" in user


# ── 转移动作（2026-08-14 晚：权限 + 工作流那两只手伸进 HTML 页） ────────────

#: MODEL 加上审批流。GOOD 的行内换一个「提交审批」按钮当合法件。
MODEL_WF = {
    **MODEL,
    "workflow": {
        "id": "wf_v",
        "nodes": [{"id": "n1", "name": "评估审核", "assigneeRole": "manager"}],
        "transitions": [],
    },
    "appbundle": {"pageBindings": [{"pageRef": "p1", "workflowRef": "wf_v"}]},
}

GOOD_WF = GOOD.replace(
    '<button data-action="openRecord" data-entity="vehicle">查看</button>',
    '<button data-action="submitWorkflow" data-entity="vehicle">提交审批</button>',
)


class Test转移动作:
    """三个转移词都要「当前这一行」，且模型必须真的声明了工作流。

    守的洞：没有流程的应用里打出「提交审批」按钮——点下去无处可去，
    而页面渲染、消毒、填数全程不会有一处报错（静默失效的形状）。
    """

    def test_合法件_行内提交_模型有工作流(self):
        assert check_bindings(GOOD_WF, MODEL_WF) == []

    def test_拦_模型没有工作流(self):
        assert "转移动作无处可去" in "｜".join(
            p["message"] for p in check_bindings(GOOD_WF, MODEL)
        )

    def test_拦_转移动作写在列表外(self):
        bad = GOOD_WF.replace(
            '<button data-action="createRecord" data-entity="vehicle">新建收车</button>',
            '<button data-action="approveWorkflow" data-entity="vehicle">通过</button>',
        )
        assert "当前这一行" in "｜".join(
            p["message"] for p in check_bindings(bad, MODEL_WF)
        )

    def test_提示词_有工作流才出现转移段(self):
        with_wf = build_prompt(GOOD, MODEL_WF, "p1")[-1]["content"]
        assert "submitWorkflow" in with_wf and "评估审核" in with_wf
        assert "这一页绑定了流程" in with_wf  # p1 在 pageBindings 里

        without = build_prompt(GOOD, MODEL, "p1")[-1]["content"]
        assert "submitWorkflow" not in without

    def test_提示词_没绑流程的页明说不要用(self):
        other_page = build_prompt(GOOD, MODEL_WF, "p9")[-1]["content"]
        assert "不要**使用" in other_page or "**不要**使用" in other_page


class Test词表跨语言同步:
    """词表**每种语言只有一份**（2026-08-14 晚收拢），这里是唯一的跨语言接缝。

    收拢前是四份（Python 两份、前端两份），靠两条 AST 测试抄词对比；
    收拢后 freeform_block 查这边的表、block-registry 引用前端的类型——
    语言内不再需要看门。剩下 Python ↔ TypeScript 这一条缝没法用 import 消掉
    （PostHog 那种方案是代码生成 + CI 新鲜度检查，对 6 个词是牛刀），
    所以留这一条正则钉死：钉在**真实源码**上（数组字面量），不 import 也不猜。
    """

    def _client(self, *parts: str) -> str:
        import pathlib

        root = pathlib.Path(__file__).resolve().parents[2] / "client"
        return (root.joinpath(*parts)).read_text(encoding="utf-8")

    def test_前端解释器词表一字不差(self):
        import re

        src = self._client("src", "pages", "sliderule", "live-runtime",
                           "html-binding-runtime.ts")

        def words(name: str) -> tuple[str, ...]:
            m = re.search(rf"export const {name} = \[(.*?)\] as const", src, re.S)
            assert m, f"前端 html-binding-runtime 里找不到 {name} 数组了"
            return tuple(re.findall(r'"([a-zA-Z]+)"', m.group(1)))

        # 两个子表逐词、按序对齐（顺序也算契约：前端类型联合的顺序从数组来）
        from services.html_bindings import RECORD_ACTION_KINDS, WORKFLOW_ACTION_KINDS

        assert words("RECORD_ACTION_KINDS") == RECORD_ACTION_KINDS, "记录词分叉"
        assert words("WORKFLOW_ACTION_KINDS") == WORKFLOW_ACTION_KINDS, "转移词分叉"
        from services.html_bindings import CART_ACTION_KINDS

        assert words("CART_ACTION_KINDS") == CART_ACTION_KINDS, "购物车词分叉"
        # 总表必须是组合，不许退化回第三份手抄——手抄的会跟子表悄悄错开
        assert re.search(
            r"export const ACTION_KINDS =\s*\[\s*\.\.\.RECORD_ACTION_KINDS,\s*\.\.\.WORKFLOW_ACTION_KINDS,\s*\.\.\.CART_ACTION_KINDS\s*\]\s*as const",
            src,
        ), "前端 ACTION_KINDS 不再是子表组合——别退回手抄总表"

    def test_前端自由树不再手抄词表(self):
        """block-registry 的 FreeformActionRef.kind 必须**引用** ActionKind 类型，
        而不是自己抄一份字符串联合——语言内的分叉靠引用消掉，不靠对比。"""
        import re

        src = self._client("src", "pages", "sliderule", "live-runtime",
                           "block-registry.tsx")
        m = re.search(r"export interface FreeformActionRef \{(.*?)\}", src, re.S)
        assert m, "block-registry 里找不到 FreeformActionRef 了"
        body = m.group(1)
        assert re.search(r"kind:\s*ActionKind;", body), (
            "FreeformActionRef.kind 不再引用 ActionKind——退回手抄联合了？"
        )
        assert '"createRecord"' not in body, "接口体里出现了手抄的词——词表又分叉了"
        assert re.search(
            r'import type \{[^}]*\bActionKind\b[^}]*\} from "\./html-binding-runtime"', src
        ), "block-registry 没有从 html-binding-runtime 引 ActionKind"

    def test_自由树校验查的是同一份表(self):
        """行为判据：freeform_block 不 import 也能对上——词表里的词全过校验，
        词表外的词被拒且错误信息把整张表报出来（模型看得见词表才知道能写什么）。"""
        import pytest as _pytest

        from services.freeform_block import build_freeform_models

        M = build_freeform_models({
            "entities": [
                {"id": "e", "name": "E",
                 "fields": [{"id": "f", "name": "F", "type": "string"}]},
            ]
        })
        rows = {
            "tag": "ul",
            "rowsRef": {"entityRef": "e", "fieldRefs": ["f"]},
            "children": [
                {"tag": "li", "children": [
                    {"tag": "span", "actionRef": {"kind": kind, "entityRef": "e"}}
                    for kind in ACTION_KINDS
                ]},
            ],
        }
        M.model_validate({"root": rows})  # 六个词都能过

        with _pytest.raises(Exception) as e:
            M.model_validate({"root": {
                "tag": "div", "actionRef": {"kind": "deleteRecord", "entityRef": "e"},
            }})
        for kind in ACTION_KINDS:
            assert kind in str(e.value), "拒词的错误信息应报出整张词表"


class Test批量打孔按完成顺序收结果:
    """⚠ 这一条对**总时长没有影响**——两种写法都要等全部完成。

    钉它是因为 spec_page_html 已经为同一行付过学费（那边注释记着实测：
    五页分散在 347/347/348/369/369s 好，按提交顺序 `fut.result()` 等，
    用户看到的却是"憋着不动、然后哗啦一下全出来"）。而这一步迟早要加
    「打好孔的页先亮起来」那种逐页回调，到那时按提交顺序会让所有回调堆到
    最后一起触发：**接线全通、判据全绿，效果被一行遍历顺序抵消掉。**

    2026-08-14 复核时这里还留着老写法，趁没人踩先起雷。
    """

    class _Resp:
        def __init__(self, content: str) -> None:
            self.content = content

    def _slow_first(self, delays: dict):
        """假 llm：按 page_id 卡不同时长，返回同一份合法产物。"""
        import time

        def llm_call(messages, **kw):
            blob = " ".join(m["content"] for m in messages)
            for pid, d in delays.items():
                # 提示词里带着 page_id（build_prompt 会写进去）
                if pid in blob:
                    time.sleep(d)
                    break
            return self._Resp(GOOD)

        return llm_call

    def test_快的页先落袋_不被慢页挡住(self):
        from services.html_bindings import bind_pages

        res = bind_pages(
            {"slowpage": GOOD, "fastpage": GOOD},
            MODEL,
            max_workers=2,
            llm_call=self._slow_first({"slowpage": 0.8}),
        )
        assert set(res["pages"]) == {"slowpage", "fastpage"}, "两页都该成功"
        # dict 保插入序：先落袋的排前面。按提交顺序取的话，slowpage 会排第一。
        assert list(res["pages"])[0] == "fastpage", (
            "结果是按提交顺序收的（慢页排在前面）—— "
            "改回 `for pid, fut in futures` 了？该用 as_completed"
        )

    def test_单页失败仍不拖垮整批(self):
        """顺序换了，这条老纪律不许跟着变。"""
        from services.html_bindings import bind_pages

        def llm_call(messages, **kw):
            blob = " ".join(m["content"] for m in messages)
            if "badpage" in blob:
                raise RuntimeError("用例注入：这一页挂了")
            return self._Resp(GOOD)

        res = bind_pages({"badpage": GOOD, "okpage": GOOD}, MODEL, llm_call=llm_call)
        assert list(res["pages"]) == ["okpage"]
        assert "badpage" in res["failed"]
