"""第 5 步三臂对照：那条"两个输入都要"的边，正面验一次。

    B 路  SPEC + 结构   两个都给（提案）
    S 路  只有 SPEC     少了结构 → 该出悬空引用
    H 路  只有结构      少了 SPEC → 该退回行业常识

⚠ 三臂共用同一个校验器、同一个模型、同一份输入数据，唯一变量是喂什么。
判据是**机械可查的两个数**，不是我看着觉得好：

    角色可溯率 = personaRef 指得到 SPEC persona 的角色 / 全部角色
    悬空引用数 = 指不到实体/字段/角色/节点的 ref 数

⚠ 关掉一侧时**不能用 derive_semantics**——它内部会拿两侧做校验并重问，
等于偷偷把关掉的那侧又喂回去了。所以这里直接调 LLM 拿原始产出，
再统一用同一把尺子量。
"""
import json, os, pathlib, sys, time
_PY = pathlib.Path("/home/user/WhyBuddy/slide-rule-python")
sys.path.insert(0, str(_PY))
for l in (_PY.parent / ".env").read_text(encoding="utf-8").splitlines():
    l = l.strip()
    if l and not l.startswith("#") and "=" in l:
        k, _, v = l.partition("="); os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
os.environ["SLIDERULE_SESSION_LOCAL_IMPORT"] = "0"

from services.spec_semantics import build_prompt, SpecSemantics  # noqa: E402
from sliderule_llm.client import call_llm_json  # noqa: E402

S = pathlib.Path("/tmp/claude-0/-home-user-WhyBuddy/8eb18365-d2f0-5192-aab8-d1abdb0dfb09/scratchpad/run14")
spec = json.loads((S / "spec.json").read_text(encoding="utf-8"))
structure = json.loads((S / "structure_v2.json").read_text(encoding="utf-8"))

persona_ids = {p["id"] for p in spec["personas"]}
entities = {e["id"]: e for e in structure["entities"]}
valid_refs = set(entities)
for eid, e in entities.items():
    for f in e["fields"]:
        valid_refs.add(f"{eid}.{f['id']}")


def measure(raw: dict) -> dict:
    """同一把尺子量三臂。宽容解析——关掉一侧时产出多半过不了 Pydantic。"""
    roles = raw.get("roles") or []
    role_ids = {r.get("id") for r in roles}
    nodes = raw.get("workflowNodes") or raw.get("workflow", {}).get("nodes") or []
    node_ids = {n.get("id") for n in nodes}
    ok_refs = valid_refs | role_ids | node_ids

    traced = sum(1 for r in roles if r.get("personaRef") in persona_ids)
    perms = raw.get("permissions") or []
    bad_obj = [p for p in perms if isinstance(p, str) and p.split(":")[0] not in entities]
    dangling = [ref for inv in (raw.get("invariants") or [])
                for ref in (inv.get("refs") or []) if ref not in ok_refs]
    bad_role = [n.get("id") for n in nodes if n.get("assigneeRole") not in role_ids]
    return {
        "角色": len(roles), "可溯": traced,
        "可溯率": f"{traced/len(roles)*100:.0f}%" if roles else "—",
        "权限": len(perms), "对象编的": len(bad_obj),
        "不变式": len(raw.get("invariants") or []),
        "悬空引用": len(dangling),
        "节点": len(nodes), "指错角色的节点": len(bad_role),
        "_样本": (bad_obj[:2], dangling[:3]),
    }


ARMS = [("B 两个都给", True, True), ("S 只有SPEC", True, False), ("H 只有结构", False, True)]
rows = {}
for tag, ws, wst in ARMS:
    t = time.time()
    msgs = build_prompt(structure, spec, with_spec=ws, with_structure=wst)
    try:
        payload, _ = call_llm_json(msgs, temperature=0.2)
    except Exception as exc:
        print(f"{tag}: 调用失败 {str(exc)[:120]}"); continue
    m = measure(payload if isinstance(payload, dict) else {})
    m["秒"] = round(time.time() - t)
    rows[tag] = m
    (S / f"sem_{tag.split()[0]}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{tag}: {m['秒']}s", flush=True)

print(f"\n{'臂':<12}{'角色':>5}{'可溯':>5}{'可溯率':>7}{'权限':>5}{'对象编的':>7}"
      f"{'不变式':>6}{'悬空引用':>7}{'节点':>5}{'指错角色':>7}")
for tag, m in rows.items():
    print(f"{tag:<12}{m['角色']:>5}{m['可溯']:>5}{m['可溯率']:>7}{m['权限']:>5}"
          f"{m['对象编的']:>7}{m['不变式']:>6}{m['悬空引用']:>7}{m['节点']:>5}{m['指错角色的节点']:>7}")
print()
for tag, m in rows.items():
    bo, dr = m["_样本"]
    if bo or dr:
        print(f"{tag} 的坏样本：编的对象 {bo}  悬空引用 {dr}")
