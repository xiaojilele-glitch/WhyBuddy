"""连接器注入是不是真的**接在通电的那条链上**。

仓里第一条纪律的具象化（`test_refine_merge_reaches_the_live_path.py` 是同一
形状）：这个文件里的判据，**每一条都不是在验函数写得对不对**，而是在验
"它被谁调用了"。技能注入那条链已经证明是通的，连接器照着它接，所以判据也
照着它写：

  1. prompt 块真的进了 _build_user_content（不是写了个函数没人调）
  2. **同步和流式两条路由都**设置了、都清空了（第四条：成对的东西）
  3. 前端两处 payload 都带上了 activeConnectors（同上）

⚠ 2026-08-29 补一句，别再被这个文件的绿灯骗一次：**这里每一条都验到
「块进了 prompt」为止，一条都没有验「实体活到了模型里」。** 真机实测
（sr-conn-180152）这四条全绿、而产出的 datamodel 里根本没有 `weather_daily`——
连接器块接在了写需求的第 2 步，而 datamodel 是第 4 步从 HTML 反推出来的。
「块进了 prompt」和「功能生效了」之间还隔着三步。
后半程的判据在 `tests/test_connector_entity_survives_to_model.py`，
病灶与修法见 docs/欠缺模块清单-对照Claude与Grok-build.md §24。
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from services.v5_llm_generate import (  # noqa: E402
    _build_user_content,
    active_connectors,
    connector_prompt_block,
    set_active_connectors,
)

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _clean():
    set_active_connectors(None)
    yield
    set_active_connectors(None)


# ── 只收注册表认识的 ────────────────────────────────────────────────


def test_只收后端注册表里真有的连接器():
    """⚠ 前端传什么都照单全收的话，模型会为一个根本不存在的数据源建一张表，
    生成期取不到数，页面上多出一张永远空着的表——不报错、不告警。"""
    set_active_connectors(
        ["weather", "压根不存在", {"id": "stock"}, {"key": "weather"}, "fx"]
    )
    ids = [c["id"] for c in active_connectors()]
    assert ids == ["weather", "stock", "fx"], "认了不存在的，或者没去重"


def test_传空就是空_跟没挂过一模一样():
    set_active_connectors(None)
    assert active_connectors() == []
    assert connector_prompt_block() == ""
    # 反面：没挂连接器时 prompt 必须跟历史逐字节一致（不许多一个空块/换行）
    assert "connector" not in _build_user_content("做个待办应用").lower()


# ── prompt 块的内容 ────────────────────────────────────────────────


def test_字段_id_逐字进_prompt_而不是描述个大概():
    """⚠ 给"大概有日期和温度"这种描述，模型会自己起 temperature / maxTemp
    这类名字，而取回来的真数据字段是 temp_max——对不上孔，页面每格填「—」，
    problems 还是空的（孔认得出，只是值没有）。所以判据钉的是**逐字**。"""
    set_active_connectors(["weather"])
    block = connector_prompt_block()
    for fid in ("date", "city", "condition", "temp_max", "temp_min", "rain_chance", "wind_max"):
        assert fid in block, f"字段 id {fid} 没进 prompt"
    assert "weather_daily" in block, "实体 id 没进 prompt"


def test_明确要求不许改名不许丢字段():
    set_active_connectors(["weather"])
    block = connector_prompt_block().lower()
    # 盯语义不盯某句话的字面：得同时说"原样"和"别改名/别丢"
    assert "exactly" in block
    assert "rename" in block and ("drop" in block or "omit" in block)


def test_挂两个就出两条_各带各的实体():
    set_active_connectors(["weather", "stock"])
    block = connector_prompt_block()
    assert "weather_daily" in block and "stock_quote" in block
    assert block.count("→ entity id") == 2


def test_fx_字段_id_逐字进_prompt():
    """新连接器跟天气同一条纪律：字段 id 差一个字，真数据就填不进孔。"""
    set_active_connectors(["fx"])
    block = connector_prompt_block()
    for fid in ("date", "base", "quote", "rate"):
        assert fid in block, f"字段 id {fid} 没进 prompt"
    assert "fx_rate" in block, "实体 id 没进 prompt"


def test_fx_在工厂真正读的注册表里():
    """⚠ 只写在注释/文档字符串里的 id 必须红。判据走运行时注册表 + 取数，
    不 grep 源码里的 'fx' 字样（那个词注释里也会出现）。"""
    from services.connectors import (
        FX,
        _FETCHERS,
        _REGISTRY,
        fetch_rows,
        get_connector,
        list_connectors,
    )

    ids = {c["id"] for c in list_connectors()}
    assert "fx" in ids
    spec = get_connector("fx")
    assert spec is not None
    assert spec is _REGISTRY["fx"]
    assert spec.entity_id == "fx_rate"
    assert spec.needs_env == ""
    assert "fx" in _FETCHERS
    assert spec is FX

    def _ok(url, timeout_s):
        assert "api.frankfurter.app" in url
        return {
            "amount": 1.0,
            "base": "EUR",
            "date": "2026-08-26",
            "rates": {"USD": 1.17, "CNY": 8.4},
        }

    r = fetch_rows("fx", {"base": "EUR", "quotes": "USD,CNY"}, fetch_fn=_ok)
    assert r.ok is True
    assert r.rows
    assert r.source.startswith("Frankfurter")
    assert r.fetched_at
    declared = {f["id"] for f in spec.entity_declaration()["fields"]}
    assert set(r.rows[0]["values"].keys()) == declared


# ── 这才是这个文件的重点：它接在链上吗 ──────────────────────────────


def test_prompt_块真的进了_build_user_content():
    """⚠ 直接调 connector_prompt_block() 全绿、而调用点被删掉**照样全绿**——
    仓里数到第十次以上的失败形态。所以判据要从**真正拼 prompt 的那个函数**
    里去找它。"""
    set_active_connectors(["weather"])
    content = _build_user_content("做一个天气看板")
    assert "weather_daily" in content, "prompt 块没接上——函数写对了但没人调它"
    assert "temp_max" in content


def test_fx_进_spec_first_prompt():
    """spec-first 才是默认生成器。只接 GEN5 _build_user_content 等于没接。"""
    from services.spec_tree import build_spec_prompt

    set_active_connectors(["fx"])
    user = build_spec_prompt("做一个汇率看板")[-1]["content"]
    assert "fx_rate" in user
    spec = _src("slide-rule-python/services/spec_tree.py")
    build = spec[spec.index("def build_spec_prompt") : spec.index("def generate_spec_tree")]
    assert "connector_prompt_block()" in build
    assert "parts.append(connectors)" in build


def test_清空之后_prompt_里不许还留着上一轮的连接器():
    """请求域隔离：A 挂了天气，B 没挂，B 的 prompt 里不许出现天气。"""
    set_active_connectors(["weather"])
    assert "weather_daily" in _build_user_content("A 的意图")
    set_active_connectors(None)
    assert "weather_daily" not in _build_user_content("B 的意图")


# ── 成对的东西：两条路由、两处载荷 ─────────────────────────────────


def _src(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_同步和流式两条驱动都设置了也都清空了():
    """⚠ 仓里第四条。流式才是前端主路径，只改同步等于没改。

    流式信封抽到 drive_full_factory：同步入口仍在 sliderule_full 设/清，
    流式入口在 helper 用命名字段设/清。删 helper 调用点这条必须红。
    """
    routes = _src("slide-rule-python/routes/sliderule_full.py")
    helper = _src("slide-rule-python/services/drive_full_factory.py")
    assert 'set_active_connectors(payload.get("activeConnectors"))' in routes, (
        "同步入口没设连接器"
    )
    assert "set_active_connectors(active_connectors)" in helper, "信封 helper 没设连接器"
    assert routes.count("set_active_connectors(None)") >= 1
    assert helper.count("set_active_connectors(None)") >= 1
    assert "start_drive_full_factory_run" in routes
    assert helper.count("set_installed_skills(None)") == helper.count(
        "set_active_connectors(None)"
    )


def test_前端两处载荷都带上了连接器():
    src = _src("client/src/lib/sliderule-marathon-driver.ts")
    assert src.count("installedSkills: installedSkillsDrivePayload()") >= 2
    assert src.count("pickedConnectorIds(loadTurnCapabilities())") >= 2
    assert "postControlTurnStream" in src


def test_载荷带的是_id_不是整份描述():
    """⚠ 把连接器的描述文案送进去，模型会把它当成用户需求的一部分。"""
    src = _src("client/src/lib/sliderule-marathon-driver.ts")
    assert "pickedConnectorIds(loadTurnCapabilities())" in src
    # 反面：不许直接把整份 turn-capabilities 灌进去
    assert not re.search(r"activeConnectors:\s*loadTurnCapabilities\(\)", src)
