import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary } from "../block-registry";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";
import type { ExperienceBlockInstance } from "../block-registry";
import type { RuntimeRow } from "../live-runtime";

const TYPES = ["KeyboardCommandPalette", "ExportJobDrawer", "CompareSelectionTray", "DetailInspectorDrawer", "HelpContextPanel", "AuditDiffDrawer", "SavedSearchPanel", "RecentItemsPanel", "RelatedEntityPanel", "PermissionSummaryPanel", "SelectionInspector", "ValidationIssuePanel", "ContextHelpDrawer", "ChangeImpactPanel"] as const;
const row=(id:string,values:Record<string,unknown>):RuntimeRow=>({id,values,createdAt:"2026-08-10T08:00:00.000Z"});
const rows={context:[row("a",{title:"检查变更",status:"unread",query:"change",time:"2026-08-10",severity:"error",relation:"项目",allowed:false,message:"需要先修复错误"}),row("b",{title:"导出结果",status:"completed",query:"export",time:"2026-08-09",severity:"warning",relation:"数据",allowed:true,message:"任务已完成"})]};
function block(type:string):ExperienceBlockInstance{return{id:type,type,props:{title:`${type} 示例`,surface:"plain"},binding:{entityRef:"context",titleFieldRef:"title",statusFieldRef:"status",queryFieldRef:"query",timeFieldRef:"time",severityFieldRef:"severity",relationFieldRef:"relation",allowedFieldRef:"allowed",messageFieldRef:"message",targets:["context"]}}}

describe("上下文任务面第二批",()=>{
  it("每个类型都有真实桌面和手机渲染",()=>{for(const type of TYPES){expect(BLOCK_DEFINITIONS[type]?.phone,type).toBe(true);const props={block:block(type),entityRows:rows,selection:{rowIds:{context:["a", "b"]}}};const desktop=renderToStaticMarkup(<ExperienceBlockBoundary {...props}/>),phone=renderToStaticMarkup(<PhoneExperienceBlock {...props}/>);expect(desktop,type).toContain(`${type} 示例`);expect(phone,type).toContain(`${type} 示例`);expect(desktop,type).not.toContain("暂不支持");expect(phone,type).not.toBe("")}});
  it("关键边界在界面中可见",()=>{const compare=renderToStaticMarkup(<ExperienceBlockBoundary block={block("CompareSelectionTray")} entityRows={rows} selection={{rowIds:{context:["a"]}}}/>),validation=renderToStaticMarkup(<ExperienceBlockBoundary block={block("ValidationIssuePanel")} entityRows={rows}/>),permission=renderToStaticMarkup(<PhoneExperienceBlock block={block("PermissionSummaryPanel")} entityRows={rows}/>);expect(compare).toContain("请选择恰好两条记录");expect(compare).toContain("disabled");expect(validation).toContain("1 个错误阻止提交");expect(permission).toContain("1 项需要申请")});
  it("目录里每条都有来源与合法域",()=>{const entries=(catalogJson as {blocks:Array<Record<string,unknown>>}).blocks.filter(entry=>TYPES.includes(String(entry.type) as never));expect(entries).toHaveLength(TYPES.length);/* 去重后由清单派生，不写死 */for(const entry of entries){expect(entry.rendererStatus).toBe("real");expect(entry.source).toBeTruthy();expect(entry.bindingSchema).toBeTruthy();expect(entry.allowedRegions).toBeTruthy();expect(entry.pageKinds).toBeTruthy()}});
});
