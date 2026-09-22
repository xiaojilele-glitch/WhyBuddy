/**
 * PageScreen — 页面 Salt 线框（字段绑定 + 操作权限）。
 *
 * 2026-08-18：按 PlantUML Salt / Balsamiq 那套改——一页一个假窗，
 * 字段名在左、空槽在右，底栏动作全是灰按钮。上一版灰底卡 + teal 圆点 +
 * 第一个动作涂实心：看起来像便签，不像页。
 *
 * 推断仍走 resolveFieldRef，未解析引用如实标红。不猜 surface/kind 换皮，
 * 不发明页间连线。数据表不在这屏。
 */

import React, { useMemo } from "react";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import { EvidenceBadges } from "./EvidenceBadges";
import { EmptyScreenHint } from "./EmptyScreenHint";
import { resolveFieldRef, type FiveSystemModel } from "./five-system-model";

interface PageScreenProps {
  publishClosure?: PublishClosureSummary | null;
  rawContent?: string | null;
  /** 解析出的五系统模型（page 段 + datamodel 段做字段绑定交叉校验）。 */
  model?: FiveSystemModel | null;
  isActive?: boolean;
  className?: string;
}

export interface SaltPageField {
  ref: string;
  name: string;
  bound: boolean;
}

export interface SaltPageDef {
  id: string;
  title: string;
  fields: SaltPageField[];
  actions: string[];
}

const INK = "#171717";
const MUTED = "#a1a1aa";
const LINE = "#e5e7eb";

export function SaltPageCard({ page }: { page: SaltPageDef }) {
  return (
    <div
      data-testid={`salt-page-${page.id}`}
      style={{
        boxSizing: "border-box",
        background: "#fff",
        border: `1px solid ${LINE}`,
        borderRadius: 6,
        overflow: "hidden",
        fontFamily: "inherit",
      }}
    >
      <div
        data-testid="salt-page-chrome"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 32,
          padding: "0 10px",
          borderBottom: `1px solid ${LINE}`,
          background: "#fff",
        }}
      >
        <span aria-hidden data-testid="salt-window-dots" style={{ display: "flex", gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: "#d4d4d8" }} />
          <span style={{ width: 6, height: 6, borderRadius: 3, background: "#d4d4d8" }} />
          <span style={{ width: 6, height: 6, borderRadius: 3, background: "#d4d4d8" }} />
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: INK,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {page.title}
        </span>
        <span
          style={{
            marginLeft: "auto",
            color: MUTED,
            fontSize: 10,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            flexShrink: 0,
          }}
        >
          {page.id}
        </span>
      </div>

      <div style={{ padding: "6px 0" }}>
        {page.fields.map((field, i) => {
          const unresolved = !field.bound;
          return (
            <div
              key={`${field.ref}-${i}`}
              data-testid={`salt-field-${field.ref}`}
              data-bound={field.bound ? "true" : "false"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 24,
                padding: "0 10px",
              }}
            >
              <span
                title={
                  unresolved ? `字段绑定未在数据模型中解析：${field.name}` : field.name
                }
                style={{
                  width: 96,
                  flexShrink: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 11,
                  color: unresolved ? "#ef4444" : INK,
                }}
              >
                {unresolved ? "✗ " : ""}
                {field.name}
              </span>
              <div
                data-slot="empty"
                aria-hidden
                style={{
                  flex: 1,
                  height: 18,
                  border: `1px solid ${LINE}`,
                  borderRadius: 3,
                  background: "#fff",
                }}
              />
            </div>
          );
        })}
        {page.fields.length === 0 && (
          <div
            style={{
              padding: "8px 10px",
              color: MUTED,
              fontSize: 10,
            }}
          >
            无字段绑定
          </div>
        )}
      </div>

      {page.actions.length > 0 && (
        <div
          data-testid="salt-page-actions"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            padding: "8px 10px",
            borderTop: `1px solid ${LINE}`,
          }}
        >
          {page.actions.map((action, i) => (
            <span
              key={`${action}-${i}`}
              data-testid={`salt-action-${action}`}
              style={{
                padding: "2px 8px",
                border: `1px solid ${LINE}`,
                borderRadius: 3,
                background: "#fff",
                color: "#52525b",
                fontSize: 10,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {action}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function PageScreen({
  publishClosure,
  model,
  isActive = false,
  className = "",
}: PageScreenProps) {
  const modelPages = model?.page?.pages ?? [];
  const isPlaceholder = modelPages.length === 0;
  const pages = useMemo<SaltPageDef[]>(() => {
    if (modelPages.length === 0) return [];
    return modelPages.map((p, i) => ({
      id: p.id || `page-${i + 1}`,
      title: p.name || p.id || `页面 ${i + 1}`,
      fields: (p.fieldBindings ?? []).map(ref => {
        const res = resolveFieldRef(ref, model);
        return { ref: res.ref, name: res.label, bound: res.resolved };
      }),
      actions: (p.actionPermissions ?? []).map(String),
    }));
  }, [modelPages, model]);
  const evidence = publishClosure?.perSkillEvidence?.["page"];

  return (
    <div
      className={`flex h-full w-full flex-col bg-white ${className}`}
      data-skill="page"
      data-active={isActive}
    >
      <div className="flex items-center gap-2 border-b border-[#e5e7eb] px-4 py-2">
        <span className="text-[12px] font-medium text-stone-700">页面</span>
        <div className="ml-auto flex items-center gap-1.5">
          <EvidenceBadges evidence={evidence} />
        </div>
      </div>

      {isPlaceholder ? (
        <EmptyScreenHint
          title="页面字段绑定（Wireframe）"
          desc="页面、字段与操作权限，来自五系统模型 page 段"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="page-wireframe">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {pages.map(page => (
              <SaltPageCard key={page.id} page={page} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
