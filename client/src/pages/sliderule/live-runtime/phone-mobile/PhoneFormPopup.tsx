/**
 * PhoneFormPopup — 手机档「新建」表单（antd-mobile Popup + Form，④）。
 *
 * 替掉桌面档的 antd Modal。Modal 是桌面组件：默认 520 宽、居中浮层，塞进
 * 405 的手机画布会顶穿两边（真机量过右侧溢出 130 设计像素，「保存」整个
 * 按钮在画布外，填完了提交不了）。
 *
 * 内部用 antd-mobile 的 Form 而不是手搓 <div>标签</div>+<控件>：官方那套
 * 长相（标签在左、整行、行间细分隔线、右侧 › 箭头）全由 Form/Form.Item
 * 提供，手搓拿不到，看着就像"PC 表单塞进手机"。字段各自是一个
 * PhoneFormField（浮层开关状态得落在每个字段自己身上）。
 *
 * Form 只借布局，不借状态：Form.Item 不传 name 就走纯布局分支，值仍由
 * 父层 formValues 受控，写库逻辑一行不用改。
 */

import React from "react";
import { Button, ErrorBlock, Form, NavBar, Popup } from "antd-mobile";
import PhoneFormField from "./PhoneFormField";
import type { AppFormFieldSchema } from "../app-runtime-schema";

export interface PhoneFormPopupProps {
  open: boolean;
  title: string;
  fields: AppFormFieldSchema[];
  values: Record<string, unknown>;
  onChange: (fieldId: string, v: unknown) => void;
  onCancel: () => void;
  onSubmit: () => void;
  refRowsFor: (f: AppFormFieldSchema) => Array<{ id: string; label: string }>;
  enumOptionsFor: (f: AppFormFieldSchema) => string[];
  /** 逐字段的 X 光埋点属性（父层 probe() 产出） */
  fieldProbeProps?: (f: AppFormFieldSchema) => React.HTMLAttributes<HTMLElement>;
  /** 挂载容器：画布元素。浮层必须待在画布里，否则缩放和裁剪都对不上 */
  getContainer?: () => HTMLElement;
}

export default function PhoneFormPopup({
  open,
  title,
  fields,
  values,
  onChange,
  onCancel,
  onSubmit,
  refRowsFor,
  enumOptionsFor,
  fieldProbeProps,
  getContainer,
}: PhoneFormPopupProps) {
  return (
    <Popup
      visible={open}
      onMaskClick={onCancel}
      onClose={onCancel}
      position="bottom"
      destroyOnClose
      getContainer={getContainer}
      bodyStyle={{
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        // 高度上限而不是定高：字段少的表单不该撑出一大片空白
        maxHeight: "80%",
        display: "flex",
        flexDirection: "column",
      }}
      data-testid="phone-form-popup"
    >
      {/* 顶栏左取消右保存 —— iOS/Android 表单页的通用形态 */}
      <NavBar
        back={null}
        left={
          <Button fill="none" size="small" onClick={onCancel} data-testid="phone-form-cancel">
            取消
          </Button>
        }
        right={
          <Button color="primary" fill="none" size="small" onClick={onSubmit} data-testid="phone-form-submit">
            保存
          </Button>
        }
      >
        {title}
      </NavBar>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 12 }}>
        {fields.length === 0 ? (
          <ErrorBlock
            status="empty"
            title="本页没有可录入字段"
            description="请返回并选择其他业务页面"
          />
        ) : (
          <Form layout="horizontal" mode="card">
            {fields.map(f => (
              <div key={f.id} {...(fieldProbeProps?.(f) ?? {})}>
                <PhoneFormField
                  field={f}
                  value={values[f.id]}
                  refRows={refRowsFor(f)}
                  enumOptions={enumOptionsFor(f)}
                  onChange={v => onChange(f.id, v)}
                  getContainer={getContainer}
                />
              </div>
            ))}
          </Form>
        )}
      </div>
    </Popup>
  );
}
