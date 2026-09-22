import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AppointmentWaitlistPanelRenderer,
  AvailabilityOverridePanelRenderer,
  OnCallScheduleCalendarRenderer,
  RescheduleRequestDrawerRenderer,
  SchedulePublishBarRenderer,
  TimezoneOverlapPanelRenderer,
} from "../schedule-status-blocks";
import { renderScheduleStatusPhoneBlock } from "../phone-mobile/PhoneScheduleStatusBlocks";

const values = { title:"安排",start:"2026-08-10T09:00:00Z",end:"2026-08-10T10:00:00Z",member:"成员",resource:"资源",participant:"候选人",location:"地点",type:"白班",status:"pending",position:1,date:"2026-08-10",startTime:"09:00",endTime:"10:00",enabled:"true",timezone:"Asia/Shanghai",dirty:"false",publishedAt:"2026-08-09",requestedStart:"2026-08-11T09:00:00Z",reason:"时间冲突" };
const row = { id:"r1", createdAt:"2026-08-01", values };
const make = (type:string,binding:Record<string,unknown>) => ({ block:{id:type,type,props:{surface:"plain"},binding} as any, entityRows:{jobs:[row]}, onAction:()=>undefined });
const calendar = (secondary:"memberFieldRef"|"resourceFieldRef", extra?:string) => ({entityRef:"jobs",titleFieldRef:"title",startFieldRef:"start",endFieldRef:"end",[secondary]:secondary==="memberFieldRef"?"member":"resource",statusFieldRef:"status",...(extra?{[extra]:extra.replace("FieldRef","")}: {})});
function PhoneProbe({value}:{value:any}) { return <>{renderScheduleStatusPhoneBlock(value)}</>; }

describe("schedule status best-practice blocks",()=>{
  const cases:Array<[string,React.ComponentType<any>,Record<string,unknown>,string]> = [
    ["OnCallScheduleCalendar",OnCallScheduleCalendarRenderer,calendar("memberFieldRef","typeFieldRef"),"on-call-schedule-calendar"],
    ["AppointmentWaitlistPanel",AppointmentWaitlistPanelRenderer,{entityRef:"jobs",titleFieldRef:"title",memberFieldRef:"member",positionFieldRef:"position",statusFieldRef:"status",targets:["booking"]},"appointment-waitlist-panel"],
    ["AvailabilityOverridePanel",AvailabilityOverridePanelRenderer,{entityRef:"jobs",dateFieldRef:"date",startTimeFieldRef:"startTime",endTimeFieldRef:"endTime",enabledFieldRef:"enabled",timezoneFieldRef:"timezone",targets:["schedule"]},"availability-override-panel"],
    ["TimezoneOverlapPanel",TimezoneOverlapPanelRenderer,{entityRef:"jobs",memberFieldRef:"member",timezoneFieldRef:"timezone",startTimeFieldRef:"startTime",endTimeFieldRef:"endTime"},"timezone-overlap-panel"],
    ["SchedulePublishBar",SchedulePublishBarRenderer,{entityRef:"jobs",statusFieldRef:"status",dirtyFieldRef:"dirty",publishedAtFieldRef:"publishedAt",targets:["schedule"]},"schedule-publish-bar"],
    ["RescheduleRequestDrawer",RescheduleRequestDrawerRenderer,{entityRef:"jobs",titleFieldRef:"title",startFieldRef:"start",requestedStartFieldRef:"requestedStart",statusFieldRef:"status",reasonFieldRef:"reason",targets:["booking"]},"reschedule-request-drawer"],
  ];
  it("renders every desktop block",()=>{for(const[type,Renderer,binding,testid]of cases)expect(renderToStaticMarkup(<Renderer {...make(type,binding)}/>)).toContain(`data-testid="${testid}"`)});
  it("renders every phone block independently",()=>{for(const[type,,binding,testid]of cases)expect(renderToStaticMarkup(<PhoneProbe value={make(type,binding)}/>)).toContain(`data-testid="phone-${testid}"`)});
});
