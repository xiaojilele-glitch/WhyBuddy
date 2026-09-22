"""GET /sessions 不得把 payload 整列拉回进程。

⚠ 2026-08-19：侧栏每次打开都 `load_all()` →
`select session_id, payload from sliderule_session`，34 条 5.2 MB / 2.3s。
启动 defer 之后，这条接口成了唯一的全表 hydrate。列表只需要 id / 目标 /
阶段 / 产物数 / 归属 / 时间戳。
"""

from __future__ import annotations

import ast
import inspect
import textwrap

import pytest

from models.v5_state import Artifact, V5SessionState
from services import persistence, session_blob_store


@pytest.fixture(autouse=True)
def _clean_state():
    session_blob_store.reset_cache()
    session_blob_store.reset_import_flag_for_tests()
    persistence._reset_import_flag_for_tests()
    yield
    session_blob_store.reset_cache()
    session_blob_store.reset_import_flag_for_tests()
    persistence._reset_import_flag_for_tests()


@pytest.fixture
def db(tmp_path, monkeypatch):
    from config.settings import settings

    monkeypatch.chdir(tmp_path)
    url = f"sqlite:///{tmp_path / 'sessions.db'}"
    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", url, raising=False)
    monkeypatch.setattr(settings, "APP_STORE_HTTP_API_URL", "", raising=False)
    monkeypatch.setattr(settings, "APP_STORE_HTTP_API_KEY", "", raising=False)
    monkeypatch.delenv("SLIDERULE_SESSIONS_FILE", raising=False)
    monkeypatch.delenv("WHYBUDDY_SESSIONS_FILE", raising=False)
    monkeypatch.delenv("APP_STORE_NEON_HTTP", raising=False)
    session_blob_store.reset_cache()
    return url


def _call_names(src: str) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(ast.parse(textwrap.dedent(src))):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Name):
            names.add(func.id)
        elif isinstance(func, ast.Attribute):
            names.add(func.attr)
    return names


def _referenced_names(src: str) -> set[str]:
    """源码里**提到过**的每个名字——调用、传参、赋值都算。

    ⚠ 2026-08-24 加的，因为只看 `ast.Call` 会被"改成引用"绕过去：
      `list_session_summaries()` 改成 `pool.submit(list_session_summaries)`
      之后，函数照样在跑，判据却判它不见了（假红）。反过来同样成立——真要有人
      把瘦列表换回 load_all 再丢进线程池，只看 Call 的判据就是**假绿**，那才是
      这条判据存在的理由。所以正反两边都改用它。
    """
    return {
        node.id if isinstance(node, ast.Name) else node.attr
        for node in ast.walk(ast.parse(textwrap.dedent(src)))
        if isinstance(node, (ast.Name, ast.Attribute))
    }


def test_list_summary_sql_does_not_select_payload_column():
    """正：列表 SQL 只扫投影列。反：把 payload 写回这条查询必须红。"""
    pg = " ".join(session_blob_store._LIST_SUMMARY_SQL_PG.split()).lower()
    sqlite = " ".join(session_blob_store._LIST_SUMMARY_SQL_SQLITE.split()).lower()
    assert "payload" not in pg
    assert "payload" not in sqlite
    assert "goal_text" in pg and "artifact_count" in pg
    assert "goal_text" in sqlite


def test_list_sess_does_not_call_load_all():
    """正：列表走 list_session_summaries。反：路由里再提到 load_all 必须红。

    ⚠ 用 _referenced_names 而不是 _call_names：2026-08-24 把这两条查询改成并发
      （`pool.submit(list_session_summaries)`）之后，函数还是那个函数，只是不再
      以"调用"的形态出现，只看 ast.Call 的旧判据当场假红。真正要防的事没变——
      这条路上不许出现 load_all，且必须用瘦列表。
    """
    from routes.sliderule_full import list_sess

    names = _referenced_names(inspect.getsource(list_sess))
    assert "load_all" not in names
    assert "list_session_summaries" in names


def test_sql_list_summaries_do_not_call_load_all():
    """库后端的瘦列表不得回落到 load_all（那条才是 5 MB 的病）。"""
    for cls in (
        session_blob_store.SqlSessionBlobStore,
        session_blob_store.NeonHttpSessionBlobStore,
    ):
        names = _call_names(inspect.getsource(cls.list_summaries))
        assert "load_all" not in names, f"{cls.__name__}.list_summaries still hydrates blobs"


def test_sqlite_list_summaries_keeps_goal_and_drops_pages(db):
    fat = V5SessionState(
        sessionId="sr-fat",
        ownerId="user-1",
        goal={"text": "剪藏工作站", "status": "clear"},
        artifacts=[Artifact(id="a1")],
        runtimePhase="awaiting",
        lastTurnId="turn-1",
        specFirstPages={"pages": {"p1": "x" * 20_000}},
    )
    assert persistence.save_session_record(fat)["ok"] is True
    rows = session_blob_store.get_store().list_summaries()
    assert len(rows) == 1
    row = rows[0]
    assert row["sessionId"] == "sr-fat"
    assert row["goal"] == "剪藏工作站"
    assert row["ownerId"] == "user-1"
    assert row["phase"] == "awaiting"
    assert row["artifactCount"] == 1
    assert "specFirstPages" not in row
    assert "pages" not in row
    listed = persistence.list_session_records()
    assert "ownerId" not in listed["sessions"][0]
    loaded = persistence.load_session_record("sr-fat")
    assert loaded["ok"] is True
    assert loaded["session"].specFirstPages == {"pages": {"p1": "x" * 20_000}}


def test_list_summaries_backfills_goal_when_projection_columns_are_null(db):
    """老行只有 payload、列表列是空的。反：把启动回填删掉，侧栏标题会空。"""
    fat = V5SessionState(
        sessionId="sr-old",
        ownerId="user-2",
        goal={"text": "旧档回填", "status": "clear"},
        artifacts=[Artifact(id="a2")],
        runtimePhase="done",
        lastTurnId="turn-9",
    )
    assert persistence.save_session_record(fat)["ok"] is True
    store = session_blob_store.get_store()
    with store._engine.begin() as conn:
        conn.execute(
            store._text(
                "update sliderule_session set goal_text = null, "
                "runtime_phase = null, artifact_count = null"
            )
        )
    session_blob_store.reset_cache()
    rows = session_blob_store.get_store().list_summaries()
    assert rows[0]["sessionId"] == "sr-old"
    assert rows[0]["goal"] == "旧档回填"
    assert rows[0]["ownerId"] == "user-2"
    assert rows[0]["phase"] == "done"
    assert rows[0]["artifactCount"] == 1
