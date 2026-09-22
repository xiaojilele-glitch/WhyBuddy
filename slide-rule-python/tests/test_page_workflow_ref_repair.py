"""appbundle.pageBindings[].workflowRef 的确定性修复（2026-08-10 度量驱动）。

背景：度量台（scripts/block_selection_metrics.py）在 control 臂 10 趟里量到，
首轮过闸失败最大的一族就是这个字段——合法取值其实只有 workflow.id + 各
chains[].id（通常 1~4 个），而模型把它当成"这一页属于哪个流程"的自由文本，
一页编一个：写工作流**节点** id、凭空造名字、甚至直接抄 pageRef。

修复策略（见 _repair_page_workflow_refs 头注）：
  1. 先试唯一近邻——真是拼错就改对；
  2. 修不好且该页不是 wizard → **摘掉**这个可选字段（删掉一句已证伪的话，
     不是猜它属于哪条流程）；
  3. 该页是 wizard → 一个字都不动，让门硬拦（摘了会变成"假向导"）。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.v5_model_repair import repair_five_system_model


def _model(page_bindings, *, pages=None, chains=("policy_governance",)):
    return {
        "datamodel": {"entities": [{"id": "alert", "name": "告警", "fields": []}]},
        "rbac": {"roles": [{"id": "ops", "name": "运维"}], "permissions": [], "menus": []},
        "workflow": {
            "id": "alert_lifecycle",
            "name": "告警生命周期",
            "nodes": [{"id": "alert_acknowledged", "name": "已确认", "assigneeRole": "ops"}],
            "transitions": [],
            "chains": [
                {"id": cid, "name": cid, "kind": "governance", "nodes": [], "transitions": []}
                for cid in chains
            ],
        },
        "page": {
            "pages": pages
            or [
                {"id": "alert_monitor", "name": "总览", "kind": "monitor"},
                {"id": "alert_queue", "name": "队列", "kind": "workbench"},
            ]
        },
        "aigc": {},
        "appbundle": {"pageBindings": page_bindings, "landingPageRef": "alert_monitor"},
    }


def _bindings(result):
    return result["model"]["appbundle"]["pageBindings"]


def _ref_of(result, page_ref):
    for bd in _bindings(result):
        if bd.get("pageRef") == page_ref:
            return bd.get("workflowRef", "<absent>")
    raise AssertionError(f"pageBinding {page_ref} 不见了——修复不该删整条绑定")


# ── 合法的一律不动 ──────────────────────────────────────────────────────────


def test_合法的主流程_id_不动():
    r = repair_five_system_model(
        _model([{"pageRef": "alert_monitor", "workflowRef": "alert_lifecycle"}])
    )
    assert _ref_of(r, "alert_monitor") == "alert_lifecycle"
    assert not (r.get("pageWorkflowRefs") or {}), "没错的东西不该产生修复记录"


def test_合法的_chain_id_不动():
    r = repair_five_system_model(
        _model([{"pageRef": "alert_queue", "workflowRef": "policy_governance"}])
    )
    assert _ref_of(r, "alert_queue") == "policy_governance"


def test_压根没写_workflowRef_不动():
    """可选字段，缺省是正常状态，不该被"补"上一个。"""
    r = repair_five_system_model(_model([{"pageRef": "alert_queue"}]))
    assert _ref_of(r, "alert_queue") == "<absent>"
    assert not (r.get("pageWorkflowRefs") or {})


# ── 三种真实错法 ────────────────────────────────────────────────────────────


def test_节点_id_是合法的_不许摘():
    """节点 id **也是**合法 workflowRef——门禁 _collect_workflow_ids 的原文：
    "referenced by its top-level id, chain ids, and/or node ids"。

    这条是回归哨兵：本修复第一版自己算了一份合法域（只认 workflow.id +
    chains[].id），比门更严，于是把门放行的节点引用摘掉了，弄红三条既有用例。
    合法域必须取自门那一份。
    """
    r = repair_five_system_model(
        _model([{"pageRef": "alert_queue", "workflowRef": "alert_acknowledged"}])
    )
    assert _ref_of(r, "alert_queue") == "alert_acknowledged"
    assert not (r.get("pageWorkflowRefs") or {}), "门放行的引用不该产生修复动作"


def test_抄了_pageRef_被摘掉():
    r = repair_five_system_model(
        _model([{"pageRef": "alert_queue", "workflowRef": "alert_queue"}])
    )
    assert _ref_of(r, "alert_queue") == "<absent>"


def test_凭空造的名字被摘掉():
    r = repair_five_system_model(
        _model([{"pageRef": "alert_queue", "workflowRef": "oncall_shifts"}])
    )
    assert _ref_of(r, "alert_queue") == "<absent>"


def test_摘掉的是字段_不是整条绑定():
    """pageRef 那一半是对的，不能连带删掉——否则页面就没了 appbundle 绑定。"""
    r = repair_five_system_model(
        _model([{"pageRef": "alert_queue", "workflowRef": "oncall_shifts"}])
    )
    assert len(_bindings(r)) == 1
    assert _bindings(r)[0]["pageRef"] == "alert_queue"


# ── 拼错 → 唯一近邻改对，不浪费信息 ────────────────────────────────────────


def test_拼错的近邻被改对而不是摘掉():
    r = repair_five_system_model(
        _model([{"pageRef": "alert_monitor", "workflowRef": "alert_lifecycl"}])
    )
    assert _ref_of(r, "alert_monitor") == "alert_lifecycle"
    repaired = (r["pageWorkflowRefs"] or {}).get("repaired") or []
    assert repaired and repaired[0]["to"] == "alert_lifecycle"


# ── wizard 页：一个字都不许动 ───────────────────────────────────────────────


def test_wizard_页的错引用不摘_留给门硬拦():
    """向导页 workflowRef 是必填：摘掉就从"引用错了"变成"假向导"（渲染器没步骤可画）。"""
    pages = [
        {"id": "alert_monitor", "name": "总览", "kind": "monitor"},
        {"id": "onboard_wizard", "name": "接入向导", "kind": "wizard"},
    ]
    r = repair_five_system_model(
        _model(
            [{"pageRef": "onboard_wizard", "workflowRef": "totally_unrelated_xyz"}],
            pages=pages,
        )
    )
    assert _ref_of(r, "onboard_wizard") == "totally_unrelated_xyz", "wizard 页不得被摘"
    assert not ((r.get("pageWorkflowRefs") or {}).get("dropped") or [])


# ── 没有工作流时不乱来 ──────────────────────────────────────────────────────


def test_没有任何合法工作流_id_时原样返回():
    """合法域为空时不该把字段摘光——那是另一种病，交给门。

    合法域比想象的宽，要清干净得清四处：workflow.id、chains、nodes，**以及
    workflow.name**——门那个函数取的是 `id or name`，所以显示名也算合法
    workflowRef。这条测试前两版分别漏了 nodes 和 name，各自红了一次。
    """
    m = _model([{"pageRef": "alert_queue", "workflowRef": "whatever"}], chains=())
    m["workflow"]["id"] = ""
    m["workflow"]["name"] = ""
    m["workflow"]["nodes"] = []
    r = repair_five_system_model(m)
    assert _ref_of(r, "alert_queue") == "whatever"


# ── 纯函数 ──────────────────────────────────────────────────────────────────


def test_不改入参():
    m = _model([{"pageRef": "alert_queue", "workflowRef": "oncall_shifts"}])
    repair_five_system_model(m)
    assert m["appbundle"]["pageBindings"][0]["workflowRef"] == "oncall_shifts"


def test_没有_invariants_也会跑这条修复():
    """回归：这条修复一度排在 invariants 的提前 return 之后，于是对没有
    invariants 的模型永不生效——而实测失败的那几趟正是这种。"""
    m = _model([{"pageRef": "alert_queue", "workflowRef": "oncall_shifts"}])
    assert not m["appbundle"].get("invariants")
    r = repair_five_system_model(m)
    assert _ref_of(r, "alert_queue") == "<absent>"
