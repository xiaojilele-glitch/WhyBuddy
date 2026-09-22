"""The SSE fallback must preserve persisted page binding status.

The previous fallback used True for every page, including pages-only hops and
failed bind attempts. Compile the actual nested producer so this test cannot
accidentally verify a second copy of its logic.
"""
import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

DRIVER = Path(__file__).parents[1] / "services/v5_full_driver.py"


@pytest.mark.parametrize("status,expected", [("bound", True), ("skipped", False), ("failed", False), (None, False)])
@pytest.mark.parametrize("source", ["buffer", "session"])
def test_fallback_uses_page_status(status, expected, source):
    tree = ast.parse(DRIVER.read_text(encoding="utf-8"))
    function = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == "_fallback_page_events")
    module = ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[]))
    blob = {"pages": {"p1": "<main>shell</main>"}, "device": "phone",
            "pageBindStatus": {"p1": status} if status else {}}
    env = {"_peek_page_events": lambda: 0, "_note_page_event": lambda: None,
           "_peek_pages_for_fallback": lambda: blob if source == "buffer" else None,
           "state": SimpleNamespace(specFirstPages=blob), "_delivered_pages": {}}
    exec(compile(module, str(DRIVER), "exec"), env)

    async def run():
        first = [e async for e in env["_fallback_page_events"]()]
        second = [e async for e in env["_fallback_page_events"]()]
        return first, second

    first, second = asyncio.run(run())
    assert [(e["pageId"], e["bound"], e["device"]) for e in first] == [("p1", expected, "phone")]
    assert second == []
