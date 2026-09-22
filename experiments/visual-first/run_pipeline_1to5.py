"""1→4 全链路跑一遍，换全新话题。

    1 澄清+缺口+证据      现成能力（这里用 retrieve_evidence 那一段）
    2 起草 SPEC           services/spec_tree.py
    3 spec 每一页 → HTML  services/spec_page_html.py（并发）
  3.5 外壳统一 + 身份锚定  services/page_shell.py（零 LLM）
    4 HTML → 结构         services/html_structure.py

每一步都打印判据结果，不只打印"成功"。
"""

import json
import os
import pathlib
import sys
import time
from concurrent.futures import ThreadPoolExecutor

_PY = pathlib.Path("/home/user/WhyBuddy/slide-rule-python")
sys.path.insert(0, str(_PY))
for _l in (_PY.parent / ".env").read_text(encoding="utf-8").splitlines():
    _l = _l.strip()
    if _l and not _l.startswith("#") and "=" in _l:
        k, _, v = _l.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
os.environ["SLIDERULE_SESSION_LOCAL_IMPORT"] = "0"

from services.html_structure import (  # noqa: E402
    derive_structure, strip_for_schema, to_datamodel, validate_structure,
)
from services.page_shell import check_shell_consistency, unify_shell  # noqa: E402
from services.spec_page_html import generate_pages_parallel  # noqa: E402
from services.spec_tree import generate_spec_tree, spec_to_markdown, validate_spec_tree  # noqa: E402

GOAL = ("做一个二手车经销商的车辆收售管理系统：收车时录入车况和评估价，整备完成后上架，"
        "销售带看和议价成交，还要看每个门店的库存周转天数和毛利")
OUT = pathlib.Path("/tmp/claude-0/-home-user-WhyBuddy/8eb18365-d2f0-5192-aab8-d1abdb0dfb09/scratchpad/run15")
OUT.mkdir(parents=True, exist_ok=True)
T0 = time.time()


def step(n: str) -> float:
    print(f"\n{'='*62}\n{n}\n{'='*62}", flush=True)
    return time.time()


# ── 1 证据 ────────────────────────────────────────────────────────────
t = step("第 1 步：检索外部证据")
from services.rag_service import retrieve_evidence  # noqa: E402

ev = retrieve_evidence(GOAL, top_k=6)
ev_block = "\n".join(f"- {e.get('content','')}（source:{e.get('source','')}）" for e in ev[:3])
print(f"  {time.time()-t:.0f}s  证据 {len(ev)} 条", flush=True)

# ── 2 SPEC ───────────────────────────────────────────────────────────
t = step("第 2 步：起草 SPEC")
spec_model = generate_spec_tree(GOAL, evidence=ev_block)
spec = spec_model.model_dump()
(OUT / "spec.json").write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding="utf-8")
(OUT / "spec.md").write_text(spec_to_markdown(spec_model), encoding="utf-8")
print(f"  {time.time()-t:.0f}s  闸={validate_spec_tree(spec)['passed']}")
print(f"  产品名「{spec['appName']}」  使用者 {[p['name'] for p in spec['personas']]}")
print(f"  判据 {len(spec['successCriteria'])} · 需求 "
      f"{sum(1 for n in spec['nodes'] if n['type']=='requirement')} · 页 {len(spec['pages'])}")
for p in spec["pages"]:
    print(f"    {p['id']} {p['name']}（{p['audience']}）")

# ── 3 每页 HTML ──────────────────────────────────────────────────────
t = step("第 3 步：spec 每一页 → HTML（并发）")
batch = generate_pages_parallel(spec)
pages_html = batch["pages"]
print(f"  {time.time()-t:.0f}s  " + "  ".join(f"{k} {len(v)}字符" for k, v in pages_html.items()))
if batch["failed"]:
    print(f"  ⚠ {len(batch['failed'])} 页失败（其余照常往下走）：{batch['failed']}")

# ── 3.5 外壳统一 ─────────────────────────────────────────────────────
t = step("第 3.5 步：外壳统一 + 身份锚定（零 LLM）")
before = check_shell_consistency(pages_html, spec)
print(f"  统一前 {len(before)} 处问题：")
for p in before[:6]:
    print(f"    ⚠ {p['path']}｜{p['message'][:80]}")
uni = unify_shell(pages_html, spec)
after = check_shell_consistency(uni["pages"], spec)
print(f"  统一后 {len(after)} 处问题 {'✅' if not after else after}")
print(f"  {time.time()-t:.1f}s  appName={uni['appName']} role={uni['personaRole']} 源页={uni['sourcePageId']}")
for pid, h in uni["pages"].items():
    (OUT / f"{pid}.html").write_text(h, encoding="utf-8")

# ── 4 HTML → 结构 ────────────────────────────────────────────────────
t = step("第 4 步：HTML → 实体/字段/关联/页面结构")
raw = sum(len(h) for h in uni["pages"].values())
stripped = sum(len(strip_for_schema(h)) for h in uni["pages"].values())
print(f"  剥噪：{raw} → {stripped} 字符（-{100-stripped/raw*100:.0f}%）", flush=True)
structure = derive_structure(uni["pages"], goal=GOAL)
v = validate_structure(structure.model_dump(), uni["pages"])
print(f"  {time.time()-t:.0f}s  闸+接地={v['passed']}  {v['findings'] if not v['passed'] else ''}")
print(f"  实体 {len(structure.entities)} · 字段 {sum(len(e.fields) for e in structure.entities)} "
      f"· 页面 {len(structure.pages)}")
for e in structure.entities:
    refs = [f.refEntity for f in e.fields if f.type == "ref"]
    print(f"    {e.id:<18} {e.name:<10} {len(e.fields):>2} 字段" + (f"  → {', '.join(refs)}" if refs else ""))
for p in structure.pages:
    print(f"    {p.id:<20} {p.kind:<10} {p.name}｜{' / '.join(p.sections)}")

(OUT / "structure.json").write_text(
    json.dumps({"structure": structure.model_dump(), "datamodel": to_datamodel(structure)},
               ensure_ascii=False, indent=1), encoding="utf-8")
# ── 5 权限/工作流/不变式 ─────────────────────────────────────────────
t = step("第 5 步：(第4步产物 + SPEC) → 权限/工作流/不变式")
from services.spec_semantics import derive_semantics, to_model_sections, validate_semantics  # noqa: E402

st = structure.model_dump()
sem = derive_semantics(st, spec)
v5 = validate_semantics(sem.model_dump(), structure=st, spec=spec)
covered = {r.personaRef for r in sem.roles}
print(f"  {time.time()-t:.0f}s  闸+接地={v5['passed']}  {v5['findings'] if not v5['passed'] else ''}")
print(f"  角色 {len(sem.roles)} / SPEC 使用者 {len(spec['personas'])}  全覆盖={len(covered)==len(spec['personas'])}")
for r in sem.roles:
    print(f"    {r.id:<24} {r.name:<12} ← {r.personaRef}")
print(f"  权限 {len(sem.permissions)} · 节点 {len(sem.workflowNodes)} · 转移 "
      f"{len(sem.workflowTransitions)} · 不变式 {len(sem.invariants)}")
print("  工作流：" + " → ".join(n.name for n in sem.workflowNodes))
for i in sem.invariants[:3]:
    print(f"    {i.id}: {i.statement[:46]}")
(OUT / "semantics.json").write_text(
    json.dumps(to_model_sections(sem), ensure_ascii=False, indent=1), encoding="utf-8")

print(f"\n{'='*62}\n全链路 {time.time()-T0:.0f}s   产物 {OUT}\n{'='*62}")
