"""页型必填字段是**老渲染器契约**，只对老链路生效（2026-08-14）。

## 真机形状

口腔连锁那轮，spec-first 第 6 步过不了闸：

    汇合后过不了闸（重问 2 次后）：
    page.pages[postoperative_followup].dateField：
      page kind 'calendar' requires 'dateField' (a date field of this page's entity)

模型把「术后随访」定成 calendar 页却没给 dateField，重问 2 次未补，整条回落老路。

## 为什么这条规则对新链路不成立

kanban 要 statusField、calendar 要 dateField，存在的理由是 **AppRuntimeScreen
渲染看板/日历时得知道按哪个字段分列、按哪个字段排期**——它们是区块渲染器的
输入需求，不是模型自身的完整性。

而新链路的交付物是第 3 步那份 HTML，页面长什么样由 HTML 决定：

  · 全仓 `dateField` **没有一个新链路消费者**（前端精确匹配只命中类型声明、
    老渲染器用例与 demo 模板）
  · html-binding-runtime / derive-binding-source **压根不读 page.pages[].kind**

拿一个没人会用的字段拦住整条链路，代价是回落老路。

## ⚠ 只松「必须存在」，不松「存在就得对」

这是本文件最要紧的一条。字段给了就必须指到本页实体的对应类型字段——
放行悬空引用是另一个病。反向用例专门钉这一半：**把整个 _check_view_binding
关掉也能让正向变绿**，那才是真正危险的改法。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.v5_model_gate import validate_five_system_model  # noqa: E402


def _model(*, date_field=None, bad_date_field=None):
    """一个最小的过闸模型，page kind = calendar。"""
    page = {
        "id": "followup", "name": "术后随访", "kind": "calendar",
        "entityRef": "visit", "fieldBindings": [], "actionPermissions": [],
    }
    if date_field:
        page["dateField"] = date_field
    if bad_date_field:
        page["dateField"] = bad_date_field
    return {
        "datamodel": {"entities": [{
            "id": "visit", "name": "复诊", "fields": [
                {"id": "scheduled_at", "name": "预约时间", "type": "date"},
                {"id": "note", "name": "备注", "type": "string"},
            ]}]},
        "rbac": {"roles": ["doctor"], "permissions": ["visit:read"]},
        "workflow": {"nodes": [{"id": "n1", "name": "待复诊"}], "transitions": []},
        "page": {"pages": [page]},
        "aigc": {"capabilities": [{"id": "c1", "name": "随访提醒"}]},
        "appbundle": {"landingPageRef": "followup", "preferredDevice": "desktop",
                      "pageBindings": [], "invariants": []},
    }


def _paths(res):
    return {f["path"] for f in res["findings"]}


class Test老链路照旧被拦:
    def test_calendar_缺_dateField_默认仍然拦(self):
        """默认 True = 老行为。老渲染器还在应用中心用着，这条不能松。"""
        res = validate_five_system_model(_model(), require_page_kind_contract=True)
        assert "page.pages[followup].dateField" in _paths(res)

    def test_默认值就是老行为(self):
        """⚠ 不传这个参数时必须仍然拦——存量调用方（脚本/夹具/老快照）
        一个都没改，默认值一旦翻了它们会静默放行。"""
        res = validate_five_system_model(_model())
        assert "page.pages[followup].dateField" in _paths(res)


class Test新链路不再被拦:
    def test_calendar_缺_dateField_放行(self):
        """★ 口腔连锁那轮挂的就是这一条。"""
        res = validate_five_system_model(_model(), require_page_kind_contract=False)
        assert "page.pages[followup].dateField" not in _paths(res), (
            f"新链路仍被页型契约拦下：{_paths(res)}"
        )


class Test只松必须存在_不松存在就得对:
    """⚠ **本文件最要紧的一组**。

    把整个 _check_view_binding 关掉也能让上面那条变绿，而那会放行悬空引用——
    比原来的问题严重得多。所以字段一旦给出，解析与类型校验对两条链路
    一视同仁。
    """

    @pytest.mark.parametrize("contract", [True, False])
    def test_指到不存在的字段_两条链路都拦(self, contract):
        res = validate_five_system_model(
            _model(bad_date_field="visit.nope"), require_page_kind_contract=contract
        )
        assert "page.pages[followup].dateField" in _paths(res), (
            f"contract={contract} 时放行了悬空引用 —— 松过头了"
        )

    @pytest.mark.parametrize("contract", [True, False])
    def test_类型不对_两条链路都拦(self, contract):
        """给了个 string 字段当日期用。"""
        res = validate_five_system_model(
            _model(bad_date_field="visit.note"), require_page_kind_contract=contract
        )
        assert "page.pages[followup].dateField" in _paths(res), (
            f"contract={contract} 时放行了类型错误的绑定"
        )

    @pytest.mark.parametrize("contract", [True, False])
    def test_给对了_两条链路都放行(self, contract):
        res = validate_five_system_model(
            _model(date_field="visit.scheduled_at"), require_page_kind_contract=contract
        )
        assert "page.pages[followup].dateField" not in _paths(res)
