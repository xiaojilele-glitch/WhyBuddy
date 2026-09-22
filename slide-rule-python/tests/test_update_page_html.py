"""点选编辑器手动存页面 HTML（2026-08-24）：原地覆盖，不开新版本，不碰模型。

跟 `save_app_or_version` 那条版本纪律是两回事——那条治的是"AI 精修产出了
新东西却被误判成没变"；这里是用户在画布里点了保存，明确的单次手动动作，
按定义就该原地覆盖，不在这次修复的范围里去纠结。判据反过来盯这条边界：
**不许**误开新版本、**不许**动到 model_json 或其它页面。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import app_store


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(app_store.settings, "APP_STORE_DATABASE_URL", None)
    monkeypatch.setattr(app_store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(
        app_store.settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'local.db'}"
    )
    app_store.reset_backend_cache()
    yield
    app_store.reset_backend_cache()


def _model():
    return {
        "datamodel": {"entities": [{"id": "e1", "name": "实体1", "fields": []}]},
        "page": {"pages": [{"id": "p1", "kind": "workbench"}, {"id": "p2", "kind": "monitor"}]},
        "appbundle": {"landingPageRef": "p1", "appIdentity": {"productName": "测试应用"}},
    }


def _pages():
    return {"pages": {"p1": "<html>p1 原文</html>", "p2": "<html>p2 原文</html>"},
            "navItems": [{"id": "p1", "name": "页1"}, {"id": "p2", "name": "页2"}]}


class Test点选编辑保存:
    def test_改一页_内容真的换了(self, store):
        app_id = app_store.save_app(
            _model(), goal="g", session_id="s1", pages_json=_pages()
        )
        app_store.update_page_html(app_id, "p1", "<html>p1 改过了</html>")
        rec = app_store.get_app(app_id)
        assert rec["pages_json"]["pages"]["p1"] == "<html>p1 改过了</html>"

    def test_只改这一页_别的页面原样不动(self, store):
        app_id = app_store.save_app(
            _model(), goal="g", session_id="s1", pages_json=_pages()
        )
        app_store.update_page_html(app_id, "p1", "<html>p1 改过了</html>")
        rec = app_store.get_app(app_id)
        assert rec["pages_json"]["pages"]["p2"] == "<html>p2 原文</html>"
        assert rec["pages_json"]["navItems"] == _pages()["navItems"], "navItems 不该被这条路径动"

    def test_不开新版本_原地覆盖(self, store):
        """★ 这条就是跟 save_app_or_version 那条纪律的分界线。"""
        app_id = app_store.save_app(
            _model(), goal="g", session_id="s1", pages_json=_pages()
        )
        before = app_store.get_app(app_id)
        app_store.update_page_html(app_id, "p1", "<html>p1 改过了</html>")
        after = app_store.get_app(app_id)
        assert after["id"] == before["id"] == app_id
        assert after["version"] == before["version"] == 1
        assert len(app_store.list_apps()) == 1, "不该凭空多出一张卡"

    def test_不碰model_json(self, store):
        app_id = app_store.save_app(
            _model(), goal="g", session_id="s1", pages_json=_pages()
        )
        before_model = app_store.get_app(app_id)["model_json"]
        app_store.update_page_html(app_id, "p1", "<html>p1 改过了</html>")
        after_model = app_store.get_app(app_id)["model_json"]
        assert after_model == before_model

    def test_归属可见性不受影响(self, store):
        app_id = app_store.save_app(
            _model(), goal="g", session_id="s1", pages_json=_pages(),
            owner_id="u1", visibility="private",
        )
        app_store.update_page_html(app_id, "p1", "<html>p1 改过了</html>")
        rec = app_store.get_app(app_id)
        assert rec["owner_id"] == "u1" and rec["visibility"] == "private"


class Test反向不许乱来:
    def test_没有pages_json的应用_拒绝(self, store):
        """老应用/纯模型轮没有页面产物——这条路径不该凭空造一份出来。"""
        app_id = app_store.save_app(_model(), goal="g", session_id="s1")  # 不传 pages_json
        with pytest.raises(ValueError, match="no_pages"):
            app_store.update_page_html(app_id, "p1", "<html>x</html>")

    def test_不存在的页面id_拒绝(self, store):
        """不许这条窄接口凭空造出一个模型里没有的页面 id——那会破坏
        「页面包的键 == 模型页面 id」这条不变式（page_id_freeze.pages_match_model）。"""
        app_id = app_store.save_app(
            _model(), goal="g", session_id="s1", pages_json=_pages()
        )
        with pytest.raises(ValueError, match="page_not_found"):
            app_store.update_page_html(app_id, "p99_不存在", "<html>x</html>")
        # 反向确认：没有因为这次失败尝试而把 p99 悄悄塞进去
        rec = app_store.get_app(app_id)
        assert "p99_不存在" not in rec["pages_json"]["pages"]

    def test_应用不存在_返回none(self, store):
        assert app_store.update_page_html("从来没有过的id", "p1", "<html>x</html>") is None
