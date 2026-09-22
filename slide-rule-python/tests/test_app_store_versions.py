"""App Store 版本链激活哨兵（2026-07-27 审查修复 #3/D10）。

历史问题：闭环落库只调 save_app(dedup_key=会话+模型签名)——模型一变签名
就变 → miss → 每次精修都新建孤儿 root（v1），画廊堆同名重复卡；为改版
设计的 save_version 是全仓零调用的死代码，v2 徽标永不出现。

修复入口 save_app_or_version：模型未变幂等更新；同会话模型有变 → 同 root
新版本；新会话 → 新应用。
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
    # 本地 SQLite 兜底（2026-07-28 起在 JSON 之前）也必须指到 tmp_path：
    # 不指的话会落到默认的 data/sliderule-apps.db，用例之间互相看见对方的
    # 数据，幂等/版本这些断言会莫名其妙地红。
    monkeypatch.setattr(
        app_store.settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'local.db'}"
    )
    app_store.reset_backend_cache()
    yield
    app_store.reset_backend_cache()


def _model(n: int) -> dict:
    return {
        "datamodel": {"entities": [{"id": f"e{n}", "name": f"实体{n}", "fields": []}]},
        "appbundle": {"appIdentity": {"productName": f"应用{n}"}},
    }


def test_same_session_changed_model_becomes_new_version(store):
    first = app_store.save_app_or_version(_model(1), goal="g", session_id="s1")
    second = app_store.save_app_or_version(_model(2), goal="g", session_id="s1")
    assert first != second
    rec1, rec2 = app_store.get_app(first), app_store.get_app(second)
    assert rec2["root_id"] == rec1["root_id"] == rec1["id"]  # 同根
    assert rec2["parent_id"] == first
    assert (rec1["version"], rec2["version"]) == (1, 2)
    # 画廊每根只出最新版 → 一张卡,不再堆同名重复卡
    cards = app_store.list_apps()
    assert len(cards) == 1
    assert cards[0]["id"] == second and cards[0]["version"] == 2
    # 版本链可查
    chain = app_store.list_versions(rec1["root_id"])
    assert [v["version"] for v in chain] == [1, 2]


def test_unchanged_model_stays_idempotent(store):
    first = app_store.save_app_or_version(_model(1), goal="g", session_id="s1")
    again = app_store.save_app_or_version(_model(1), goal="g", session_id="s1")
    assert again == first
    assert len(app_store.list_apps()) == 1
    assert app_store.get_app(first)["version"] == 1


def test_different_sessions_stay_separate_apps(store):
    a = app_store.save_app_or_version(_model(1), goal="g", session_id="s1")
    b = app_store.save_app_or_version(_model(1), goal="g", session_id="s2")
    assert a != b
    assert app_store.get_app(a)["root_id"] != app_store.get_app(b)["root_id"]
    assert len(app_store.list_apps()) == 2


def test_latest_per_root_prefers_version_over_created_at(store):
    """#8：同 root 的"最新"以 version 为准——created_at 在幂等更新时可能保留
    旧值，单靠时间会把 v1 排到 v2 前面。"""
    first = app_store.save_app_or_version(_model(1), goal="g", session_id="s1")
    second = app_store.save_app_or_version(_model(2), goal="g", session_id="s1")
    backend = app_store.get_backend()
    # 人为把 v2 的时间改到 v1 之前（复现幂等更新保留旧时间的场景）
    rec2 = app_store.get_app(second)
    rec2_full = backend.get(second)
    rec2_full["created_at"] = "2000-01-01T00:00:00+00:00"
    backend.save(rec2_full)
    cards = app_store.list_apps()
    assert cards[0]["version"] == 2, "画廊必须展示 v2,不是时间更晚的 v1"


def test_fork_binds_session(store):
    src = app_store.save_app_or_version(_model(1), goal="g", session_id="s1")
    fid = app_store.fork_app(src, new_name="副本甲", session_id="fork-sess-1")
    rec = app_store.get_app(fid)
    assert rec["session_id"] == "fork-sess-1"
    assert rec["parent_id"] == src and rec["root_id"] == fid and rec["version"] == 1


# ─────────────────────────────────────────────────────────────────────────
# 迭代热路不许拖整条血缘（2026-08-22）
# ─────────────────────────────────────────────────────────────────────────


class Test精修落库只要一个数:
    """★ `save_version` 只需要知道「下一版是几」。

    此前它调 `versions(root_id)` 再 `max(...)`——而 Neon 后端那句是
    `select *`，把血缘上每一版的 model_json + pages_json 全拉过网关再丢掉。
    线上实测 5 版的血缘：整条 280 KB / 742ms；只取 max(version) 136ms。
    代价随版本数线性长，删卡那条路已经因为同一句 413 过一次（2026-08-21
    修的是 ids_for_root，没动 versions 本身）。

    撞上 413 的现象特别不好查：落库整段是 fail-open 的，异常被吞成一行
    "app store save skipped"——**用户精修完，应用没存**，界面上什么都不说。
    """

    def test_精修不再调versions(self, store, monkeypatch):
        first = app_store.save_app_or_version(_model(1), goal="g", session_id="s-hot")
        backend = app_store.get_backend()
        calls = {"versions": 0, "max_version": 0}
        real_versions = backend.versions
        real_max = backend.max_version
        monkeypatch.setattr(
            backend, "versions",
            lambda rid: (calls.__setitem__("versions", calls["versions"] + 1), real_versions(rid))[1],
        )
        monkeypatch.setattr(
            backend, "max_version",
            lambda rid: (calls.__setitem__("max_version", calls["max_version"] + 1), real_max(rid))[1],
        )
        second = app_store.save_app_or_version(_model(2), goal="g", session_id="s-hot")
        assert app_store.get_app(second)["version"] == 2  # 功能没退化
        assert calls["max_version"] >= 1, "没走 max_version —— 这条判据本身坏了"
        # ★ 反向：这才是这次改动的全部内容。把 max_version 换回
        #   `max(v['version'] for v in backend.versions(...))`，这条必红。
        assert calls["versions"] == 0, (
            f"精修落库仍然拖了整条血缘（versions 被调 {calls['versions']} 次）"
        )
        assert first != second

    def test_max_version_三个后端同一口径(self, store):
        backend = app_store.get_backend()
        assert backend.max_version("从来没有过的根") == 0  # 空血缘是 0，不是崩
        first = app_store.save_app_or_version(_model(1), goal="g", session_id="s-mv")
        root = app_store.get_app(first)["root_id"]
        assert backend.max_version(root) == 1
        app_store.save_app_or_version(_model(2), goal="g", session_id="s-mv")
        app_store.save_app_or_version(_model(3), goal="g", session_id="s-mv")
        assert backend.max_version(root) == 3
        # 跟 versions() 算出来的必须一致——两处分叉就会出现"v3 覆盖 v3"。
        assert backend.max_version(root) == max(
            int(v.get("version") or 0) for v in backend.versions(root)
        )

    def test_parent还在时连兜底那次versions都不查(self, store, monkeypatch):
        """归属继承从 parent 记录取。parent 在的正常链路上不该再查血缘。"""
        app_store.save_app_or_version(_model(1), goal="g", session_id="s-base")
        backend = app_store.get_backend()
        real_versions = backend.versions
        seen = []
        monkeypatch.setattr(
            backend, "versions", lambda rid: (seen.append(rid), real_versions(rid))[1]
        )
        app_store.save_app_or_version(_model(2), goal="g", session_id="s-base")
        assert seen == [], f"parent 在的情况下不该查 versions，实际查了 {seen}"


class Test网关后端不许select星:
    """★ Neon/HTTP 后端的每一句 `select *` 都是「整份 jsonb 过网」。

    list_apps_sql 头注里已经为这件事立过一次碑（2026-08-18 应用中心 3.5–5s），
    ids_for_root 为它修过一次 413（2026-08-21）。这条把范围扩到整个类：
    **除了明确需要整条记录的那两个方法**，谁都不许 `select *`。
    """

    #: 这两个必须拿整条记录：
    #:   get / find_by_dedup_key —— 调用方要 model_json（重开渲染、幂等更新）
    #:   find_latest_by_session  —— unbind_session 读出来改一个字段再 save 回去，
    #:                              少一列就等于把那一列清空
    _ALLOWED = {"get", "find_by_dedup_key", "find_latest_by_session", "export_all"}

    def test_只有需要整条记录的方法可以select星(self):
        import re
        import tokenize
        import io as _io
        import os as _os

        path = _os.path.join(_os.path.dirname(app_store.__file__), "app_store.py")
        with _io.open(path, "rb") as fh:
            toks = [t for t in tokenize.tokenize(fh.readline) if t.type != tokenize.COMMENT]
        src = tokenize.untokenize(toks).decode("utf-8")
        start = src.index("class NeonHttpAppStore")
        end = src.index("class HttpApiAppStore")
        body = src[start:end]

        offenders = []
        for m in re.finditer(r"select\s+\*\s+from", body, re.I):
            head = body.rfind("\n    def ", 0, m.start())
            name = re.match(r"\n    def (\w+)", body[head:]).group(1) if head >= 0 else "?"
            if name not in self._ALLOWED:
                offenders.append(name)
        assert not offenders, f"这些方法在 select *，整份 jsonb 会过网关：{offenders}"
        # 判据自检：白名单里的那几个确实还在用 select *，否则这条测的是空气。
        assert re.search(r"select\s+\*\s+from", body, re.I), "一句 select * 都没匹配到——判据坏了"
