"""Contract tests for POST /api/sliderule/apps/{app_id}/pages/{page_id}/ai-edit-element
（点选编辑器"✨ AI 编辑"按钮）。

语义锁点：
  1. **不落库**——这条接口本身没有副作用，成功/失败都不该改动 pages_json
     或 model_json（真正落库走的是 PATCH /apps/{id}/pages/{pageId}，那条
     已有 test_update_page_html.py 钉着）；
  2. 诚实边界与 aigc-pipeline-tryrun 同口径：flag 关 → 503，不伪造输出；
  3. 权限跟点选编辑保存那条同一把锁（app_access "revise"）——没登录 401，
     不是自己的应用 403；
  4. markdown 代码块要剥掉（LLM 有时候管不住自己包一层 ```html```）；
  5. LLM 报错/回空内容都要如实报给前端，不能吞成"看起来是空字符串"。
"""

import os
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import routes.sliderule_full as sliderule_full  # noqa: E402
import services.app_store as store  # noqa: E402
from middlewares.current_user import optional_user  # noqa: E402
from sliderule_llm.client import LlmError, LlmResult  # noqa: E402

_OWNER_ID = "ai-edit-owner"
_OTHER_ID = "ai-edit-other"


class _Viewer:
    def __init__(self, uid, is_superuser=False):
        self.id = uid
        self.is_superuser = is_superuser


def _model():
    return {
        "datamodel": {"entities": [{"id": "e1", "name": "实体1", "fields": []}]},
        "page": {"pages": [{"id": "p1", "kind": "workbench"}]},
        "appbundle": {"landingPageRef": "p1", "appIdentity": {"productName": "测试应用"}},
    }


def _pages():
    return {
        "pages": {"p1": "<html><body><h1 data-field=\"title\">原标题</h1></body></html>"},
        "navItems": [{"id": "p1", "name": "页1"}],
    }


@pytest.fixture()
def configured_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", None)
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'local.db'}")
    store.reset_backend_cache()
    yield
    store.reset_backend_cache()


@pytest.fixture()
def app_id(configured_store):
    return store.save_app(
        _model(), goal="g", session_id="s1", pages_json=_pages(),
        owner_id=_OWNER_ID, visibility="private",
    )


@pytest.fixture()
def public_app_id(configured_store):
    """公开应用：READ 对谁都放行，只有 WRITE（这条接口要的）会被挡——
    用它才能区分 401（没登录）和 403（登录了但不是我的），私有应用两种
    情况都会被 app_access 提前判成 404（看不见的资源不暴露存在性，见
    app_access.require 头注），测不出 401/403 的差异。"""
    return store.save_app(
        _model(), goal="g", session_id="s2", pages_json=_pages(),
        owner_id=_OWNER_ID, visibility="public",
    )


def _client_as(viewer):
    app = FastAPI()
    app.include_router(sliderule_full.router, prefix="/api/sliderule")
    app.dependency_overrides[optional_user] = lambda: viewer
    return TestClient(app)


def _url(aid, page_id="p1"):
    return f"/api/sliderule/apps/{aid}/pages/{page_id}/ai-edit-element"


PAYLOAD = {"elementHtml": '<h1 data-field="title">原标题</h1>', "instruction": "改得更醒目一点"}


def test_flag_off_returns_503(app_id, monkeypatch):
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    client = _client_as(_Viewer(_OWNER_ID))
    res = client.post(_url(app_id), json=PAYLOAD)
    assert res.status_code == 503


def test_no_viewer_is_401(public_app_id, monkeypatch):
    """公开应用（能看见，READ 放行），没登录就动不了——401。"""
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "true")
    app = FastAPI()
    app.include_router(sliderule_full.router, prefix="/api/sliderule")
    app.dependency_overrides[optional_user] = lambda: None
    client = TestClient(app)
    res = client.post(_url(public_app_id), json=PAYLOAD)
    assert res.status_code == 401


def test_not_owner_is_403(public_app_id, monkeypatch):
    """公开应用，登录了但不是主人——跟点选编辑保存同一把锁，不能绕过去改内容。"""
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "true")
    client = _client_as(_Viewer(_OTHER_ID))
    res = client.post(_url(public_app_id), json=PAYLOAD)
    assert res.status_code == 403


def test_private_app_hides_existence_from_non_owner(app_id, monkeypatch):
    """私有应用对非主人是 404，不是 401/403——不能靠状态码探出"这个 id 存在"。"""
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "true")
    client = _client_as(_Viewer(_OTHER_ID))
    res = client.post(_url(app_id), json=PAYLOAD)
    assert res.status_code == 404


def test_app_not_found_is_404(configured_store, monkeypatch):
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "true")
    client = _client_as(_Viewer(_OWNER_ID))
    res = client.post(_url("nonexistent-app-id"), json=PAYLOAD)
    assert res.status_code == 404


def test_empty_elementHtml_is_400(app_id, monkeypatch):
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "true")
    client = _client_as(_Viewer(_OWNER_ID))
    res = client.post(_url(app_id), json={**PAYLOAD, "elementHtml": "  "})
    assert res.status_code == 400


def test_empty_instruction_is_400(app_id, monkeypatch):
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "true")
    client = _client_as(_Viewer(_OWNER_ID))
    res = client.post(_url(app_id), json={**PAYLOAD, "instruction": ""})
    assert res.status_code == 400


def test_oversized_elementHtml_is_413(app_id, monkeypatch):
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "true")
    client = _client_as(_Viewer(_OWNER_ID))
    huge = "<div>" + ("x" * (90 * 1024)) + "</div>"
    res = client.post(_url(app_id), json={**PAYLOAD, "elementHtml": huge})
    assert res.status_code == 413


def test_success_strips_markdown_fence(app_id, monkeypatch):
    """LLM 有时候管不住自己包一层 ```html ... ``` ——后端要剥掉，不是错误。"""
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "true")
    monkeypatch.setenv("LLM_API_KEY", "test-key")

    def fake_call_llm(messages, **_kw):
        return LlmResult(
            content='```html\n<h1 data-field="title">更醒目的标题</h1>\n```',
            usage=None, finish_reason="stop", model="test", latency_ms=1,
        )

    monkeypatch.setattr("sliderule_llm.client.call_llm", fake_call_llm)
    client = _client_as(_Viewer(_OWNER_ID))
    res = client.post(_url(app_id), json=PAYLOAD)
    assert res.status_code == 200
    body = res.json()
    assert body["html"] == '<h1 data-field="title">更醒目的标题</h1>'
    assert "```" not in body["html"]


def test_llm_error_returns_502(app_id, monkeypatch):
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "true")
    monkeypatch.setenv("LLM_API_KEY", "test-key")

    def fake_call_llm(messages, **_kw):
        raise LlmError("rate limited")

    monkeypatch.setattr("sliderule_llm.client.call_llm", fake_call_llm)
    client = _client_as(_Viewer(_OWNER_ID))
    res = client.post(_url(app_id), json=PAYLOAD)
    assert res.status_code == 502


def test_empty_llm_content_returns_502(app_id, monkeypatch):
    """反向：LLM 回了个空字符串（或纯 markdown 围栏拆完是空）不能当成功处理。"""
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "true")
    monkeypatch.setenv("LLM_API_KEY", "test-key")

    def fake_call_llm(messages, **_kw):
        return LlmResult(content="```html\n\n```", usage=None, finish_reason="stop", model="test", latency_ms=1)

    monkeypatch.setattr("sliderule_llm.client.call_llm", fake_call_llm)
    client = _client_as(_Viewer(_OWNER_ID))
    res = client.post(_url(app_id), json=PAYLOAD)
    assert res.status_code == 502


def test_reverse_never_touches_storage(app_id, monkeypatch):
    """反向：这条接口本身没有副作用——不管成功还是失败，pages_json/model_json
    必须原样不动。真正落库是另一条 PATCH 接口的事，混在一起会让"AI 编辑"
    绕开"未保存可以放弃"这条纪律。"""
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "true")
    monkeypatch.setenv("LLM_API_KEY", "test-key")

    def fake_call_llm(messages, **_kw):
        return LlmResult(
            content='<h1 data-field="title">被 AI 改过的标题</h1>',
            usage=None, finish_reason="stop", model="test", latency_ms=1,
        )

    monkeypatch.setattr("sliderule_llm.client.call_llm", fake_call_llm)
    before = store.get_app(app_id)
    client = _client_as(_Viewer(_OWNER_ID))
    res = client.post(_url(app_id), json=PAYLOAD)
    assert res.status_code == 200
    after = store.get_app(app_id)
    assert after["pages_json"] == before["pages_json"], "AI 编辑不该动 pages_json——那是保存按钮的事"
    assert after["model_json"] == before["model_json"]
    assert after["version"] == before["version"]
