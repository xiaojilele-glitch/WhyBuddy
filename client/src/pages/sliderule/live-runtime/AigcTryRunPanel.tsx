/**
 * AigcTryRunPanel — AIGC 屏的「能力试跑」视图（浏览器运行时 M2）。
 *
 * 选一项模型里声明的 AI 能力，按 inputFields 填输入值，真调一次 LLM
 * （POST /api/sliderule/aigc-tryrun，复用五系统生成同一通道）。
 * 诚实边界与生成路径一致：flag 关/失败 → 结构化诊断如实展示，不伪造输出。
 */

import React from "react";
import { Alert, Button, Card, Empty, Flex, Form, Input, Segmented, Spin, Tag, Typography } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";
import {
  type FiveSystemModel,
  resolveFieldRef,
} from "../system-screens/five-system-model";

interface TryRunResult {
  ok: boolean;
  output?: string;
  code?: string;
  detail?: string;
  elapsedMs?: number;
}

export function AigcTryRunPanel({
  model,
  goal,
}: {
  model: FiveSystemModel;
  goal?: string;
}) {
  const capabilities = model.aigc?.capabilities ?? [];
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [inputs, setInputs] = React.useState<Record<string, string>>({});
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<TryRunResult | null>(null);

  const cap = capabilities[activeIdx] ?? capabilities[0] ?? null;

  const selectCap = (idx: number) => {
    setActiveIdx(idx);
    setInputs({});
    setResult(null);
  };

  const run = async () => {
    if (!cap || running) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/sliderule/aigc-tryrun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability: {
            id: cap.id,
            name: cap.name,
            inputFields: cap.inputFields,
            outputField: cap.outputField,
          },
          inputs,
          goal,
        }),
      });
      if (!res.ok) {
        setResult({ ok: false, code: `HTTP_${res.status}`, detail: await res.text() });
      } else {
        setResult((await res.json()) as TryRunResult);
      }
    } catch (e) {
      setResult({ ok: false, code: "NETWORK_ERROR", detail: String(e) });
    } finally {
      setRunning(false);
    }
  };

  if (capabilities.length === 0) {
    return (
      <Empty description="本话题模型未声明 AI 能力，推演闭环后可试跑" />
    );
  }

  return (
    <Flex vertical gap="middle" className="h-full overflow-auto p-4" data-testid="aigc-tryrun-panel">
      <Alert
        type="info"
        showIcon
        message="真跑一次：走与五系统生成同一条 LLM 通道，输出与失败均如实展示"
      />

      <Segmented
        value={activeIdx}
        onChange={value => selectCap(Number(value))}
        options={capabilities.map((item, index) => ({
          value: index,
          label: (
            <span data-testid={`aigc-tryrun-cap-${item.id || index}`}>
              {item.name || item.id}
            </span>
          ),
        }))}
      />

      {cap && (
        <Card size="small" title="输入字段">
          <Form layout="vertical" size="small">
            {(cap.inputFields ?? []).map((ref) => {
              const res = resolveFieldRef(ref, model);
              return (
                <Form.Item
                  key={ref}
                  label={res.resolved ? res.label : <Typography.Text type="danger">未解析 · {res.label}</Typography.Text>}
                  tooltip={ref}
                >
                  <Input
                    value={inputs[ref] ?? ""}
                    placeholder="填一个试跑值"
                    onChange={(e) => setInputs((prev) => ({ ...prev, [ref]: e.target.value }))}
                  />
                </Form.Item>
              );
            })}
            {(cap.inputFields ?? []).length === 0 && (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该能力未声明输入字段" />
            )}
          </Form>
          <Flex align="center" gap="small" wrap>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              data-testid="aigc-tryrun-run"
              onClick={run}
              loading={running}
            >
              {running ? "LLM 生成中…" : "试跑"}
            </Button>
            {cap.outputField && (
              <Tag>输出 → {resolveFieldRef(cap.outputField, model).label}</Tag>
            )}
            {result?.elapsedMs !== undefined && (
              <Typography.Text code>
                {(result.elapsedMs / 1000).toFixed(1)}s
              </Typography.Text>
            )}
          </Flex>
        </Card>
      )}

      {running && (
        <Spin tip="等待 LLM 返回（同一通道，真实调用）"><div style={{ minHeight: 48 }} /></Spin>
      )}
      {result && result.ok && (
        <Card size="small" title="生成结果" data-testid="aigc-tryrun-output">
          <Typography.Paragraph code style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
            {result.output}
          </Typography.Paragraph>
        </Card>
      )}
      {result && !result.ok && (
        <Alert
          data-testid="aigc-tryrun-error"
          type="error"
          showIcon
          message={result.code}
          description={result.detail}
        />
      )}
    </Flex>
  );
}
