"""跑一个全新话题的完整链路，并把**参考图**落盘，供跟真实渲染做对比。

链路跟 v5_capability_executor 里**老链路那一支**一模一样，一步不减：
    generate_five_system_model → validate_five_system_model
    → enrich_identity_theme → enrich_freeform_blocks → enrich_monitor_page_overviews

⚠ 2026-08-14 起这句话只对**老链路**成立。主轴现在先试 spec-first 七步
（默认开），走通了就**跳过两段 enrich_***——版式来自第 3 步的真 HTML，
再 enrich 一遍等于把画好的页面重做一次（架构图 ⚑⚑B）。
本脚本仍然无条件跑 enrich，因为它的用途就是给**老链路**落参考图做对比；
但**别再把它当成"主轴现在长什么样"的样本**，那是它 08-14 之前的身份。

参考图在生产路径上是**刻意不落盘**的（`_generate_reference_image_b64` 的
docstring 写得很清楚：图上的"数字"都是占位假象，不能当真实数据源，也不该
展示给终端用户）。这里用一个只在本脚本内生效的包装把它另存一份——是验证
用的钩子，不改生产行为。

用法：
    cd slide-rule-python
    .venv/bin/python scripts/fresh_topic_shot.py "<话题>" <输出目录>
"""

import base64
import json
import struct
import os
import sys
import time
from pathlib import Path

_PY_DIR = Path(__file__).resolve().parent.parent
_ROOT = _PY_DIR.parent
sys.path.insert(0, str(_PY_DIR))


def _load_env_file(path: Path) -> int:
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
    if len(sys.argv) < 3:
        raise SystemExit('usage: fresh_topic_shot.py "<话题>" <输出目录>')
    intent = sys.argv[1]
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    _load_env_file(_ROOT / ".env")

    from services import freeform_block
    from services.v5_llm_generate import generate_five_system_model
    from services.v5_model_gate import validate_five_system_model

    # ── 生图落盘钩子（只在本脚本内生效）────────────────────────────
    # 两个入口都要钩：
    #   _generate_overview_sheet_b64   → 三区参照板（桌面+手机+样式，两档共用）
    #   _generate_reference_image_b64  → 单个区块的参照图
    # 只钩后者会漏掉参照板，而那正是最近改动集中的地方。
    shots: list[Path] = []

    def _hook(name: str, tag: str):
        original = getattr(freeform_block, name)

        def _capture(*args, **kwargs):
            b64 = original(*args, **kwargs)
            if b64:
                data = base64.b64decode(b64)
                p = out_dir / f"{tag}-{len([x for x in shots if x.name.startswith(tag)]) + 1}.png"
                p.write_bytes(data)
                shots.append(p)
                # 从 PNG 头读真实宽高——请求尺寸不等于返回尺寸
                w, h = struct.unpack(">II", data[16:24])
                print(f"[fresh] {tag} saved: {p}  {w}x{h}  {len(data) // 1024}KB")
            else:
                print(f"[fresh] {tag} unavailable (生图降级，主链路继续)")
            return b64

        setattr(freeform_block, name, _capture)

    _hook("_generate_overview_sheet_b64", "sheet")
    _hook("_generate_reference_image_b64", "reference")

    print(f"[fresh] intent: {intent}")
    t0 = time.time()
    model = generate_five_system_model(intent)
    if not model:
        raise SystemExit("[fresh] 五系统模型生成失败（LLM 返回 None）")
    print(f"[fresh] five-system model in {time.time() - t0:.1f}s")

    gate = validate_five_system_model(model)
    findings = gate.get("findings") or []
    print(f"[fresh] gate passed={gate.get('passed')} findings={len(findings)}")
    for f in findings[:5]:
        print(f"[fresh]   {f.get('path')}: {f.get('message')}")

    try:
        from services.identity_theme_gen import enrich_identity_theme

        model = enrich_identity_theme(model, intent)
        theme = ((model.get("appbundle") or {}).get("appIdentity") or {}).get("generatedTheme")
        print(f"[fresh] identity theme: {(theme or {}).get('label')} primary={(theme or {}).get('primary')}")
    except Exception as exc:  # noqa: BLE001
        print(f"[fresh] identity theme skipped: {str(exc)[:160]}")

    t1 = time.time()
    model = freeform_block.enrich_freeform_blocks(model)
    model = freeform_block.enrich_monitor_page_overviews(model)
    print(f"[fresh] freeform enrichment in {time.time() - t1:.1f}s")

    model_path = out_dir / "model.json"
    model_path.write_text(json.dumps(model, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[fresh] model saved: {model_path}")

    # 产出概览：哪些页拿到了 LLM 设计的总览、里面有几处环比
    def _walk(n):
        yield n
        for c in n.get("children") or []:
            yield from _walk(c)

    for page in (model.get("page") or {}).get("pages") or []:
        ov = page.get("freeformOverview")
        if not isinstance(ov, dict) or not ov.get("root"):
            continue
        nodes = list(_walk(ov["root"]))
        trends = [n for n in nodes if (n.get("dataRef") or {}).get("trendFieldRef")]
        print(
            f"[fresh] page {page.get('id')} ({page.get('kind')}): "
            f"nodes={len(nodes)} trend={len(trends)}"
        )

    # 色板体检——最终产出，等于给 palette_guard 做验收
    from services.palette_guard import extract_hex_colors, palette_report

    identity = (model.get("appbundle") or {}).get("appIdentity") or {}
    hint = freeform_block._theme_palette(
        str(identity.get("theme") or ""), identity.get("generatedTheme")
    )
    palette = [hint["primary"], *hint["charts"]]
    rep = palette_report(extract_hex_colors(model.get("page")), palette, hint["primary"])
    print(
        f"[fresh] palette: non_neutral={rep.non_neutral} primary={rep.primary_uses} "
        f"dominant={rep.dominant_uses} hue_ok={rep.hue_ok} primary_ok={rep.primary_ok}"
    )
    if rep.off_palette:
        print(f"[fresh]   off-palette 残留: {rep.off_palette[:6]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
