"""会话落库（2026-08-02）。

背景：线上应用中心 23 个应用、点开 18 个是空白页。应用记录跨机器共享（同一个
Neon 库），会话却每台机器一份文件——在开发机跑出来的应用，换台机器打开时
`session_id` 指向的会话查不到，前端就地造一个空会话，不报错。

这份测试盯四件事：
  ① 配了库就走库、没配就走文件，且**显式传 store_file 永远走文件**；
  ② 守卫语义在库后端上与文件后端**逐条对齐**（陈旧快照不得覆盖、历史只增不减）；
  ③ 跨进程并发靠行级 CAS 挡住，冲突后重算而不是硬写；
  ④ 升级不能让本机原有会话消失——首次用库时把文件里的搬进去，且只插不改。

用 SQLite 当库跑：SqlSessionBlobStore 对 SQLite 和 Postgres 走同一条代码路径
（只有 jsonb 转型和 DDL 有别），CAS 语义完全一致，不需要真连 Neon。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from models.v5_state import SlideRuleReplayEvent, V5SessionState
from services import persistence, session_blob_store


@pytest.fixture(autouse=True)
def _clean_state():
    """每条用例都从干净的后端缓存开始——单例会跨用例串味。"""
    session_blob_store.reset_cache()
    session_blob_store.reset_import_flag_for_tests()
    persistence._reset_import_flag_for_tests()
    yield
    session_blob_store.reset_cache()
    session_blob_store.reset_import_flag_for_tests()
    persistence._reset_import_flag_for_tests()


@pytest.fixture
def db(tmp_path, monkeypatch):
    """把会话存档指到一个临时 SQLite 库。

    必须 chdir 到 tmp_path：文件存档路径是**相对 cwd** 的 data/sliderule-sessions.json，
    不换目录的话首次用库会把开发者本机那份真实存档整个导进测试库，断言就随
    本机数据变化了（第一次写这份测试时实测踩中：`新增 6 条`）。
    """
    from config.settings import settings

    monkeypatch.chdir(tmp_path)
    url = f"sqlite:///{tmp_path / 'sessions.db'}"
    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", url, raising=False)
    # 逃生口必须清空，否则会被判成「这台机器就要用文件」
    monkeypatch.delenv("SLIDERULE_SESSIONS_FILE", raising=False)
    monkeypatch.delenv("WHYBUDDY_SESSIONS_FILE", raising=False)
    monkeypatch.delenv("APP_STORE_NEON_HTTP", raising=False)
    session_blob_store.reset_cache()
    return url


def _state(session_id: str, *, turn: str = "turn-1", goal: str = "目标") -> V5SessionState:
    return V5SessionState(
        sessionId=session_id,
        goal={"text": goal, "status": "needs_refinement"},
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[],
        runtimePhase="idle",
        lastTurnId=turn,
    )


# ────────────────────── ① 后端选择 ──────────────────────


def test_no_db_url_keeps_using_the_file(tmp_path, monkeypatch):
    """没配连接串 → 还是那个 JSON 文件，行为与改动前一致。"""
    from config.settings import settings

    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", "", raising=False)
    session_blob_store.reset_cache()
    assert session_blob_store.get_store() is None

    store_file = tmp_path / "s.json"
    persistence.save_session_record(_state("sr-1"), store_file)
    assert store_file.exists()
    assert persistence.load_session_record("sr-1", store_file)["ok"] is True


def test_explicit_store_file_always_wins_over_db(db, tmp_path):
    """显式传 store_file → 一定走文件，哪怕全局配了库。

    测试与「这台机器就要用这个文件」的逃生口都靠这条规则。若被库配置盖过，
    所有传 store_file 的历史测试都会莫名其妙地读到别处去。
    """
    store_file = tmp_path / "explicit.json"
    persistence.save_session_record(_state("sr-file-only"), store_file)

    assert store_file.exists(), "显式路径没落到文件上"
    # 库里不该有这条
    assert session_blob_store.get_store().load("sr-file-only") is None


def test_sessions_file_env_opts_out_of_the_db(db, tmp_path, monkeypatch):
    """设了 SLIDERULE_SESSIONS_FILE 就不进库——这两个环境变量本来就是
    「会话存档在哪」的意思，沿用它的语义做逃生口。"""
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "escape.json"))
    session_blob_store.reset_cache()
    assert session_blob_store.get_store() is None


def test_db_roundtrip(db):
    """配了库 → 存取走库，文件不再产生。"""
    persistence.save_session_record(_state("sr-db", goal="进库的会话"))
    got = persistence.load_session_record("sr-db")
    assert got["ok"] is True
    assert got["session"].goal["text"] == "进库的会话"

    assert "sr-db" in persistence.load_all()
    listed = persistence.list_session_records()
    assert [s["sessionId"] for s in listed["sessions"]] == ["sr-db"]

    persistence.delete_session_record("sr-db")
    assert persistence.load_session_record("sr-db")["ok"] is False


def test_postgres_payload_bind_expr_keeps_named_param_parseable():
    """Postgres JSONB casts must not use ``:p::jsonb`` with SQLAlchemy text()."""
    expr = session_blob_store._payload_bind_expr(is_sqlite=False)
    assert expr == "cast(:p as jsonb)"
    assert ":p::jsonb" not in expr


def test_control_generation_fences_session_insert_and_update(db):
    """控制 worker 必须和会话 CAS 共用同一条 SQL fence。"""
    from services.control_run_store import ControlRunStore
    from services.project_store import ProjectStore

    session_store = session_blob_store.get_store()
    control_db = ProjectStore.from_url(db)
    control = ControlRunStore(control_db._q)
    run = control.submit("sr-fenced", "alice", "request-1", {"message": "run"})
    claimed = control.claim(run["runId"], "worker-1", 30)
    assert claimed is not None
    fence = {"runId": claimed["runId"], "ownerId": "alice",
             "generation": claimed["generation"], "workerId": "worker-1"}

    payload = _state("sr-fenced", goal="受保护").model_dump()
    payload["ownerId"] = "alice"
    assert session_store.save("sr-fenced", payload, expected_rev=None,
                              expected_control_run=fence) is True
    row = session_store.load("sr-fenced")
    assert row is not None
    assert session_store.save("sr-fenced", {**payload, "lastTurnId": "turn-2"},
                              expected_rev=row.rev, expected_control_run=fence) is True

    assert session_store.save("sr-fenced", {**payload, "lastTurnId": "turn-3"},
                              expected_rev=2, expected_control_run={**fence, "generation": fence["generation"] + 1}) is False
    control.finish(claimed["runId"], "worker-1", claimed["generation"], "completed")
    latest = session_store.load("sr-fenced")
    assert latest is not None
    assert session_store.save("sr-fenced", {**payload, "lastTurnId": "turn-4"},
                              expected_rev=latest.rev, expected_control_run=fence) is False
    control_db.close()


@pytest.mark.parametrize("invalidate", ["generation", "worker", "owner", "expired", "cancelled", "request_cancelled", "inactive"])
@pytest.mark.parametrize("existing", [False, True])
def test_control_fence_rejects_lost_ownership_before_any_session_write(db, invalidate, existing):
    from services.control_run_store import ControlRunStore
    from services.project_store import ProjectStore

    blobs = session_blob_store.get_store()
    control_db = ProjectStore.from_url(db)
    control = ControlRunStore(control_db._q)
    run = control.submit("sr-fence-lost", "alice", "request", {})
    owned = control.claim(run["runId"], "worker", 30)
    fence = {"runId": owned["runId"], "ownerId": "alice", "workerId": "worker", "generation": owned["generation"]}
    payload = {**_state("sr-fence-lost").model_dump(), "ownerId": "alice"}
    if existing:
        assert blobs.save("sr-fence-lost", payload, expected_rev=None)
    if invalidate == "generation":
        fence["generation"] += 1
    elif invalidate == "worker":
        fence["workerId"] = "old-worker"
    elif invalidate == "owner":
        fence["ownerId"] = "bob"
        payload["ownerId"] = "bob"
    elif invalidate == "expired":
        control_db._q("update wb_control_run set lease_expires_at=0 where id=$1", [owned["runId"]])
    elif invalidate == "cancelled":
        control.cancel(owned["runId"], "alice")
    elif invalidate == "request_cancelled":
        control_db._q("insert into wb_control_cancel_request values($1,$2,$3)", ["sr-fence-lost", "alice", "request"])
    else:
        control_db._q("update wb_control_session set active_run_id=null where session_id=$1", ["sr-fence-lost"])
    assert not blobs.save("sr-fence-lost", {**payload, "lastTurnId": "turn-2"},
                          expected_rev=1 if existing else None, expected_control_run=fence)
    row = blobs.load("sr-fence-lost")
    if existing:
        assert row.rev == 1 and row.payload["lastTurnId"] == "turn-1"
    else:
        assert row is None
    control_db.close()


def test_control_fence_rejects_cross_session_and_payload_owner(db):
    from services.control_run_store import ControlRunStore
    from services.project_store import ProjectStore

    blobs = session_blob_store.get_store()
    control_db = ProjectStore.from_url(db)
    control = ControlRunStore(control_db._q)
    run = control.submit("source", "alice", "request", {})
    owned = control.claim(run["runId"], "worker", 30)
    fence = {"runId": owned["runId"], "ownerId": "alice", "workerId": "worker", "generation": 1}
    payload = {**_state("target").model_dump(), "ownerId": "alice"}
    assert not blobs.save("target", payload, expected_rev=None, expected_control_run=fence)
    with pytest.raises(ValueError, match="owner_mismatch"):
        blobs.save("source", {**payload, "sessionId": "source", "ownerId": "bob"}, expected_rev=None, expected_control_run=fence)
    with pytest.raises(ValueError, match="id_mismatch"):
        blobs.save("source", payload, expected_rev=None, expected_control_run=fence)
    assert blobs.load("target") is None and blobs.load("source") is None
    control_db.close()


@pytest.mark.parametrize("expected_rev", [None, 1])
def test_http_control_fence_reaches_single_statement_gateway(expected_rev):
    import httpx
    from services.sql_gateway import HttpSqlGateway

    requests = []
    def respond(request):
        body = json.loads(request.content)
        requests.append(body)
        return httpx.Response(200, json={"rows": [{"session_id": "sr-http-fence"}], "truncated": False})

    gateway = HttpSqlGateway("https://db.test", "test-only-key")
    gateway._client.close()
    gateway._client = httpx.Client(transport=httpx.MockTransport(respond))
    blobs = object.__new__(session_blob_store.HttpApiSessionBlobStore)
    blobs._gateway = gateway
    fence = {"runId": "run", "ownerId": "alice", "workerId": "worker", "generation": 3}
    payload = {**_state("sr-http-fence").model_dump(), "ownerId": "alice"}
    assert blobs.save("sr-http-fence", payload, expected_rev=expected_rev, expected_control_run=fence)
    assert len(requests) == 1
    sql = requests[0]["sql"].lower()
    assert sql.startswith("with owned_control as materialized")
    assert "for update of cr" in sql and "clock_timestamp()" in sql
    assert "wb_control_cancel_request" in sql and "cancelrequested" in sql
    assert ("insert into sliderule_session" if expected_rev is None else "update sliderule_session") in sql
    assert "cast(%s as jsonb)" in sql
    assert "run" in requests[0]["params"] and "worker" in requests[0]["params"] and 3 in requests[0]["params"]
    gateway._client.close()


@pytest.mark.parametrize("existing", [False, True])
def test_control_fence_never_falls_back_when_control_tables_are_absent(db, existing):
    from sqlalchemy.exc import OperationalError

    blobs = session_blob_store.get_store()
    payload = {**_state("sr-no-control-db").model_dump(), "ownerId": "alice"}
    if existing:
        assert blobs.save("sr-no-control-db", payload, expected_rev=None)
    fence = {"runId": "missing", "ownerId": "alice", "workerId": "worker", "generation": 1}
    with pytest.raises(OperationalError, match="wb_control_run"):
        blobs.save("sr-no-control-db", {**payload, "lastTurnId": "turn-2"},
                   expected_rev=1 if existing else None, expected_control_run=fence)
    row = blobs.load("sr-no-control-db")
    if existing:
        assert row.rev == 1 and row.payload["lastTurnId"] == "turn-1"
    else:
        assert row is None


def test_delete_is_idempotent(db):
    """删不存在的会话算成功（G1 契约），与文件后端一致。"""
    assert persistence.delete_session_record("sr-never-existed")["ok"] is True


def test_meta_comes_from_the_row_not_a_sidecar(db):
    """落库后侧栏「最近」排序仍要有时间——库里是行上的两列，不是 sidecar 文件。"""
    persistence.save_session_record(_state("sr-meta"))
    meta = persistence.read_session_meta()
    assert meta["sr-meta"]["lastActive"], "lastActive 空了，侧栏排序会全乱"
    assert meta["sr-meta"]["createdAt"]


# ────────────────────── ② 守卫语义与文件后端对齐 ──────────────────────


def test_stale_lower_turn_cannot_clobber_core(db):
    """低轮次的陈旧快照不得覆盖已提交内容——库后端必须与文件后端同样守住。"""
    persistence.save_session_record(_state("sr-g", turn="turn-5", goal="第五轮的成果"))
    persistence.save_session_record(_state("sr-g", turn="turn-2", goal="迟到的旧快照"))

    got = persistence.load_session_record("sr-g")["session"]
    assert got.goal["text"] == "第五轮的成果", "旧快照把新内容冲掉了"


def test_same_turn_without_growth_cannot_clobber(db):
    """同轮次且核心无增长 = 陈旧快照，同样挡住（这条是踩出来的，见 _is_same_turn_progress）。"""
    persistence.save_session_record(_state("sr-h", turn="turn-3", goal="已提交"))
    persistence.save_session_record(_state("sr-h", turn="turn-3", goal="同轮覆盖企图"))

    got = persistence.load_session_record("sr-h")["session"]
    assert got.goal["text"] == "已提交"


def test_higher_turn_is_accepted(db):
    """更高轮次是真进展，应当写进去。"""
    persistence.save_session_record(_state("sr-i", turn="turn-1", goal="旧"))
    persistence.save_session_record(_state("sr-i", turn="turn-9", goal="新"))
    assert persistence.load_session_record("sr-i")["session"].goal["text"] == "新"


def test_guard_logic_has_exactly_one_implementation():
    """守卫判定只能有一份实现——两条存储路径共用 _resolve_write_state。

    这条不是走形式：历史上这段逻辑内联在 save_session_record 里，落库时如果
    复制一份，两边就会慢慢漂移，而漂移的表现是「某个后端下旧快照能覆盖新数据」
    这种极难复现的丢数据 bug。
    """
    src = Path(persistence.__file__).read_text(encoding="utf-8")
    assert src.count("_is_same_turn_progress(prior, state)") == 1, (
        "守卫判定出现了第二份实现，两条存储路径会漂移"
    )
    assert "_resolve_write_state" in src


def _replay(event_id: str, session_id: str) -> SlideRuleReplayEvent:
    """造一条**合法**的 replay 事件。

    第一版这里塞的是 {"id": ..., "kind": "x"} 这种手写 dict，缺 sessionId/at
    且 kind 不在 Literal 里，落库回读时被校验丢掉——测试红了，但红的是夹具
    不是代码。追加语义必须用真事件来验。
    """
    return SlideRuleReplayEvent(
        id=event_id,
        sessionId=session_id,
        at="2026-08-02T00:00:00+00:00",
        kind="decision",
    )


def test_replay_log_is_append_only_in_db(db):
    """服务端历史只增不减：后写的快照没带上历史，也不能把库里的抹掉。"""
    first = _state("sr-j", turn="turn-1")
    first.sessionReplayLog = [_replay("ev-1", "sr-j")]
    persistence.save_session_record(first)

    second = _state("sr-j", turn="turn-2")
    second.sessionReplayLog = [_replay("ev-2", "sr-j")]
    persistence.save_session_record(second)

    got = persistence.load_session_record("sr-j")["session"]
    ids = {e.id for e in (got.sessionReplayLog or [])}
    assert ids == {"ev-1", "ev-2"}, f"replay 不是追加语义: {ids}"


# ────────────────────── ③ 跨进程并发：行级 CAS ──────────────────────


def test_cas_blocks_a_write_based_on_a_stale_read(db):
    """拿旧 rev 写不进去——这是跨机器并发的唯一防线（进程锁挡不住另一台机器）。"""
    store = session_blob_store.get_store()
    payload = _state("sr-cas").model_dump()
    assert store.save("sr-cas", payload, expected_rev=None) is True

    row = store.load("sr-cas")
    assert store.save("sr-cas", payload, expected_rev=row.rev) is True   # 用最新 rev：成功
    assert store.save("sr-cas", payload, expected_rev=row.rev) is False  # 同一个 rev 再来：拒绝


def test_concurrent_insert_of_same_id_does_not_double_write(db):
    """两边同时插同一个 id：一个成功、一个按 CAS 失败处理，不会写坏。"""
    store = session_blob_store.get_store()
    payload = _state("sr-race").model_dump()
    assert store.save("sr-race", payload, expected_rev=None) is True
    assert store.save("sr-race", payload, expected_rev=None) is False


def test_save_retries_after_a_conflict_instead_of_forcing(db, monkeypatch):
    """CAS 冲突后必须**重读重算**再写，不能拿算好的结果硬写。

    硬写会把另一方刚提交的内容冲掉——正是守卫要防的那件事，只是换了个入口。
    """
    store = session_blob_store.get_store()
    persistence.save_session_record(_state("sr-retry", turn="turn-1", goal="初始"))

    reads: list[int] = []
    real_load = store.load
    real_save = store.save
    calls = {"n": 0}

    def flaky_save(sid, payload, *, expected_rev):
        calls["n"] += 1
        if calls["n"] == 1:
            return False  # 假装被别人抢先写了
        return real_save(sid, payload, expected_rev=expected_rev)

    def counting_load(sid):
        row = real_load(sid)
        reads.append(1)
        return row

    monkeypatch.setattr(store, "save", flaky_save)
    monkeypatch.setattr(store, "load", counting_load)

    result = persistence.save_session_record(_state("sr-retry", turn="turn-2", goal="新的"))
    assert result["ok"] is True
    assert len(reads) == 2, "冲突后没有重读，说明是拿旧结果硬写的"


def test_exhausted_retries_report_failure_not_silent_loss(db, monkeypatch):
    """重试用尽要如实返回失败——静默丢写入比报错糟得多。"""
    store = session_blob_store.get_store()
    monkeypatch.setattr(store, "save", lambda *a, **k: False)
    result = persistence.save_session_record(_state("sr-doomed"))
    assert result["ok"] is False
    assert result["reason"] == "cas_conflict"


# ─────────── ④ 本机文件不许回灌进库（除非显式打开一次性迁移）───────────
#
# 这一节原来叫「升级不能让本机会话消失」，守的是反方向：首次用库时把本机
# 文件里的会话搬进去。那是一次性的迁移辅助，迁完之后它就从"救命的"变成
# "埋雷的"——2026-08-13 实际炸了一次：一个加载了生产 .env 的本地进程，
# 把本机文件里 21 条**早就清掉的**旧会话原样推回了生产库。
#
# 根子在方向：**本地文件是陈旧副本，库才是真相**，这段代码却让陈旧副本
# 单向往真相里写。它的"只插不改"保护得了"库里已有的那条"，保护不了
# "库里已经被删掉的那条"——删除在它眼里跟"还没导入"长得一模一样。
#
# 所以现在默认关。迁移仍然做得了，但必须显式打开、跑完就关。


def test_本机文件默认不回灌进库(db, tmp_path, monkeypatch):
    """默认口径：一切走库，本地文件不回灌。

    这条守的正是那次事故的形态——本机躺着一份陈旧存档，进程一起就被推上去。
    """
    from config.settings import settings

    store_file = tmp_path / "data" / "sliderule-sessions.json"
    store_file.parent.mkdir(parents=True)
    store_file.write_text(
        json.dumps([["sr-stale", _state("sr-stale", goal="早该清掉的旧会话").model_dump()]],
                   ensure_ascii=False, default=str),
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("SLIDERULE_SESSIONS_FILE", raising=False)
    monkeypatch.delenv("SLIDERULE_SESSION_LOCAL_IMPORT", raising=False)
    session_blob_store.reset_cache()

    assert persistence.load_all() == {}, "本机陈旧存档又被推进库里了——正是那次事故"


def test_显式打开才做一次性迁移(tmp_path, monkeypatch):
    """迁移能力保留：显式打开就该照常搬。"""
    from config.settings import settings

    store_file = tmp_path / "data" / "sliderule-sessions.json"
    store_file.parent.mkdir(parents=True)
    store_file.write_text(
        json.dumps([["sr-old-1", _state("sr-old-1", goal="老会话一").model_dump()]],
                   ensure_ascii=False, default=str),
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        settings, "APP_STORE_DATABASE_URL", f"sqlite:///{tmp_path / 'migrate.db'}", raising=False
    )
    monkeypatch.delenv("SLIDERULE_SESSIONS_FILE", raising=False)
    monkeypatch.setenv("SLIDERULE_SESSION_LOCAL_IMPORT", "1")
    session_blob_store.reset_cache()

    got = persistence.load_all()
    assert set(got) == {"sr-old-1"}, f"显式打开了却没迁移: {set(got)}"


def test_existing_file_sessions_are_imported_on_first_db_use(tmp_path, monkeypatch):
    """显式打开时，这台机器原有的会话必须还在（原「升级不丢数据」那条）。"""
    from config.settings import settings

    monkeypatch.setenv("SLIDERULE_SESSION_LOCAL_IMPORT", "1")

    store_file = tmp_path / "data" / "sliderule-sessions.json"
    store_file.parent.mkdir(parents=True)
    store_file.write_text(
        json.dumps([["sr-old-1", _state("sr-old-1", goal="老会话一").model_dump()],
                    ["sr-old-2", _state("sr-old-2", goal="老会话二").model_dump()]],
                   ensure_ascii=False, default=str),
        encoding="utf-8",
    )

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        settings, "APP_STORE_DATABASE_URL", f"sqlite:///{tmp_path / 'sessions.db'}", raising=False
    )
    monkeypatch.delenv("SLIDERULE_SESSIONS_FILE", raising=False)
    session_blob_store.reset_cache()

    got = persistence.load_all()
    assert set(got) == {"sr-old-1", "sr-old-2"}, f"本机原有会话丢了: {set(got)}"
    assert got["sr-old-1"].goal["text"] == "老会话一"


def test_import_never_overwrites_what_is_already_in_the_db(db, tmp_path, monkeypatch):
    """只插不改：库里那条永远更权威，本地文件可能是很旧的副本。"""
    store = session_blob_store.get_store()
    store.save("sr-dup", _state("sr-dup", goal="库里的（新）").model_dump(), expected_rev=None)

    local = {"sr-dup": _state("sr-dup", goal="文件里的（旧）").model_dump()}
    imported, skipped = session_blob_store.import_local_file_once(local)

    assert (imported, skipped) == (0, 1)
    row = store.load("sr-dup")
    assert row.payload["goal"]["text"] == "库里的（新）", "导入把库里的新数据覆盖了"


def test_import_runs_only_once_per_process(db):
    """导入是启动动作，不能每次读存档都跑一遍（那是每次都全表扫一次）。"""
    first = session_blob_store.import_local_file_once({"sr-x": _state("sr-x").model_dump()})
    second = session_blob_store.import_local_file_once({"sr-y": _state("sr-y").model_dump()})
    assert first == (1, 0)
    assert second == (0, 0)


def test_db_failure_falls_back_to_file_without_raising(tmp_path, monkeypatch):
    """库连不上时照旧回落文件，绝不把异常抛给主链路。"""
    from config.settings import settings

    monkeypatch.setattr(
        settings, "APP_STORE_DATABASE_URL", "postgresql://u:p@db.invalid.internal:5432/x",
        raising=False,
    )
    monkeypatch.delenv("SLIDERULE_SESSIONS_FILE", raising=False)
    session_blob_store.reset_cache()

    assert session_blob_store.get_store() is None  # 降级成 None = 走文件
    store_file = tmp_path / "fallback.json"
    assert persistence.save_session_record(_state("sr-fb"), store_file)["ok"] is True


# ────────────────────── ⑤ 共享库下不能相信进程内缓存 ──────────────────────


def test_load_session_bypasses_the_process_cache_when_the_store_is_shared(db):
    """库共享之后，另一台机器写进去的内容必须读得到。

    `slide_rule_session._sessions` 是进程内缓存。存档在本机文件里时它是安全的
    （本进程独占那个文件）；换成共享库就不安全了——别的机器写完，这里的缓存
    还是旧的，无条件返回缓存 = 返回陈旧数据。

    这里用「直接改库、不碰缓存」来模拟另一台机器的写入。
    """
    from services import slide_rule_session as svc

    svc._sessions.clear()
    persistence.save_session_record(_state("sr-shared", turn="turn-1", goal="本机写的"))
    assert svc.load_session("sr-shared").goal["text"] == "本机写的"  # 进了缓存

    # 另一台机器改了同一条（绕过本进程的一切缓存）
    store = session_blob_store.get_store()
    row = store.load("sr-shared")
    other = _state("sr-shared", turn="turn-2", goal="另一台机器写的").model_dump()
    assert store.save("sr-shared", other, expected_rev=row.rev) is True

    assert svc.load_session("sr-shared").goal["text"] == "另一台机器写的", (
        "读到了进程内缓存的陈旧数据——共享库下必须每次回库读"
    )


def test_load_session_keeps_memory_when_persist_failed_and_memory_is_ahead(db):
    """过夜：落库失败后库停在 mv-1，内存已是 mv-5。GET 必须把内存交出去，
    否则前端看到旧指针，下一轮精修从空页起步。

    反向：另一台机器把库推到更新的 turn 时（上一条）必须仍信库。
    """
    from services import slide_rule_session as svc

    svc._sessions.clear()
    persistence.save_session_record(_state("sr-ahead", turn="turn-1", goal="库里的旧的"))
    live = _state("sr-ahead", turn="turn-5", goal="内存里的新的")
    live.currentModelVersionId = "mv-5"
    live.modelVersions = [{"id": "mv-5", "model": {"a": 1}}]
    svc._sessions["sr-ahead"] = live

    got = svc.load_session("sr-ahead")
    assert got is live
    assert got.goal["text"] == "内存里的新的"
    assert got.currentModelVersionId == "mv-5"


def test_load_session_still_uses_the_cache_on_the_file_backend(tmp_path, monkeypatch):
    """文件后端保持原有的缓存优先行为——那条路上缓存是安全的，绕开只会白白变慢。"""
    from config.settings import settings
    from services import slide_rule_session as svc

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", "", raising=False)
    session_blob_store.reset_cache()

    svc._sessions.clear()
    svc._sessions["sr-cached"] = _state("sr-cached", goal="只在缓存里")
    # 存档里根本没有这条，能读出来就说明走的是缓存
    assert svc.load_session("sr-cached").goal["text"] == "只在缓存里"


def test_db_outage_does_not_drop_an_in_flight_session(db, monkeypatch):
    """库临时不可用时，正在推演的会话不该凭空消失——回落到缓存。"""
    from services import slide_rule_session as svc

    svc._sessions.clear()
    persistence.save_session_record(_state("sr-inflight", goal="推演中"))
    assert svc.load_session("sr-inflight") is not None

    store = session_blob_store.get_store()
    monkeypatch.setattr(store, "load", lambda _sid: (_ for _ in ()).throw(RuntimeError("库挂了")))

    got = svc.load_session("sr-inflight")
    assert got is not None and got.goal["text"] == "推演中", "库一抖动就把手上的会话弄丢了"


# ────────────────────── ⑥ 写放大：跳过无效写入 + 去掉回读 ──────────────────────


def test_identical_payload_skips_the_write(db):
    """内容跟库里一模一样就不写——对标 django-reversion 的 ignore_duplicates。

    一轮推演里 save_session 被调 5~8 次，而守卫判定「这是陈旧快照」时会把
    prior 原样写回去。那次写入必然无效，却照样要驮着约 300KB 跑一趟网络
    （对真实 Neon 实测：跳过后 215ms → 88ms）。
    """
    store = session_blob_store.get_store()
    persistence.save_session_record(_state("sr-dedup", turn="turn-1"))
    rev_before = store.load("sr-dedup").rev

    result = persistence.save_session_record(_state("sr-dedup", turn="turn-1"))

    assert result["ok"] is True
    assert result.get("unchanged") is True
    assert store.load("sr-dedup").rev == rev_before, "内容没变却涨了 rev，说明白写了一次"


def test_changed_payload_still_writes(db):
    """跳过只能发生在内容真的一致时——否则就是丢数据了。"""
    store = session_blob_store.get_store()
    persistence.save_session_record(_state("sr-changed", turn="turn-1"))
    rev_before = store.load("sr-changed").rev

    result = persistence.save_session_record(_state("sr-changed", turn="turn-2", goal="改了"))

    assert result.get("unchanged") is not True
    assert store.load("sr-changed").rev > rev_before
    assert persistence.load_session_record("sr-changed")["session"].goal["text"] == "改了"


def test_save_returns_the_authoritative_state_without_a_reread(db, monkeypatch):
    """写完直接返回权威状态，不再多一趟全量回读。

    save_session 原本是「写完再 load 一次对账」。库后端手上就有刚写下去的结果，
    那趟回读在 HTTP 通道上要白驮 ~300KB。
    """
    from services import slide_rule_session as svc

    svc._sessions.clear()
    persistence.save_session_record(_state("sr-noreread", turn="turn-1"))

    store = session_blob_store.get_store()
    loads: list[str] = []
    real_load = store.load
    monkeypatch.setattr(store, "load", lambda sid: (loads.append(sid), real_load(sid))[1])

    got = svc.save_session(_state("sr-noreread", turn="turn-5", goal="新一轮"))

    assert got.goal["text"] == "新一轮"
    assert len(loads) == 1, f"一次 save 读了 {len(loads)} 趟，回读没省掉"


def test_skipped_write_still_returns_the_guarded_state(db):
    """跳过写入时返回的仍须是守卫判定后的状态，不能把调用方传进来的原样吐回去。

    否则「陈旧快照被守卫挡下」这种情况下，调用方会拿着自己那份旧状态继续跑，
    而库里是新的——两边从此不一致。
    """
    from services import slide_rule_session as svc

    svc._sessions.clear()
    persistence.save_session_record(_state("sr-guarded", turn="turn-9", goal="已提交的新内容"))

    got = svc.save_session(_state("sr-guarded", turn="turn-2", goal="迟到的旧快照"))

    assert got.goal["text"] == "已提交的新内容", "跳过写入时把调用方的旧状态吐回去了"


def test_owner_backfill_is_wired_into_store_open():
    """剥注释再匹配：docstring 会写 _BACKFILL_OWNER 事故，不能让那句话把判据打空。"""
    import inspect
    import re

    src = inspect.getsource(session_blob_store._ensure_list_projection)
    stripped = re.sub(r'""".*?"""', "", src, flags=re.S)
    stripped = re.sub(r"#.*", "", stripped)
    assert "_BACKFILL_OWNER" in stripped


def test_owner_id_backfill_reaches_rows_that_already_have_artifact_count(db):
    """真机：侧栏看得见、用户表话题=0。

    标题回填只打 `artifact_count is null`。已经有产物数、payload 里有
    ownerId、owner_id 列却空着的那批，超管侧栏按无主可见，usage_by_owner
    按列汇总全是 0。重开 store（启动路径）必须把列灌回来。
    """
    from sqlalchemy import text

    from services.cost_ledger import usage_by_owner

    owned = _state("sr-owned", goal="古籍数字化")
    owned.ownerId = "u-root"
    persistence.save_session_record(owned)

    store = session_blob_store.get_store()
    with store._engine.begin() as conn:
        conn.execute(
            text(f"update {session_blob_store.TABLE} set owner_id = null where session_id = :sid"),
            {"sid": "sr-owned"},
        )
        row = conn.execute(
            text(
                f"select owner_id, artifact_count from {session_blob_store.TABLE} "
                "where session_id = :sid"
            ),
            {"sid": "sr-owned"},
        ).first()
        assert row[0] is None
        assert row[1] is not None, "产物数空了就会走标题回填，咬不到这次事故"

    before = {s["sessionId"]: s for s in store.list_summaries()}
    assert "sr-owned" in before, "侧栏必须仍能看见这条（超管无主可见）"
    assert not before["sr-owned"].get("ownerId")
    assert usage_by_owner().get("u-root", {}).get("sessions", 0) == 0

    session_blob_store.reset_cache()
    reopened = session_blob_store.get_store()
    after = {s["sessionId"]: s for s in reopened.list_summaries()}
    assert after["sr-owned"]["ownerId"] == "u-root"
    assert usage_by_owner()["u-root"]["sessions"] >= 1
