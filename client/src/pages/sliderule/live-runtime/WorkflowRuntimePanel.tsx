/**
 * WorkflowRuntimePanel — 工作流「试运行」面（浏览器运行时 M0）。
 *
 * 像 ECharts 渲染图表一样，把模型 workflow 段渲染成一个可操作的审批流：
 * 发起实例 → 按当前节点的 assigneeRole 通过/驳回 → 分支时选择走向 → 终态 + 全程日志。
 * 状态零后端：内存 + localStorage（按 sessionId 隔离），模型换话题自动重建。
 */

import React from "react";
import { Button, Card, Flex, List, Radio, Steps, Tag, Typography } from "antd";
import { CheckOutlined, CloseOutlined, PlayCircleOutlined } from "@ant-design/icons";
import type { FiveSystemModel } from "../system-screens/five-system-model";
import {
  type RuntimeState,
  type WorkflowInstance,
  initRuntimeState,
  startInstance,
  advanceInstance,
  outgoingTransitions,
  nodeById,
} from "./live-runtime";
import { loadRuntimeState, saveRuntimeState, notifyRuntimeChanged, subscribeRuntimeChanged } from "./runtime-persistence";
import { seedRuntimeState } from "./demo-seed";

/** 持久化状态若引用了当前模型不存在的节点（换话题遗留），重建。 */
function compatibleWithModel(state: RuntimeState, model: FiveSystemModel): boolean {
  const nodeIds = new Set((model.workflow?.nodes ?? []).map((n) => n.id));
  return state.instances.every((i) => nodeIds.has(i.currentNodeId));
}

function StatusPill({ status }: { status: WorkflowInstance["status"] }) {
  const label = { running: "进行中", completed: "已完成", rejected: "已驳回" }[status];
  return <Tag color={status === "running" ? "blue" : status === "completed" ? "success" : "error"}>{label}</Tag>;
}

export function WorkflowRuntimePanel({
  model,
  sessionId,
}: {
  model: FiveSystemModel;
  sessionId: string;
}) {
  const [state, setState] = React.useState<RuntimeState>(() => {
    const persisted = loadRuntimeState(sessionId);
    // 演示种子同样过一遍（只铺空实体，幂等）——三个面板共享一份状态，
    // 这里如果存回一份没种子的，运行应用那边就再也铺不上了。
    return seedRuntimeState(
      persisted && compatibleWithModel(persisted, model)
        ? persisted
        : initRuntimeState(model),
      model
    );
  });
  const [branchChoice, setBranchChoice] = React.useState(0);

  // 与应用运行屏共享一份状态：对方（如页面表单提交发起实例）变更时重载
  React.useEffect(
    () =>
      subscribeRuntimeChanged(sessionId, () => {
        const persisted = loadRuntimeState(sessionId);
        if (persisted && compatibleWithModel(persisted, model)) setState(persisted);
      }),
    [sessionId, model]
  );

  const apply = (next: RuntimeState) => {
    setState(next);
    saveRuntimeState(sessionId, next);
    notifyRuntimeChanged(sessionId);
  };

  const latest = state.instances.at(-1) ?? null;
  const running = latest?.status === "running" ? latest : null;
  const currentNode = running ? nodeById(model, running.currentNodeId) : null;
  const branches = running ? outgoingTransitions(model, running.currentNodeId) : [];

  const handleStart = () => {
    const { state: next } = startInstance(
      state,
      model,
      `试运行实例 ${state.instances.length + 1}`,
      new Date().toISOString()
    );
    setBranchChoice(0);
    apply(next);
  };

  const handleAdvance = (action: "approve" | "reject") => {
    if (!running) return;
    const { state: next, error } = advanceInstance(
      state,
      model,
      running.id,
      action,
      new Date().toISOString(),
      { byRole: currentNode?.assigneeRole, viaTransitionIndex: branchChoice }
    );
    if (!error) {
      setBranchChoice(0);
      apply(next);
    }
  };

  const nodeName = (id: string) => nodeById(model, id)?.name || id;
  const logTitle = (log: WorkflowInstance["log"][number]) => {
    if (log.action === "start") return `发起 · 停在「${nodeName(log.nodeId)}」`;
    if (log.action === "approve")
      return `「${nodeName(log.nodeId)}」通过${log.byRole ? ` · @${log.byRole}` : ""}`;
    if (log.action === "reject")
      return `「${nodeName(log.nodeId)}」驳回${log.byRole ? ` · @${log.byRole}` : ""} · 流程终止`;
    return "流程完成 ✓";
  };

  return (
    <Flex vertical gap="middle" className="h-full overflow-auto p-4" data-testid="workflow-runtime-panel">
      {/* 当前实例操作区 */}
      {running && currentNode ? (
        <Card size="small" title={running.title} extra={<StatusPill status={running.status} />}>
          <Flex vertical gap="middle">
            <Flex align="center" gap="small" wrap>
              <Typography.Text type="secondary">当前节点</Typography.Text>
              <Tag>{currentNode.name || currentNode.id}</Tag>
            {currentNode.assigneeRole && (
              <Tag color="orange">@{currentNode.assigneeRole}</Tag>
            )}
            </Flex>
          {branches.length > 1 && (
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              value={branchChoice}
              onChange={event => setBranchChoice(event.target.value)}
              options={branches.map((b, i) => ({
                value: i,
                label: `${b.condition || nodeName(b.to)} → ${nodeName(b.to)}`,
              }))}
            />
          )}
          <Flex gap="small">
            <Button
              type="primary"
              icon={<CheckOutlined />}
              onClick={() => handleAdvance("approve")}
              data-testid="runtime-approve"
            >
              通过（{currentNode.assigneeRole || "当前角色"}）
            </Button>
            <Button
              danger
              icon={<CloseOutlined />}
              onClick={() => handleAdvance("reject")}
              data-testid="runtime-reject"
            >
              驳回
            </Button>
          </Flex>
          </Flex>
        </Card>
      ) : (
        <Card size="small">
          <Flex vertical align="start" gap="middle">
            <Typography.Text type="secondary">
            这是模型驱动的真实状态机：发起一个实例，按节点审批人逐步推进，走完整个业务闭环。
            </Typography.Text>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleStart}
            data-testid="runtime-start"
          >
            发起实例
          </Button>
          </Flex>
        </Card>
      )}

      {/* 实例列表 + 日志 */}
      {state.instances.length > 0 && (
        <Card size="small" title="实例与日志">
          <List
            size="small"
            dataSource={[...state.instances].reverse()}
            renderItem={inst => (
              <List.Item key={inst.id}>
                <Flex vertical gap="small" style={{ width: "100%" }}>
                  <Flex align="center" gap="small">
                    <Typography.Text strong>{inst.title}</Typography.Text>
                  <StatusPill status={inst.status} />
                  </Flex>
                  <Steps
                    size="small"
                    direction="vertical"
                    items={inst.log.map((l, i) => ({
                      key: String(i),
                      title: logTitle(l),
                    }))}
                  />
                </Flex>
              </List.Item>
            )}
          />
        </Card>
      )}
    </Flex>
  );
}
