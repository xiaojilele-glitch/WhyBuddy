import { describe, it, expect } from "vitest";
import {
  initRuntimeState,
  addRow,
  updateRow,
  deleteRow,
  validateRowValues,
  startNodeId,
  outgoingTransitions,
  startInstance,
  advanceInstance,
  applyHtmlWorkflowAction,
} from "../live-runtime/live-runtime";
import type { FiveSystemModel } from "../system-screens/five-system-model";

const NOW = "2026-07-08T00:00:00Z";

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "expense_claim",
        name: "费用报销单",
        fields: [
          { id: "title", name: "标题", type: "string" },
          { id: "amount", name: "金额", type: "number" },
        ],
      },
    ],
  },
  rbac: { roles: ["employee", "manager", "finance"], permissions: [], menus: [] },
  workflow: {
    id: "wf_expense",
    nodes: [
      { id: "submit", name: "提交报销", assigneeRole: "employee" },
      { id: "mgr", name: "经理审批", assigneeRole: "manager" },
      { id: "fin", name: "财务打款", assigneeRole: "finance" },
      { id: "rework", name: "退回修改", assigneeRole: "employee" },
    ],
    transitions: [
      { from: "submit", to: "mgr" },
      { from: "mgr", to: "fin", condition: "金额合规" },
      { from: "mgr", to: "rework", condition: "需要修改" },
      { from: "rework", to: "mgr" },
    ],
  },
};

describe("live-runtime · 行 CRUD（动态表浏览器版）", () => {
  it("init 从模型建空实体表；addRow/updateRow/deleteRow 全程不可变", () => {
    const s0 = initRuntimeState(MODEL);
    expect(s0.entities.expense_claim).toEqual([]);

    const { state: s1, row } = addRow(s0, "expense_claim", { title: "打车", amount: 30 }, NOW);
    expect(s1.entities.expense_claim).toHaveLength(1);
    expect(s0.entities.expense_claim).toHaveLength(0); // 不可变

    const s2 = updateRow(s1, "expense_claim", row.id, { amount: 45 });
    expect(s2.entities.expense_claim[0].values.amount).toBe(45);
    expect(s2.entities.expense_claim[0].values.title).toBe("打车"); // merge 不丢字段

    const s3 = deleteRow(s2, "expense_claim", row.id);
    expect(s3.entities.expense_claim).toHaveLength(0);
  });

  it("validateRowValues：number 字段非数字如实报错", () => {
    expect(validateRowValues(MODEL, "expense_claim", { amount: "abc" })).toHaveLength(1);
    expect(validateRowValues(MODEL, "expense_claim", { amount: "42" })).toEqual([]);
    expect(validateRowValues(MODEL, "no_such_entity", {})).toEqual([]);
  });
});

describe("live-runtime · 审批状态机（语义对齐引擎 moveToNextNode）", () => {
  it("起点 = 无入边节点；出边查询正确", () => {
    expect(startNodeId(MODEL)).toBe("submit");
    expect(outgoingTransitions(MODEL, "mgr")).toHaveLength(2);
    expect(startNodeId({})).toBeNull();
  });

  it("单出边 approve 自动推进；无出边 approve 即 completed", () => {
    let { state, instance } = startInstance(initRuntimeState(MODEL), MODEL, "报销-1", NOW);
    expect(instance!.currentNodeId).toBe("submit");

    ({ state } = advanceInstance(state, MODEL, instance!.id, "approve", NOW, { byRole: "employee" }));
    expect(state.instances[0].currentNodeId).toBe("mgr");

    // mgr 有两条出边：不选分支必须报错（不静默走错路）
    const branchless = advanceInstance(state, MODEL, instance!.id, "approve", NOW, { byRole: "manager" });
    expect(branchless.error).toContain("分支");

    ({ state } = advanceInstance(state, MODEL, instance!.id, "approve", NOW, {
      byRole: "manager",
      viaTransitionIndex: 0, // 金额合规 → fin
    }));
    expect(state.instances[0].currentNodeId).toBe("fin");

    ({ state } = advanceInstance(state, MODEL, instance!.id, "approve", NOW, { byRole: "finance" }));
    expect(state.instances[0].status).toBe("completed");
    expect(state.instances[0].log.map((l) => l.action)).toEqual([
      "start",
      "approve",
      "approve",
      "approve",
      "complete",
    ]);
  });

  it("reject 即终态；终态实例不可再推进", () => {
    let { state, instance } = startInstance(initRuntimeState(MODEL), MODEL, "报销-2", NOW);
    ({ state } = advanceInstance(state, MODEL, instance!.id, "reject", NOW, { byRole: "employee" }));
    expect(state.instances[0].status).toBe("rejected");
    const after = advanceInstance(state, MODEL, instance!.id, "approve", NOW);
    expect(after.error).toContain("终态");
  });

  it("回环分支可走通（mgr → rework → mgr）", () => {
    let { state, instance } = startInstance(initRuntimeState(MODEL), MODEL, "报销-3", NOW);
    ({ state } = advanceInstance(state, MODEL, instance!.id, "approve", NOW)); // submit→mgr
    ({ state } = advanceInstance(state, MODEL, instance!.id, "approve", NOW, { viaTransitionIndex: 1 })); // mgr→rework
    expect(state.instances[0].currentNodeId).toBe("rework");
    ({ state } = advanceInstance(state, MODEL, instance!.id, "approve", NOW)); // rework→mgr（单出边）
    expect(state.instances[0].currentNodeId).toBe("mgr");
  });
});

describe("live-runtime · HTML 页转移动作（2026-08-14 晚：工作流那只手）", () => {
  /**
   * 钉住的都是断掉会**静默**失效的行为：
   *   ① 提交挂在具体那条记录上（entityRef）；同一行重复提交被如实拒绝
   *   ② 角色把关 fail-closed：当前节点声明了 assigneeRole，别的角色批不了，
   *      拒绝话术把"该谁处理"说清楚
   *   ③ 分支不猜走向，如实指去工作流试运行面
   *   ④ ok=false 时 state 原样返回——拒绝不能顺手改了状态
   */
  const seeded = () => {
    const { state } = addRow(initRuntimeState(MODEL), "expense_claim",
      { title: "打车费", amount: 42 }, NOW);
    return state;
  };
  const rowIdOf = (s: ReturnType<typeof seeded>) => s.entities.expense_claim[0].id;

  it("submitWorkflow：起实例挂当前行；同一行重复提交被拒", () => {
    const s0 = seeded();
    const ev = { kind: "submitWorkflow", entityId: "expense_claim", rowId: rowIdOf(s0) };
    const r1 = applyHtmlWorkflowAction(s0, MODEL, ev, "employee", NOW);
    expect(r1.ok).toBe(true);
    expect(r1.state.instances).toHaveLength(1);
    expect(r1.state.instances[0].entityRef).toEqual({
      entityId: "expense_claim",
      rowId: rowIdOf(s0),
    });
    expect(r1.message).toContain("打车费"); // 标题取行首列值，不是行 id

    const r2 = applyHtmlWorkflowAction(r1.state, MODEL, ev, "employee", NOW);
    expect(r2.ok).toBe(false);
    expect(r2.message).toContain("重复提交");
    expect(r2.state).toBe(r1.state); // 拒绝不改状态
  });

  it("approveWorkflow：角色对得上才推得动；对不上如实说该谁处理", () => {
    const s0 = seeded();
    const ev = { kind: "submitWorkflow", entityId: "expense_claim", rowId: rowIdOf(s0) };
    const { state: s1 } = applyHtmlWorkflowAction(s0, MODEL, ev, "employee", NOW);

    // 起点节点 submit 的 assigneeRole 是 employee——manager 批不了
    const wrong = applyHtmlWorkflowAction(
      s1, MODEL,
      { kind: "approveWorkflow", entityId: "expense_claim", rowId: rowIdOf(s0) },
      "manager", NOW
    );
    expect(wrong.ok).toBe(false);
    expect(wrong.message).toContain("employee");

    const right = applyHtmlWorkflowAction(
      s1, MODEL,
      { kind: "approveWorkflow", entityId: "expense_claim", rowId: rowIdOf(s0) },
      "employee", NOW
    );
    expect(right.ok).toBe(true);
    expect(right.state.instances[0].currentNodeId).toBe("mgr");
  });

  it("分支节点不猜走向，如实指去工作流试运行面", () => {
    const s0 = seeded();
    const rid = rowIdOf(s0);
    let { state } = applyHtmlWorkflowAction(
      s0, MODEL, { kind: "submitWorkflow", entityId: "expense_claim", rowId: rid },
      "employee", NOW);
    ({ state } = applyHtmlWorkflowAction(
      state, MODEL, { kind: "approveWorkflow", entityId: "expense_claim", rowId: rid },
      "employee", NOW)); // submit→mgr（单出边）
    const branch = applyHtmlWorkflowAction(
      state, MODEL, { kind: "approveWorkflow", entityId: "expense_claim", rowId: rid },
      "manager", NOW); // mgr 有两条出边
    expect(branch.ok).toBe(false);
    expect(branch.message).toContain("试运行");
  });

  it("rejectWorkflow 即终态；没有进行中的流程时如实说", () => {
    const s0 = seeded();
    const rid = rowIdOf(s0);
    const noInst = applyHtmlWorkflowAction(
      s0, MODEL, { kind: "rejectWorkflow", entityId: "expense_claim", rowId: rid },
      "employee", NOW);
    expect(noInst.ok).toBe(false);
    expect(noInst.message).toContain("先提交审批");

    const { state: s1 } = applyHtmlWorkflowAction(
      s0, MODEL, { kind: "submitWorkflow", entityId: "expense_claim", rowId: rid },
      "employee", NOW);
    const r = applyHtmlWorkflowAction(
      s1, MODEL, { kind: "rejectWorkflow", entityId: "expense_claim", rowId: rid },
      "employee", NOW);
    expect(r.ok).toBe(true);
    expect(r.state.instances[0].status).toBe("rejected");
  });
});
