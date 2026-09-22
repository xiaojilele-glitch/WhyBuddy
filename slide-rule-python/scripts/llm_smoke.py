"""LLM 冒烟脚本 — 用与应用完全相同的客户端/配置调一次五系统生成。

用途：当 UI 出现 blocked 0/6 时，独立复现 LLM 路径，把失败原因打到终端。
不依赖 dotenv 包：手动加载根目录 .env 与 slide-rule-python/.env（已有环境变量优先）。

用法（Windows PowerShell）：
    cd slide-rule-python
    .venv\\Scripts\\python scripts\\llm_smoke.py "智能财务自动化办公系统"

用法（macOS/Linux）：
    cd slide-rule-python
    .venv/bin/python scripts/llm_smoke.py "智能财务自动化办公系统"
"""

import os
import sys
import time
from pathlib import Path

_PY_DIR = Path(__file__).resolve().parent.parent
_ROOT = _PY_DIR.parent
sys.path.insert(0, str(_PY_DIR))

from stdio_utf8 import configure_stdio_utf8

configure_stdio_utf8()


def _load_env_file(path: Path) -> int:
    """Minimal .env loader — KEY=VALUE lines, existing os.environ wins."""
    loaded = 0
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return 0
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
            loaded += 1
    return loaded


def main() -> int:
    goal = sys.argv[1] if len(sys.argv) > 1 else "智能财务自动化办公系统"
    n_root = _load_env_file(_ROOT / ".env")
    n_py = _load_env_file(_PY_DIR / ".env")
    print(f"[smoke] env loaded: root .env={n_root} vars, slide-rule-python/.env={n_py} vars")
    print(f"[smoke] LLM_BASE_URL={os.environ.get('LLM_BASE_URL', '(unset)')}")
    print(f"[smoke] LLM_MODEL={os.environ.get('LLM_MODEL', '(unset)')}")
    print(f"[smoke] LLM_API_KEY={'set(' + str(len(os.environ.get('LLM_API_KEY', ''))) + ' chars)' if os.environ.get('LLM_API_KEY') else '(unset)'}")
    print(f"[smoke] SLIDERULE_LLM_GENERATE_ENABLED={os.environ.get('SLIDERULE_LLM_GENERATE_ENABLED', '(unset)')}")
    print(f"[smoke] HTTP_PROXY={os.environ.get('HTTP_PROXY', '(unset)')}  NO_PROXY={os.environ.get('NO_PROXY', '(unset)')}")
    print(f"[smoke] goal={goal}")
    print("[smoke] calling generate_five_system_model (same path as the app; may take 1-3 min)...")

    from services.v5_llm_generate import generate_five_system_model, get_generate_diagnostic  # noqa: E402
    import services.v5_llm_generate as _gen  # noqa: E402

    t0 = time.time()
    model = generate_five_system_model(goal)
    elapsed = time.time() - t0

    if model is not None:
        from services.v5_model_gate import validate_five_system_model  # noqa: E402

        gate = validate_five_system_model(model)
        print(f"[smoke] LLM OK in {elapsed:.1f}s — sections: {sorted(model.keys())}")
        print(f"[smoke] structural gate: {'PASSED' if gate.get('passed') else 'BLOCKED'}")
        if not gate.get("passed"):
            for finding in (gate.get("findings") or [])[:5]:
                print(f"[smoke]   gate finding: {finding}")
            return 2
        entities = (model.get("datamodel") or {}).get("entities") or []
        print(f"[smoke] datamodel entities: {[e.get('id') for e in entities]}")
        print("[smoke] RESULT: PASS — the app's LLM path should close 6/6 for this goal.")
        return 0

    diag = get_generate_diagnostic()
    print(f"[smoke] LLM FAILED in {elapsed:.1f}s")
    print(f"[smoke] diagnostic: {diag}")
    print("[smoke] RESULT: FAIL — 把上面 diagnostic 一行发给协作者即可定位。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
