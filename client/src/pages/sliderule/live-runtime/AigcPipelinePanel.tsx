/**
 * AigcPipelinePanel — AIGC 屏的「能力编排」视图（编排二期）。
 *
 * 二期升级：链路试跑改走浏览器端图执行器（flow-executor，移植自用户 MIT
 * 项目的拓扑排序执行引擎）——管线经 derivePipelineFlow 投影成 FlowDefinition
 * （端口 = 数据模型字段 ref），逐节点真跑 /aigc-tryrun，步骤卡实时点亮
 * （running/success/failed/skipped），执行日志逐步展示。
 * 诚实边界不变：节点失败 fail-fast（重试 1 次后停），不伪造下游产物。
 * 定位（用户裁决）：编排由推演产出、只读 Flow 展示给用户看——不开放
 * 画布编辑；链卡+箭头+衔接字段就是流程图本体，SSR/测试下可验证。
 */

import React from "react";
import { Alert, Button, Card, Empty, Flex, Form, Input, List, Segmented, Steps, Tag, Typography } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";
import {
  type AigcPipeline,
  type FiveSystemModel,
  resolveFieldRef,
} from "../system-screens/five-system-model";
import { derivePipelineFlow, makeAigcNodeRunner } from "./flow-definition";
import { executeFlow, type FlowResult, type NodeRunStatus } from "./flow-executor";

export function AigcPipelinePanel({
  model,
  goal,
}: {
  model: FiveSystemModel;
  goal?: string;
}) {
  const pipelines = model.aigc?.pipelines ?? [];
  const capabilities = model.aigc?.capabilities ?? [];

  const [activeIdx, setActiveIdx] = React.useState(0);
  const [inputs, setInputs] = React.useState<Record<string, string>>({});
  const [running, setRunning] = React.useState(false);
  const [statuses, setStatuses] = React.useState<Record<string, NodeRunStatus>>({});
  const [result, setResult] = React.useState<FlowResult | null>(null);

  const pipeline: AigcPipeline | null = pipelines[activeIdx] ?? pipelines[0] ?? null;
  const projection = React.useMemo(
    () => derivePipelineFlow(pipeline, capabilities),
    [pipeline, capabilities]
  );
  const steps = projection.flow.nodes.map((n) => projection.capByNodeId.get(n.node_id)!);
  const handoffRefs = new Set(projection.flow.edges.map((e) => e.source_port ?? ""));

  const run = async () => {
    if (projection.reason || running) return;
    setRunning(true);
    setResult(null);
    setStatuses({});
    try {
      const flow = { ...projection.flow, variables: { ...inputs } };
      const res = await executeFlow(flow, makeAigcNodeRunner(projection.capByNodeId, goal), {
        onNodeStatus: (nodeId, status) =>
          setStatuses((prev) => ({ ...prev, [nodeId]: status })),
      });
      setResult(res);
    } finally {
      setRunning(false);
    }
  };

  if (pipelines.length === 0) {
    return (
      <Empty
        data-testid="aigc-pipeline-empty"
        description="本话题模型未声明能力编排；当两个能力经数据字段衔接时，推演会自动产出管线"
      />
    );
  }

  return (
    <Flex vertical gap="middle" className="h-full overflow-auto p-4" data-testid="aigc-pipeline-panel">
      <Segmented
        value={activeIdx}
        onChange={value => {
          setActiveIdx(Number(value));
          setInputs({});
          setResult(null);
          setStatuses({});
        }}
        options={pipelines.map((item, index) => ({
          value: index,
          label: (
            <span data-testid={`aigc-pipeline-${item.id || index}`}>
              {item.name || item.id || `管线 ${index + 1}`}
            </span>
          ),
        }))}
      />

      <Card size="small" title="能力编排" data-testid="aigc-pipeline-chain">
        <Steps
          responsive
          current={steps.findIndex(item => statuses[item.id ?? ""] === "running")}
          items={steps.map((cap, index) => {
            const status = statuses[cap.id ?? ""];
            return {
              key: cap.id || String(index),
              status: status === "success" ? "finish" : status === "failed" ? "error" : status === "running" ? "process" : "wait",
              title: <span data-testid={`aigc-pipeline-node-${cap.id}`} data-status={status ?? "idle"}>{index + 1}. {cap.name || cap.id}</span>,
              description: (
                <Flex vertical gap={4}>
                  {index > 0 && <Typography.Text code>{steps[index - 1]?.outputField}</Typography.Text>}
                  {(cap.inputFields ?? []).map(ref => {
                    const resolved = resolveFieldRef(ref, model);
                    return (
                      <Typography.Text key={ref} type={resolved.resolved ? "secondary" : "danger"}>
                        ← {resolved.resolved ? resolved.label : `未解析 ${ref}`}{handoffRefs.has(ref) ? " · 由上一步注入" : ""}
                      </Typography.Text>
                    );
                  })}
                  {cap.outputField && <Tag>输出 → {resolveFieldRef(cap.outputField, model).label || cap.outputField}</Tag>}
                </Flex>
              ),
            };
          })}
        />
      </Card>

      {/* 手工输入 + 试跑（图执行器：拓扑序逐节点真跑，状态实时点亮） */}
      <Card size="small" title="链路试跑">
        {projection.manualInputRefs.length > 0 && (
          <Form layout="vertical" size="small">
            {projection.manualInputRefs.map((ref) => {
              const res = resolveFieldRef(ref, model);
              return (
                <Form.Item key={ref} label={res.resolved ? res.label : ref} tooltip={ref}>
                  <Input
                    value={inputs[ref] ?? ""}
                    onChange={(e) => setInputs((prev) => ({ ...prev, [ref]: e.target.value }))}
                    placeholder="输入值"
                  />
                </Form.Item>
              );
            })}
          </Form>
        )}
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          data-testid="aigc-pipeline-run"
          loading={running}
          disabled={projection.reason !== null}
          onClick={run}
          title={projection.reason ?? undefined}
        >
          {running ? "链路运行中…（逐节点真跑 LLM）" : `试跑整条链（${steps.length} 步）`}
        </Button>
      </Card>

      {/* 执行日志：逐节点产出 / fail-fast 诊断 */}
      {result && (
        <Flex vertical gap="small" data-testid="aigc-pipeline-result">
          {result.error && (
            <Alert type="error" showIcon message={result.error} />
          )}
          <List
            size="small"
            bordered
            dataSource={result.logs}
            renderItem={(log, index) => {
              const item = projection.capByNodeId.get(log.node_id);
              const output = log.outputs?.[item?.outputField || "output"];
              return (
                <List.Item>
                  <List.Item.Meta
                    title={<Flex gap="small"><Tag color={log.status === "success" ? "success" : log.status === "failed" ? "error" : "default"}>{log.status}</Tag>{index + 1}. {item?.name || log.node_id}</Flex>}
                    description={log.status === "success" ? String(output ?? "") : log.error}
                  />
                </List.Item>
              );
            }}
          />
          {result.status === "failed" && result.logs.length > 0 && (
            <Typography.Text type="secondary">
              链路中断（fail-fast：下游缺上游产物，不伪造后续节点；失败节点已重试 1 次）
            </Typography.Text>
          )}
        </Flex>
      )}
    </Flex>
  );
}
