/**
 * PhoneRolePicker — 手机档顶栏角色切换（antd-mobile Picker，④）。
 *
 * 替掉桌面档的 antd Select。Select 的下拉是一层跟随触发器定位的浮层，
 * 在缩放过的手机画布里定位会飘，且选项行高按鼠标设计（手指点不准）。
 * Picker 是移动端的整屏滚轮选择，点开就是一列大字，跟系统选择器一致。
 */

import React from "react";
import { Button, Picker } from "antd-mobile";
import { DownOutline } from "antd-mobile-icons";

export interface PhoneRolePickerProps {
  roles: string[];
  roleLabels: Record<string, string>;
  value: string | undefined;
  onChange: (role: string) => void;
  getContainer?: () => HTMLElement;
}

export default function PhoneRolePicker({
  roles,
  roleLabels,
  value,
  onChange,
  getContainer,
}: PhoneRolePickerProps) {
  const [open, setOpen] = React.useState(false);
  const columns = [roles.map(r => ({ value: r, label: roleLabels[r] ?? r }))];
  const selectedLabel = value ? (roleLabels[value] ?? value) : "选择角色";

  return (
    <>
      <Button
        fill="none"
        size="small"
        shape="rounded"
        onClick={() => setOpen(true)}
        data-testid="app-runtime-role"
        style={{
          maxWidth: 120,
          "--background-color": "var(--adm-color-fill-content)",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {selectedLabel}
        </span>
        <DownOutline fontSize={12} />
      </Button>
      {/* 弹层给一个 testid：触发器与桌面档同名（app-runtime-role），但弹层内容
          是 antd-mobile 内部结构，没有抓手。缺了它，手机档换角色只能去点
          `.adm-picker-*` 这类内部类名——版本一升就断，而且脚本作者根本不知道
          该点哪里：真实教训是巡检脚本照搬桌面档的 Select 选项选择器，弹层被
          撑开挡住整屏，截出来是一张被盖住的假图，六个页面只覆盖到两个。 */}
      <Picker
        columns={columns}
        visible={open}
        onClose={() => setOpen(false)}
        value={value ? [value] : []}
        getContainer={getContainer}
        aria-label="切换角色"
        data-testid="app-runtime-role-picker"
        onConfirm={v => {
          const next = v[0];
          if (typeof next === "string") onChange(next);
        }}
      />
    </>
  );
}
