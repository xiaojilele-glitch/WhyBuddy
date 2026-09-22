"""作曲家「应用 / Web」必须接到真正在跑的那条链上。

resolve_preferred_device 自己认 override 不够——得确认 drive-full 和
drive-full-stream **都**在引擎启动前 set。只改同步、流式才是主路径
（本仓身份透传/精修踩过）。
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _code(mod) -> str:
    import inspect

    src = inspect.getsource(mod)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


def test_spec_first_is_still_the_live_generator():
    from services import v5_capability_executor as ex

    code = _code(ex)
    assert "run_spec_first(" in code
    at_spec = code.index("run_spec_first(")
    at_legacy = code.find("generate_five_system_model(")
    assert at_legacy == -1 or at_spec < at_legacy


def test_sync_and_stream_routes_both_bind_the_override():
    from routes import sliderule_full as r
    from services import drive_full_factory as f

    code = _code(r)
    helper = _code(f)
    sync_at = code.index("def drive_full(")
    stream_at = code.index("def drive_full_stream(")
    sync = code[sync_at:stream_at]
    stream = code[stream_at : stream_at + 3500]
    assert "set_preferred_device_override" in sync
    assert "start_drive_full_factory_run" in stream
    assert "set_preferred_device_override" in helper
    assert "preferred_device" in helper
    assert "preferredDevice" in sync


def test_override_reaches_spec_first_device_resolution(monkeypatch):
    """行为：set override 后 run_spec_first 认 phone，而不是话题里的「网站」。"""
    from services.device_policy import set_preferred_device_override
    from services import spec_first_pipeline as sfp

    captured: dict = {}

    monkeypatch.setattr(
        "services.spec_tree.generate_spec_tree",
        lambda *a, **k: {
            "appName": "x",
            "personas": [],
            "pages": [{"id": "p1", "name": "首页"}],
            "nodes": [],
        },
    )

    def _pages(spec, **kw):
        captured["device"] = kw.get("device")
        return {"pages": {"p1": "<html>1</html>"}, "failed": {}}

    monkeypatch.setattr("services.spec_page_html.generate_pages_parallel", _pages)
    monkeypatch.setattr(
        "services.page_shell.unify_shell",
        lambda pages, spec, **kw: {"pages": pages, "navItems": []},
    )
    monkeypatch.setattr("services.page_shell.check_shell_consistency", lambda *a, **k: [])
    monkeypatch.setattr(
        "services.html_structure.derive_structure", lambda *a, **k: {"entities": [], "pages": []}
    )
    monkeypatch.setattr("services.spec_semantics.derive_semantics", lambda *a, **k: {"roles": []})
    monkeypatch.setattr("services.model_assembly.assemble", lambda *a, **k: {"model": {"ok": 1}})
    monkeypatch.setattr(
        "services.html_bindings.bind_pages",
        lambda pages, model, **kw: {"pages": pages, "failed": {}},
    )

    set_preferred_device_override("phone")
    try:
        out = sfp.run_spec_first("做一个订单管理网站")
    finally:
        set_preferred_device_override(None)
        sfp.take_last_pages()

    assert captured.get("device") == "phone"
    assert out["device"] == "phone"
    assert (out.get("model") or {}).get("appbundle", {}).get("preferredDevice") == "phone"


def test_executor_passes_override_into_run_spec_first():
    """开关必须作为参数进 run_spec_first，不能只 set 全局。

    assemble 写死 desktop；执行器如果只调 run_spec_first(goal)，
    画页认 override、落库仍是 PC。
    """
    from services import v5_capability_executor as ex

    code = _code(ex)
    at = code.index("def _invoke_spec_first")
    body = code[at : at + 1800]
    assert "preferred_device=preferred_device_override()" in body
    assert 'return run_spec_first(' in body


def test_explicit_preferred_device_beats_goal_keywords_without_global(monkeypatch):
    """不靠模块全局：preferred_device=phone 必须压过句子里的「网站」。"""
    from services.device_policy import set_preferred_device_override
    from services import spec_first_pipeline as sfp

    captured: dict = {}
    monkeypatch.setattr(
        "services.spec_tree.generate_spec_tree",
        lambda *a, **k: {
            "appName": "x",
            "personas": [],
            "pages": [{"id": "p1", "name": "首页"}],
            "nodes": [],
        },
    )
    monkeypatch.setattr(
        "services.spec_page_html.generate_pages_parallel",
        lambda spec, **kw: (
            captured.update(device=kw.get("device"))
            or {"pages": {"p1": "<html>1</html>"}, "failed": {}}
        ),
    )
    monkeypatch.setattr(
        "services.page_shell.unify_shell",
        lambda pages, spec, **kw: {"pages": pages, "navItems": []},
    )
    monkeypatch.setattr("services.page_shell.check_shell_consistency", lambda *a, **k: [])
    monkeypatch.setattr(
        "services.html_structure.derive_structure", lambda *a, **k: {"entities": [], "pages": []}
    )
    monkeypatch.setattr("services.spec_semantics.derive_semantics", lambda *a, **k: {"roles": []})
    monkeypatch.setattr("services.model_assembly.assemble", lambda *a, **k: {"model": {"ok": 1}})
    monkeypatch.setattr(
        "services.html_bindings.bind_pages",
        lambda pages, model, **kw: {"pages": pages, "failed": {}},
    )

    set_preferred_device_override(None)
    try:
        out = sfp.run_spec_first("做一个订单管理网站", preferred_device="phone")
    finally:
        sfp.take_last_pages()

    assert captured.get("device") == "phone"
    assert out["device"] == "phone"
    assert (out.get("model") or {}).get("appbundle", {}).get("preferredDevice") == "phone"


def test_pipeline_forwards_device_into_spec_and_style():
    """device 传到画页不够——SPEC / 风格段漏传，页还是 PC 工作台。

    剥注释再盯调用点：标识符写在 docstring 里也会绿（本仓踩过）。
    """
    from services import spec_first_pipeline as sfp

    code = _code(sfp)
    spec_at = code.index("generate_spec_tree(")
    assert "device=device" in code[spec_at : spec_at + 280]
    style_at = code.index("generate_style_brief(")
    assert "device=device" in code[style_at : style_at + 80]
    dl_at = code.index("generate_design_language(")
    assert "device=device" in code[dl_at : dl_at + 200]
    renders = re.findall(r"render_design_language\([^)]*\)", code)
    assert renders, "回落/复用支把 render 删了"
    assert all("device=device" in call for call in renders)


def test_phone_device_reaches_spec_and_style_kwargs(monkeypatch):
    """行为：preferred_device=phone 时 generate_spec_tree / style_brief 都收到 phone。"""
    from services import spec_first_pipeline as sfp

    captured: dict = {}

    def _spec(*_a, **k):
        captured["spec_device"] = k.get("device")
        return {
            "appName": "x",
            "personas": [],
            "pages": [{"id": "p1", "name": "首页"}],
            "nodes": [],
        }

    def _style(spec, **k):
        captured["style_device"] = k.get("device")
        return None

    def _dl(spec, **k):
        captured["dl_device"] = k.get("device")
        return {
            "tone": "x",
            "primary": "#2563eb",
            "accent": "#0f172a",
            "radius": "8px",
            "density": "标准",
            "components": [],
            "charts": False,
        }

    monkeypatch.setattr("services.spec_tree.generate_spec_tree", _spec)
    monkeypatch.setattr("services.design_language.generate_style_brief", _style)
    monkeypatch.setattr("services.design_language.generate_design_language", _dl)
    monkeypatch.setattr(
        "services.spec_page_html.generate_pages_parallel",
        lambda spec, **kw: {"pages": {"p1": "<html>1</html>"}, "failed": {}},
    )
    monkeypatch.setattr(
        "services.page_shell.unify_shell",
        lambda pages, spec, **kw: {"pages": pages, "navItems": []},
    )
    monkeypatch.setattr("services.page_shell.check_shell_consistency", lambda *a, **k: [])
    monkeypatch.setattr(
        "services.html_structure.derive_structure", lambda *a, **k: {"entities": [], "pages": []}
    )
    monkeypatch.setattr("services.spec_semantics.derive_semantics", lambda *a, **k: {"roles": []})
    monkeypatch.setattr("services.model_assembly.assemble", lambda *a, **k: {"model": {"ok": 1}})
    monkeypatch.setattr(
        "services.html_bindings.bind_pages",
        lambda pages, model, **kw: {"pages": pages, "failed": {}},
    )

    try:
        sfp.run_spec_first("做一个订单管理网站", preferred_device="phone")
    finally:
        sfp.take_last_pages()

    assert captured.get("spec_device") == "phone"
    assert captured.get("style_device") == "phone"
    assert captured.get("dl_device") == "phone"
