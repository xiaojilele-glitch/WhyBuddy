/**
 * RecordFormDrawer — HTML 页面动作的表单面（写数据闭环的后半程）。
 *
 * ## 它接的是哪条线
 *
 * spec-first 页面里的按钮走 data-action（封闭词表：createRecord / openRecord /
 * editRecord，见 html-binding-runtime.ts 与 Python 侧 html_bindings.py 的
 * ACTION_KINDS，一字不差）。事件从 iframe 冒到宿主之后，此前只有 createRecord
 * 做真事（静默塞空行），openRecord/editRecord 如实丢弃——SlideRuleStudio 里
 * 那条「需要一个表单面，那是下一步」的欠条，还的就是这里。
 *
 * ## 为什么长这样
 *
 * 不新造字段渲染：写侧 FieldEditor / 读侧 FieldValue 共读 field-value-type.ts
 * 那张档位表（ant-design/pro-components 的 valueType 机制的本地版），区块页的
 * 表单、手机档表单用的都是它们。这里再手写一套控件，就会出现「区块页的日期
 * 是 DatePicker、HTML 页的日期是裸文本框」这种漂移。
 *
 * 校验、落库同样全走已有内核：validateRowFields（fail-closed，红字标在出问题
 * 那一栏）、addRow / updateRow（纯函数）、dropSeedRowsFor（第一条真实数据落地
 * 前清演示种子——EntityDataPanel 与 AppRuntimeScreen 都是这条纪律，这里不能是
 * 例外）。持久化不在这做：onApply 只把新状态交回宿主，存哪、通知谁由宿主定
 * ——应用中心要只读，不挂这个抽屉就是了，开关天然在宿主手里。
 *
 * ## 三态
 *
 * openRecord → 详情（FieldValue 只读渲染，带「编辑」入口，取消回详情）；
 * editRecord → 表单（行值预填）；createRecord → 表单（空值起步）。
 * 行不存在（已被删）时如实报错，不渲染一张空表单装作能编辑。
 */

import React from "react";
import { Alert, Button, Drawer, Form, Space } from "antd";

import type { AppFormFieldSchema } from "./app-runtime-schema";
import { dropSeedRowsFor } from "./demo-seed";
import { normalizeFieldFormat, normalizeFieldOptions } from "./field-display";
import { FieldEditor } from "./FieldEditor";
import { FieldValue } from "./FieldValue";
import type { ActionKind } from "./html-binding-runtime";
import {
  addRow,
  updateRow,
  validateRowFields,
  type RuntimeState,
} from "./live-runtime";
import {
  resolveRefEntityId,
  type FiveSystemField,
  type FiveSystemModel,
} from "../system-screens/five-system-model";

/** 与 BindingActionEvent 同构。单独命名是为了让宿主的 state 类型不依赖解释器。 */
export interface RecordActionRequest {
  kind: ActionKind;
  entityId: string;
  rowId: string | null;
}

export interface RecordFormDrawerProps {
  model: FiveSystemModel | null | undefined;
  state: RuntimeState | null | undefined;
  /** 当前要处理的动作；null = 关着。宿主收到 onAction 事件后原样放进来。 */
  request: RecordActionRequest | null;
  onClose: () => void;
  /** 校验通过、写完运行态后把**新状态**交回宿主（存档/广播由宿主负责）。 */
  onApply: (next: RuntimeState) => void;
  /** 弹层挂载点（缩放画布场景用）；缺省 document.body。 */
  getContainer?: () => HTMLElement;
}

/**
 * FiveSystemField → 表单字段 schema。与 app-runtime-schema 的 toFieldSchema
 * 同一套归一化（坏声明丢弃，不让一个非法 format 把手机号画成金额框），
 * 外加 ref 目标解析——声明优先、命名猜测兜底（resolveRefEntityId 的既有语义）。
 */
function toFormFieldSchema(
  field: FiveSystemField,
  entityIds: string[]
): AppFormFieldSchema {
  const type = String(field.type || "string").toLowerCase();
  const schema: AppFormFieldSchema = {
    id: field.id,
    label: field.name || field.id,
    type,
  };
  const options = normalizeFieldOptions(type, field.options);
  if (options.length > 0) schema.options = options;
  const format = normalizeFieldFormat(type, field.format);
  if (format) schema.format = format;
  if (type === "ref") {
    const target = resolveRefEntityId(field, entityIds).target;
    if (target) schema.refEntityId = target;
  }
  return schema;
}

export function RecordFormDrawer({
  model,
  state,
  request,
  onClose,
  onApply,
  getContainer,
}: RecordFormDrawerProps): React.ReactElement {
  // openRecord 进来是详情，点「编辑」翻到表单；另两种动作直接是表单。
  const [mode, setMode] = React.useState<"view" | "edit">("edit");
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [problems, setProblems] = React.useState<Record<string, string>>({});

  const entity =
    model?.datamodel?.entities?.find(e => e.id === request?.entityId) ?? null;
  const entityIds = (model?.datamodel?.entities ?? [])
    .map(e => e.id)
    .filter(Boolean);
  const row = request?.rowId
    ? (state?.entities?.[request.entityId] ?? []).find(
        r => r.id === request.rowId
      ) ?? null
    : null;

  // 新请求到达时取一次行值快照。用 ref 对比而不是依赖数组：state 在抽屉开着
  // 期间不该触发重置（用户正在打的字会被行值盖掉），但它得留在闭包里可读。
  const lastRequest = React.useRef<RecordActionRequest | null>(null);
  React.useEffect(() => {
    if (request === lastRequest.current) return;
    lastRequest.current = request;
    if (!request) return;
    setValues(row ? { ...row.values } : {});
    setMode(request.kind === "openRecord" ? "view" : "edit");
    setProblems({});
  });

  const schemas = React.useMemo(
    () =>
      (entity?.fields ?? [])
        .filter(f => Boolean(f?.id))
        .map(f => toFormFieldSchema(f, entityIds)),
    // entityIds 是每轮重建的数组，拿它当依赖等于不缓存——用它的内容串替代
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entity, entityIds.join("\u0000")]
  );

  /** ref 字段的候选行：目标实体的现有行，显示名取第一列（与 AppRuntimeScreen 同口径）。 */
  const refRowsFor = (field: AppFormFieldSchema) => {
    if (!field.refEntityId) return [];
    return (state?.entities?.[field.refEntityId] ?? []).map(r => ({
      id: r.id,
      label: String(Object.values(r.values)[0] ?? r.id),
    }));
  };

  /** enum 无声明取值时的历史取值（本实体已写入行里出现过的，去重）。 */
  const enumOptionsFor = (field: AppFormFieldSchema) => {
    if (field.type !== "enum" || !request) return [];
    return [
      ...new Set(
        (state?.entities?.[request.entityId] ?? [])
          .map(r => String(r.values[field.id] ?? "").trim())
          .filter(Boolean)
      ),
    ];
  };

  const handleSave = () => {
    if (!request || !entity || !state) return;
    // 校验带上 state.entities：ref 字段要能验「指向的记录真的存在」。
    const found = validateRowFields(model, entity.id, values, state.entities);
    if (found.length > 0) {
      // fail-closed：非法值不落库，红字标在出问题那一栏（"" 键是整单级问题）
      setProblems(Object.fromEntries(found.map(p => [p.fieldId, p.message])));
      return;
    }
    if (request.kind === "createRecord") {
      // 第一条真实数据落地前清掉这张表的演示种子——种子和真实数据不混表
      const { state: next } = addRow(
        dropSeedRowsFor(state, entity.id),
        entity.id,
        values,
        new Date().toISOString()
      );
      onApply(next);
    } else if (request.rowId) {
      onApply(updateRow(state, entity.id, request.rowId, values));
    }
    onClose();
  };

  const entityLabel = entity?.name || entity?.id || request?.entityId || "";
  const creating = request?.kind === "createRecord";
  const rowMissing = Boolean(request && !creating && !row);
  const title = creating
    ? `新建 · ${entityLabel}`
    : mode === "view"
      ? `详情 · ${entityLabel}`
      : `编辑 · ${entityLabel}`;

  const editable = !rowMissing && entity !== null;

  return (
    <Drawer
      open={request !== null}
      onClose={onClose}
      title={title}
      width={420}
      destroyOnHidden
      getContainer={getContainer}
      footer={
        editable ? (
          <Space style={{ display: "flex", justifyContent: "flex-end" }}>
            {mode === "view" ? (
              <Button
                type="primary"
                data-testid="record-form-edit"
                onClick={() => setMode("edit")}
              >
                编辑
              </Button>
            ) : (
              <>
                <Button
                  data-testid="record-form-cancel"
                  onClick={() => {
                    // 从详情翻过来的，取消回详情（值退回行快照）；直接进表单的关抽屉
                    if (request?.kind === "openRecord") {
                      setValues(row ? { ...row.values } : {});
                      setProblems({});
                      setMode("view");
                    } else {
                      onClose();
                    }
                  }}
                >
                  取消
                </Button>
                <Button
                  type="primary"
                  data-testid="record-form-save"
                  onClick={handleSave}
                >
                  保存
                </Button>
              </>
            )}
          </Space>
        ) : null
      }
    >
      <div data-testid="record-form-drawer">
        {!entity && request && (
          <Alert
            type="error"
            showIcon
            data-testid="record-form-no-entity"
            message={`实体 ${request.entityId} 不在模型里`}
            description="页面按钮引用了一个模型没有声明的实体——这属于绑定问题，填数报告里会点名。"
          />
        )}
        {rowMissing && entity && (
          <Alert
            type="warning"
            showIcon
            data-testid="record-form-no-row"
            message="这条记录不存在"
            description="可能已被删除。关闭后页面会按当前数据重新填充。"
          />
        )}

        {editable && mode === "view" && row && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {schemas.map(s => (
              <div key={s.id} data-testid={`record-detail-field-${s.id}`}>
                <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 2 }}>
                  {s.label}
                </div>
                <FieldValue field={s} value={row.values[s.id]} />
              </div>
            ))}
          </div>
        )}

        {editable && mode === "edit" && (
          /* Form.Item 一律不给 name：值由 values 这个受控 state 持有，校验走
             validateRowFields + 受控 validateStatus/help（与 AppRuntimeScreen
             的 PC 表单同一取舍——rules 挂在 name 上，这里没有 name）。 */
          <Form layout="vertical" size="small">
            {problems[""] && (
              <Alert
                type="warning"
                showIcon
                data-testid="record-form-problem"
                message={problems[""]}
                style={{ marginBottom: 12 }}
              />
            )}
            {schemas.map(s => (
              <Form.Item
                key={s.id}
                label={s.label}
                style={{ marginBottom: 14 }}
                validateStatus={problems[s.id] ? "error" : undefined}
                help={problems[s.id]}
              >
                <div data-testid={`record-form-field-${s.id}`}>
                  <FieldEditor
                    field={s}
                    value={values[s.id]}
                    refRows={refRowsFor(s)}
                    enumOptions={enumOptionsFor(s)}
                    onChange={v => setValues(prev => ({ ...prev, [s.id]: v }))}
                  />
                </div>
              </Form.Item>
            ))}
          </Form>
        )}
      </div>
    </Drawer>
  );
}
