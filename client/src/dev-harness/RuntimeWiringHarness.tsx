/**
 * Dev-only：**真实运行时**的接线台（2026-08-08，②阶段复盘的产物）。
 *
 * ## 为什么需要它
 *
 * 复盘时发现批次 1-4 建的六个区块在真实应用里全是死壳——`AppRuntimeScreen`
 * 没接 selection / columnState / focus 这几条通道。补完之后要确认"真的活了"，
 * 但确认这件事此前**没有便宜的办法**：
 *
 * - 组件库对照台（ComponentsLibraryPage）走的是另一条渲染路径，它一直是好的，
 *   所以它证明不了运行时；
 * - 生成一个真应用要跑一轮 LLM 推演，二十多分钟且不保证产出这几个区块。
 *
 * 于是有了这个台子：**喂一份写死的五系统模型给 AppRuntimeScreen**，页面上
 * 一次摆齐表格 + 批量操作栏 + 列设置 + 标签筛选 + 搜索框，用 targets 连好线。
 * 点得动就是通了，点不动就是没通——不依赖模型、不依赖网络、每次一样。
 *
 * ## 这份模型是手写的，不是生成的
 *
 * 它只需要"结构上合法"，不需要"业务上像真的"。真实性由生成侧的门禁负责；
 * 这里要的是一个**确定的**页面，好让接线这件事可复现地被看见。
 *
 * 走 `/runtime-wiring.html`（vite dev 下可达，不进生产产物——构建入口只有
 * index.html，跟 block-gallery / wall-fixture 同一条规矩）。
 */
import React from "react";

import { AppRuntimeScreen } from "@/pages/sliderule/live-runtime/AppRuntimeScreen";
import type { FiveSystemModel } from "@/pages/sliderule/system-screens/five-system-model";

/** 订单 + 订单日志：日志分属不同订单，才验得出关联单据表真的筛了。 */
export const RUNTIME_WIRING_MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "order",
        name: "订单",
        fields: [
          { id: "name", name: "门店", type: "string" },
          // ── 格式（2026-08-08，阶段④）────────────────────────────────
          // 下面五个字段类型全是 number 或 string，控件却各不相同——差别只
          // 来自 `format`。这条线此前**只有读侧接着**：表格/详情会把金额画成
          // ¥ 千分位，而同一个字段进了表单还是个裸数字框。台子上摆一页表单，
          // 就是为了让"表单也读格式了"这件事点得开、看得见。
          { id: "amount", name: "金额", type: "number", format: "money" },
          { id: "weekDelta", name: "周涨幅", type: "number", format: "percent" },
          { id: "fulfillRate", name: "履约完成度", type: "number", format: "progress" },
          { id: "healthScore", name: "健康分", type: "number", format: "score" },
          { id: "starLevel", name: "服务星级", type: "number", format: "rating" },
          { id: "contact", name: "联系电话", type: "string", format: "masked" },
          // ref：候选是**另一张表的行**，不是枚举取值。此前掉进兜底分支变成
          // 文本框——要用户手打一个行 id，等于没做。
          {
            id: "parentOrderId",
            name: "关联母单",
            type: "ref",
            refEntityId: "order",
          },
          // 枚举字段**必须带 options**，否则标签筛选行摊不出标签、表格也只画
          // 一个「-」。第一版漏了，台子上那一行是空的。
          {
            id: "status",
            name: "状态",
            type: "enum",
            options: [
              { id: "todo", label: "待办", tone: "default" },
              { id: "doing", label: "进行中", tone: "processing" },
              { id: "done", label: "已完成", tone: "success" },
            ],
          },
          // 枚举**按取值个数分三档**（阈值在 field-value-type.ts）。台子上三档
          // 各摆一个，才看得出"2 个取值也逼人点开下拉"这件事真的改掉了：
          //   status  3 个 → Segmented（≤3）
          //   channel 5 个 → Radio.Group（≤6）
          //   region  8 个 → Select（更多）
          {
            id: "channel",
            name: "渠道",
            type: "enum",
            options: [
              { id: "online", label: "线上", tone: "default" },
              { id: "store", label: "门店", tone: "default" },
              { id: "phone", label: "电话", tone: "default" },
              { id: "agent", label: "代理", tone: "default" },
              { id: "wholesale", label: "批发", tone: "default" },
            ],
          },
          {
            id: "region",
            name: "大区",
            type: "enum",
            options: [
              { id: "hd", label: "华东", tone: "default" },
              { id: "hb", label: "华北", tone: "default" },
              { id: "hn", label: "华南", tone: "default" },
              { id: "hz", label: "华中", tone: "default" },
              { id: "xn", label: "西南", tone: "default" },
              { id: "xb", label: "西北", tone: "default" },
              { id: "db", label: "东北", tone: "default" },
              { id: "other", label: "其他", tone: "default" },
            ],
          },
          { id: "at", name: "下单日期", type: "date" },
        ],
      },
      {
        id: "orderLog",
        name: "订单日志",
        fields: [
          { id: "orderId", name: "所属订单", type: "ref" },
          // action 得是**枚举且带取值声明**：标签筛选行的每一颗标签就是它的一个
          // 取值，string 字段摊不出标签（第一版写成 string，台子上那一行是空的）。
          {
            id: "action",
            name: "操作",
            type: "enum",
            options: [
              { id: "created", label: "创建", tone: "default" },
              { id: "reviewed", label: "复核", tone: "processing" },
              { id: "shipped", label: "发货", tone: "success" },
            ],
          },
          { id: "operator", name: "操作人", type: "string" },
        ],
      },
    ],
  },
  // 角色的权限集 = roleRefs 命中的菜单 permissionRefs 的并集（见 rbac-preview）。
  // menus 留空的话这个角色一条权限都没有，订单页会被判成"不可见"，整页不上屏
  // ——第一版就是这么写的，台子起来了但停在总览页，点菜单也进不去。
  rbac: {
    roles: ["运营"],
    permissions: ["order:create", "order:read"],
    menus: [
      {
        id: "m-order",
        label: "订单管理",
        roleRefs: ["运营"],
        permissionRefs: ["order:create", "order:read"],
      },
    ],
  },
  workflow: { nodes: [], transitions: [] },
  page: {
    pages: [
      {
        id: "order_list",
        name: "订单管理",
        // **就是 workbench** —— 最常见的列表页形态。
        //
        // 2026-08-08 第②步之前这里必须写 monitor：桌面档的 workbench 页整页交给
        // 内置 ProTable 骨架，积木一个都不渲染。翻转默认之后，声明了 blocks 的
        // 页面由积木画，这一档才是该验的那一档。
        kind: "workbench",
        fieldBindings: [
          "order.name",
          "order.amount",
          "order.status",
          "order.channel",
          "order.at",
        ],
        actionPermissions: ["order:create", "order:read"],
        // 五个区块 + 连线。这一页存在的唯一意义就是把接线全用上一遍。
        blocks: [
          {
            id: "b-search",
            type: "SearchBox",
            props: { title: "搜索", placeholder: "搜门店名" },
            binding: { entityRef: "order", targets: ["b-table"] },
          },
          {
            id: "b-tags",
            type: "TagFilterRow",
            props: { title: "按标签筛选" },
            binding: {
              entityRef: "order",
              fieldRefs: ["status", "channel"],
              targets: ["b-table"],
            },
          },
          {
            id: "b-colset",
            type: "ColumnSettingPanel",
            props: { title: "列设置" },
            binding: { entityRef: "order", targets: ["b-table"] },
          },
          {
            id: "b-table",
            type: "DataTable",
            props: { title: "订单明细" },
            // 绑**主实体**。第②步之前这么写会被"一页一个主人"那条规矩整个摘掉；
            // 翻转之后内置表格本来就不渲染了，这张就是这一页唯一的表。
            binding: {
              entityRef: "order",
              fieldRefs: ["name", "amount", "weekDelta", "status", "channel", "at"],
              // ── 批次 7（2026-08-09）：中式报表的两样 ──────────────────
              // 合计行：底部固定一行，只对声明的数值列求和。**不是往数据里
              // 塞一条假行**——jeecgboot 那边就是 push 进 dataSource，于是得把
              // pageSize 减一，那条假行还能被排序被勾选。antd 的 summary 在
              // tbody 之外，同一个需求的正确位置。
              summaryFieldRefs: ["amount", "weekDelta"],
              // 二级表头：金额和周涨幅归到「经营数据」下面。只重组已经在
              // fieldRefs 里的列，没被认领的留在原位。
              columnGroups: [{ title: "经营数据", fieldRefs: ["amount", "weekDelta"] }],
            },
          },
          {
            id: "b-batch",
            type: "BatchActionBar",
            props: { actions: ["批量导出", "批量关闭"] },
            binding: { entityRef: "order", targets: ["b-table"] },
          },
        ],
        layout: {
          header: ["b-colset"],
          filters: ["b-search", "b-tags"],
          main: ["b-table"],
          footerBar: ["b-batch"],
        },
      },
      // 第三页：**声明了积木、但一个 data 族都没有**。翻转默认最容易造成的
      // 伤害就在这里——模型只写了一个 MetricGrid，整页的表格就没了。兜底应该
      // 把内置表格补回版面。台子上留这一页，就是为了每次都能看见它有没有补。
      {
        id: "order_nodata",
        name: "订单管理（只声明了指标卡）",
        kind: "workbench",
        fieldBindings: ["order.name", "order.amount", "order.status"],
        actionPermissions: ["order:create", "order:read"],
        blocks: [
          {
            id: "n-metric",
            type: "MetricGrid",
            props: { title: "订单总额" },
            binding: { entityRef: "order", aggregate: "sum:amount" },
          },
        ],
        layout: { metrics: ["n-metric"] },
      },
      // 第四页：**表单页**，验的是格式那条线（阶段④）。
      //
      // 一页之内两条路并排：中间六个字段靠 format 决定控件，末尾 status/at
      // 没有 format，按类型回落成下拉/日期。都对了才叫"格式优先、类型兜底"。
      //
      // 走真实运行时而不是对照台：对照台自己造 FIELD_FORMAT 表，证明不了
      // AppRuntimeScreen 真的从数据模型里读到了 format——那正是此前断掉的一环。
      {
        id: "order_form",
        name: "新建订单（格式）",
        kind: "form",
        fieldBindings: ["order.name", "order.amount", "order.status"],
        actionPermissions: ["order:create", "order:read"],
        blocks: [
          {
            id: "f-form",
            type: "RecordForm",
            props: { title: "新建订单", submitText: "创建", layout: "vertical" },
            binding: {
              entityRef: "order",
              fieldRefs: [
                "name", "amount", "weekDelta", "fulfillRate",
                "healthScore", "starLevel", "contact",
                "status", "channel", "region", "parentOrderId", "at",
              ],
            },
          },
        ],
        layout: { main: ["f-form"] },
      },
      // 第二页故意是 workbench —— 那一档由**固定骨架**画（积木不上屏）。
      // 台子上两页并排，才验得出"翻转默认"前后各是什么样、骨架有没有被改坏。
      {
        id: "order_skeleton",
        name: "订单管理（骨架档）",
        fieldBindings: [
          "order.name",
          "order.amount",
          "order.status",
          "order.channel",
          "order.at",
        ],
        actionPermissions: ["order:create", "order:read"],
      },
    ],
  },
  aigc: { capabilities: [] },
  appbundle: {
    pageBindings: [],
    roleRefs: ["运营"],
    dataModelRefs: ["order", "orderLog"],
  },
} as unknown as FiveSystemModel;

export function RuntimeWiringHarness() {
  return (
    <div style={{ height: "100vh", overflow: "auto", background: "#faf9f7" }}>
      <div style={{ padding: "8px 12px", fontSize: 12, color: "#78716c" }}>
        dev-only 接线台 —— 这里点得动，才说明真实运行时把通道接上了
      </div>
      <div data-testid="runtime-wiring-stage" style={{ height: "calc(100vh - 32px)" }}>
        <AppRuntimeScreen
          model={RUNTIME_WIRING_MODEL}
          sessionId="runtime-wiring-harness"
          appTitle="接线台"
        />
      </div>
    </div>
  );
}
