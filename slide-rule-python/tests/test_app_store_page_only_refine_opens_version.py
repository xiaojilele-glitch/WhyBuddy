"""页面-only 精修必须开新版本，不许就地覆盖上一版的页面（2026-08-24）。

## 现场（用户真机报的第二个问题）

局部精修的常态是模型六段一字未变、只有页面 HTML 变了（加一列、改排序，
实体/角色/流程都没动）。落库入口 `save_app_or_version` 的路由只签模型：

    dedup_key = model_signature(session_id, model)   # 只哈希 model，不含 pages_json
    existing_same = backend.find_by_dedup_key(dedup_key)
    if existing_same is not None:
        return save_app(...)      # ← 幂等更新：**就地覆盖**，不产生新版本

模型没变 → 签名没变 → dedup 命中 → 走 `save_app` 的幂等更新分支——那条分支
`pages_json` 传了就直接覆盖既有记录（见 `save_app` 头注「幂等更新时没传就
保留既有，传了就用新的」）。后果两条，**都不报错**：

    · 卡片上的 v{N} 少数一次改版（用户只做了一次有效改动，货架却像没发生过）
    · 上一版的页面 HTML 被原地盖掉——**回不去了**，血缘里没有那一份，
      版本历史面板点「上一版」拿到的还是这一份

会话那一侧（`v5_full_driver.record_model_snapshot`）早就是对的口径：
「模型没变但页面变了，照常记版本」。这里补的是让落库跟会话侧同一个口径，
不是发明第三套规则——判据即抄这一句。

## 判据怎么写

不盯"有没有调 pages_payload_differs"（换个名字就红、调用点删了却可能不红）。
盯**跑完 save_app_or_version 之后版本链条数对不对、每一版的页面内容对不对**：
这是用户在版本历史面板里真正看到的东西。

变异验证（写完必做，纪律二）：把 `save_app_or_version` 里那句
`pages_payload_differs(...)` 判定去掉、恢复成"dedup 命中就直接幂等更新"，
下面两条核心用例必红。

## 已知让步

`pages_payload_differs` 拿来比较的是**货架上当前最新版**（prior），不是
dedup 命中的那条记录——理由写在 `save_app_or_version` 的行内注释里。这条
选择只在"同会话把模型内容改回历史某一版、dedup 命中的不是最新版"这种罕见
情形下才有分别，构造一个干净、不脆的单测代价较高，没有写进这个文件；
真正会天天发生的路径（页面-only 精修、模型-only 精修、纯重存）都覆盖到了。
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


def _model(n: int = 1) -> dict:
    """六段模型骨架——`_model(1)` 与 `_model(1)` 内容恒相同（同签名）。"""
    return {
        "datamodel": {"entities": [{"id": f"e{n}", "name": f"实体{n}", "fields": []}]},
        "appbundle": {"appIdentity": {"productName": f"应用{n}"}},
    }


def _pages(*ids: str) -> dict:
    return {
        "pages": {pid: f"<html>{pid}-内容</html>" for pid in ids},
        "navItems": [{"id": pid, "name": pid} for pid in ids],
    }


class Test模型不变页面变了必须开新版本:
    """★ 这就是用户报的那个 bug。"""

    def test_页面变了_版本链必须有两条(self, store):
        v1_pages = _pages("p1", "p2")
        v2_pages = {"pages": {"p1": "<html>p1-内容</html>", "p2": "<html>p2-改过了</html>"},
                    "navItems": v1_pages["navItems"]}

        first = app_store.save_app_or_version(
            _model(1), goal="g", session_id="s1", pages_json=v1_pages
        )
        second = app_store.save_app_or_version(
            _model(1), goal="g", session_id="s1", pages_json=v2_pages
        )

        assert first != second, "模型没变、页面变了，却复用了同一个 id——就地覆盖回来了"
        rec1, rec2 = app_store.get_app(first), app_store.get_app(second)
        assert rec2["root_id"] == rec1["root_id"] == rec1["id"], "应该是同一条血缘的新版本"
        assert rec2["parent_id"] == first
        assert (rec1["version"], rec2["version"]) == (1, 2), "版本号必须递增"

        chain = app_store.list_versions(rec1["root_id"])
        assert [v["version"] for v in chain] == [1, 2], "版本链只有 1 条——少数了一次改版"

    def test_旧版本的页面必须原样留在血缘里_不许被就地覆盖(self, store):
        """★★ 这条才是"回不去了"的直接判据：拿 v1 的记录出来，页面必须还是
        改动之前那份，不能因为落了 v2 就跟着变。"""
        v1_pages = _pages("p1", "p2")
        v2_pages = {"pages": {"p1": "<html>p1-内容</html>", "p2": "<html>p2-改过了</html>"},
                    "navItems": v1_pages["navItems"]}

        first = app_store.save_app_or_version(
            _model(1), goal="g", session_id="s1", pages_json=v1_pages
        )
        app_store.save_app_or_version(
            _model(1), goal="g", session_id="s1", pages_json=v2_pages
        )

        rec1_after = app_store.get_app(first)
        assert rec1_after["pages_json"]["pages"]["p2"] == "<html>p2-内容</html>", (
            "v1 的页面被 v2 的内容就地覆盖了——用户在版本历史里点「上一版」，"
            "拿到的还是改过的那份，回不去了"
        )

    def test_新版本必须带上新页面_不是旧页面(self, store):
        v1_pages = _pages("p1", "p2")
        v2_pages = {"pages": {"p1": "<html>p1-内容</html>", "p2": "<html>p2-改过了</html>"},
                    "navItems": v1_pages["navItems"]}
        app_store.save_app_or_version(_model(1), goal="g", session_id="s1", pages_json=v1_pages)
        second = app_store.save_app_or_version(
            _model(1), goal="g", session_id="s1", pages_json=v2_pages
        )
        rec2 = app_store.get_app(second)
        assert rec2["pages_json"]["pages"]["p2"] == "<html>p2-改过了</html>"


class Test反向不许过度触发:
    """新版本必须只在**真的**有新东西时才开——不许把"没变"也判成"变了"，
    那会让每次重存都凭空长出一版（比原来的覆盖更糟，画廊全是空壳改版）。
    """

    def test_模型和页面都没变_仍然幂等(self, store):
        pages = _pages("p1", "p2")
        first = app_store.save_app_or_version(
            _model(1), goal="g", session_id="s1", pages_json=pages
        )
        again = app_store.save_app_or_version(
            _model(1), goal="g", session_id="s1", pages_json=dict(pages)
        )
        assert again == first, "模型、页面都没变，却开了新版本"
        assert len(app_store.list_apps()) == 1
        assert app_store.get_app(first)["version"] == 1

    def test_模型不变_这次调用没带页面_仍然幂等(self, store):
        """这条路上大部分调用根本不带页面（重开夹具、纯模型轮、fork、回落
        老链路）。没带 ≠ 页面变了，否则每次这类调用都会凭空长出一版。"""
        pages = _pages("p1", "p2")
        first = app_store.save_app_or_version(
            _model(1), goal="g", session_id="s1", pages_json=pages
        )
        again = app_store.save_app_or_version(
            _model(1), goal="g", session_id="s1", pages_json=None
        )
        assert again == first, "没带页面的重存被误判成「页面变了」，凭空多了一版"
        assert app_store.get_app(first)["version"] == 1
        # 且原有页面没被抹掉（幂等更新按"没传保留既有"）
        assert app_store.get_app(first)["pages_json"]["pages"]["p1"] == "<html>p1-内容</html>"

    def test_模型真的变了_仍然照旧开新版本(self, store):
        """回归守卫：这次修复只加了一条"页面也算数"的判据，不能反过来削弱
        原有的"模型变了就开新版本"那条路。"""
        first = app_store.save_app_or_version(_model(1), goal="g", session_id="s1")
        second = app_store.save_app_or_version(_model(2), goal="g", session_id="s1")
        assert first != second
        assert app_store.get_app(second)["version"] == 2


class Test纯函数pages_payload_differs:
    def test_都没有页面(self):
        assert app_store.pages_payload_differs(None, None) is False

    def test_旧的没有_新的有(self):
        assert app_store.pages_payload_differs(None, {"pages": {"p1": "x"}}) is True

    def test_旧的有_新的没带(self):
        assert app_store.pages_payload_differs({"pages": {"p1": "x"}}, None) is False

    def test_都有且相同(self):
        p = {"pages": {"p1": "x"}}
        assert app_store.pages_payload_differs(p, dict(p)) is False

    def test_都有但不同(self):
        assert app_store.pages_payload_differs(
            {"pages": {"p1": "x"}}, {"pages": {"p1": "y"}}
        ) is True

    def test_新的页面是空字典_不算变了(self):
        """空页面包不该触发开新版本——那不是"新东西"，是没画出页面。"""
        assert app_store.pages_payload_differs(
            {"pages": {"p1": "x"}}, {"pages": {}}
        ) is False
