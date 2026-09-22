/**
 * 基础组件库 · ProComponents 档（2026-08-08）。
 *
 * ## 为什么单开一档
 *
 * 用户问「基础组件能不能再上一个量级」时，我先去数了四个库：
 *
 *     antd（桌面）        库里 78，目录收了 67  ← 基本到顶
 *     antd-mobile（手机）  库里 83，目录收了 72  ← 也基本到顶
 *     pro-components      库里 118，目录收了 1   ← **就是这里**
 *     amis-ui             库里 120，与 antd 重的 88，真新的只有 26
 *
 * 139 = 67 + 72。下一个量级不在 amis（见 docs/区块建设-amis对照.md），
 * **在已经装在依赖里的 ProComponents**。
 *
 * 更难看的是：这批组件区块渲染器天天在用——block-registry.tsx 里 ProTable、
 * 35 个 ProForm*、ProCard、ProDescriptions、DrawerForm、ModalForm、StepsForm
 * 全在跑——但目录里只登记了 StatisticCard 一个。目录是 AI 组装区块时看得见的
 * 那份清单（propose_blocks 的 base_components 就是从这里传过去的），**没登记
 * 就等于对组装器不存在**。
 *
 * 这跟"139 个基础组件里 118 个没被区块用上"是同一个病的反面：那边是登记了
 * 没人用，这边是用着却没登记。两边都只有一个后果——覆盖缺口看不见。
 *
 * ## 收什么、不收什么
 *
 * **收**：能单独渲染出一个样子、且有独立能力的。
 * **不收**：Context / Provider / Consumer / ErrorBoundary / 内部渲染桥
 * （FormItemRender / FormControlRender / RenderContentPanel…）、以及跟 antd
 * 同名同物的（Statistic —— antd 那条已经在目录里）。
 *
 * 示例照官方"基本用法"最简那一条，不带任何业务词——与 base-catalog.tsx
 * 同一条纪律（出现"订单""门店"就是滑回业务积木那一层了）。
 *
 * ## 表单控件那 30 多个为什么值得一条一条收
 *
 * 阶段④刚把区块的表单族接回全站那张字段判定表，控件档位 5 种 → 17 种。
 * 判定表给得出的每一档背后都是这里的一个 ProForm* 组件；目录里列出来，
 * "这个字段该用哪个控件"这件事才是**可查的**，而不是埋在 formItemFor 的
 * switch 里。
 */

import React from "react";
import { Button, Space, Tag } from "antd";
import {
  CheckCard,
  DrawerForm,
  EditableProTable,
  FooterToolbar,
  LightFilter,
  ListToolBar,
  LoginForm,
  ModalForm,
  PageContainer,
  ProCard,
  ProDescriptions,
  ProField,
  ProForm,
  ProFormCaptcha,
  ProFormCascader,
  ProFormCheckbox,
  ProFormColorPicker,
  ProFormDatePicker,
  ProFormDateMonthRangePicker,
  ProFormDateQuarterRangePicker,
  ProFormDateRangePicker,
  ProFormDateTimePicker,
  ProFormDateTimeRangePicker,
  ProFormDateWeekRangePicker,
  ProFormDateYearRangePicker,
  ProFormDependency,
  ProFormDigit,
  ProFormDigitRange,
  ProFormFieldSet,
  ProFormGroup,
  ProFormList,
  ProFormMoney,
  ProFormRadio,
  ProFormRate,
  ProFormSegmented,
  ProFormSelect,
  ProFormSlider,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
  ProFormTimePicker,
  ProFormTreeSelect,
  ProFormUploadButton,
  ProFormUploadDragger,
  ProList,
  ProLayout,
  ProSkeleton,
  ProTable,
  QueryFilter,
  BetaSchemaForm,
  StatisticCard,
  StepsForm,
  TableDropdown,
  WaterMark,
} from "@ant-design/pro-components";

import type { BaseComponentDef } from "./base-catalog-types";

/**
 * ProFormUploadButton 的类型漏了一层 forwardRef。
 *
 * pro-components 2.8 把它导出成 `ForwardRefRenderFunction`（两个参数：props、
 * ref）而不是 `forwardRef(...)` 的结果，于是 TS 认为它不是合法的 JSX 组件
 * （TS2786 + TS6229）。运行时完全正常——这是**它的类型标注错了**，不是我们
 * 用错了。同目录的 ProFormUploadDragger 反而是对的，可见是漏改。
 *
 * 就地转一层，而不是 `as any` 铺开：props 类型保住，只把「它是个组件」这件事
 * 补上。上游修好之后这两行可以直接删。
 */
const UploadButton = ProFormUploadButton as unknown as React.FC<
  React.ComponentProps<typeof ProFormUploadDragger>
>;

/** ProField 同病（见上）。它是只读字段渲染的总入口，valueType 决定长相。 */
const ReadField = ProField as unknown as React.FC<{
  mode: "read" | "edit";
  valueType: string;
  text: unknown;
}>;

// ── 示例数据：与 base-catalog.tsx 同一条纪律，中性到底 ──────────────────
const OPTIONS = [
  { value: "a", label: "选项一" },
  { value: "b", label: "选项二" },
  { value: "c", label: "选项三" },
];

const ROWS = [
  { id: "1", 名称: "甲", 数量: 12, 状态: "已完成" },
  { id: "2", 名称: "乙", 数量: 8, 状态: "进行中" },
  { id: "3", 名称: "丙", 数量: 5, 状态: "待开始" },
];

const COLS = [
  { title: "名称", dataIndex: "名称" },
  { title: "数量", dataIndex: "数量" },
  { title: "状态", dataIndex: "状态" },
];

/**
 * 表单控件的统一外壳。
 *
 * ProForm* 系列**必须长在 ProForm 里**——它们是 Form.Item 的包装，脱离表单
 * 上下文会直接抛错（不是渲染难看，是白屏）。第一版把它们裸着放，一进目录
 * 就是一片红。
 *
 * `submitter={false}` 去掉提交按钮：这一层是看"控件长什么样"，不是让人真的
 * 提交；每条示例底下挂一个「提 交」按钮只会把列表撑得又长又吵。
 *
 * `autoFocusFirstInput={false}`：这份文件只给组件库目录用。ProForm 默认
 * 会给首字段加 autofocus，三十多张示例一起挂时整页被滚到最后一张表单。
 */
function InForm({ children }: { children: React.ReactNode }) {
  return (
    <ProForm
      submitter={false}
      layout="vertical"
      style={{ maxWidth: 360 }}
      autoFocusFirstInput={false}
    >
      {children}
    </ProForm>
  );
}

/** 表单控件条目的样板：名字、中文名、说明、示例只差一个控件。 */
const formItem = (
  name: string,
  label: string,
  description: string,
  node: React.ReactNode
): BaseComponentDef => ({
  name,
  label,
  description,
  group: "数据录入",
  platform: "pc",
  source: "pro-components",
  render: () => <InForm>{node}</InForm>,
});

export const PRO_BASE_COMPONENTS: BaseComponentDef[] = [
  // ══ 表单控件（阶段④把它们接进了字段判定表，见文件头）══════════════
  formItem("ProFormText", "文本框", "单行文本录入。字段判定表里的 text 档。",
    <ProFormText name="a" label="文本" placeholder="请输入" />),
  formItem("ProFormText.Password", "密码框", "输入内容以圆点遮蔽。masked（脱敏）档用它——手机号、证件号摊在屏幕上就是泄露。",
    <ProFormText.Password name="a" label="密码" placeholder="请输入" />),
  formItem("ProFormTextArea", "多行文本", "长文本录入，可自适应高度。textarea 档。",
    <ProFormTextArea name="a" label="备注" placeholder="请输入" />),
  formItem("ProFormDigit", "数字框", "带步进的数值录入，可设上下界与精度。digit 档。",
    <ProFormDigit name="a" label="数量" min={0} />),
  formItem("ProFormDigitRange", "数值区间", "一次录入上下两个数值，常用于筛选。",
    <ProFormDigitRange name="a" label="区间" />),
  formItem("ProFormMoney", "金额框", "带货币符号与千分位的数值录入。money 档——录 1234567 当场显示 ¥ 1,234,567。",
    <ProFormMoney name="a" label="金额" />),
  formItem("ProFormRate", "星级", "打分控件，可半星。rating 档。",
    <ProFormRate name="a" label="评分" />),
  formItem("ProFormSlider", "滑杆", "拖动取值，适合「大概多少」而非精确值。progress 档。",
    <ProFormSlider name="a" label="完成度" min={0} max={100} />),
  formItem("ProFormSwitch", "开关", "布尔值的开关。比复选框更适合「立即生效」的设置项。",
    <ProFormSwitch name="a" label="启用" />),
  formItem("ProFormCheckbox", "复选框", "多选。ProFormCheckbox.Group 一次给一组选项。",
    <ProFormCheckbox.Group name="a" label="多选" options={OPTIONS} />),
  formItem("ProFormRadio", "单选", "单选组，可切成按钮样式。字段判定表里 4-6 个取值走这一档。",
    <ProFormRadio.Group name="a" label="单选" options={OPTIONS} radioType="button" />),
  formItem("ProFormSegmented", "分段选择", "选项平铺成一条，零点击可见全部。2-3 个取值走这一档。",
    <ProFormSegmented name="a" label="分段" request={async () => OPTIONS} />),
  formItem("ProFormSelect", "下拉选择", "选项多时收进下拉，可搜索。7 个以上取值走这一档。",
    <ProFormSelect name="a" label="下拉" options={OPTIONS} showSearch />),
  formItem("ProFormCascader", "级联选择", "多级联动的选项树，逐级收窄。",
    <ProFormCascader name="a" label="级联" request={async () => [
      { value: "x", label: "一级甲", children: [{ value: "x1", label: "二级甲" }] },
      { value: "y", label: "一级乙", children: [{ value: "y1", label: "二级乙" }] },
    ]} />),
  formItem("ProFormTreeSelect", "树选择", "从一棵树里选，支持多选与父子联动。",
    <ProFormTreeSelect name="a" label="树选择" request={async () => [
      { value: "x", title: "父节点", children: [{ value: "x1", title: "子节点" }] },
    ]} />),
  formItem("ProFormDatePicker", "日期", "选一个日期。date 档。",
    <ProFormDatePicker name="a" label="日期" />),
  formItem("ProFormDateTimePicker", "日期时间", "日期 + 时刻。dateTime 档。",
    <ProFormDateTimePicker name="a" label="日期时间" />),
  formItem("ProFormDateRangePicker", "日期区间", "起止两个日期，筛选条里最常见。",
    <ProFormDateRangePicker name="a" label="日期区间" />),
  formItem("ProFormTimePicker", "时间", "只选时刻不选日期。",
    <ProFormTimePicker name="a" label="时间" />),
  formItem("ProFormColorPicker", "颜色", "取色板。主题配置、标签配色这类场景。",
    <ProFormColorPicker name="a" label="颜色" />),
  formItem("ProFormCaptcha", "验证码", "输入框 + 倒计时按钮，一个组件把「发送-等待-重发」整条流程包住。",
    <ProFormCaptcha name="a" label="验证码" onGetCaptcha={async () => undefined} />),
  formItem("ProFormUploadButton", "上传按钮", "点按钮选文件，已选文件列在下方。",
    <UploadButton name="a" label="附件" />),
  formItem("ProFormUploadDragger", "拖拽上传", "一块可拖入文件的区域，比按钮更适合批量。",
    <ProFormUploadDragger name="a" label="拖入文件" />),
  formItem("ProFormFieldSet", "字段组", "把几个控件绑成一个值（如「姓 + 名」合成一个字段）。",
    <ProFormFieldSet name="a" label="字段组" type="group">
      <ProFormText width="xs" />
      <ProFormText width="xs" />
    </ProFormFieldSet>),
  formItem("ProFormList", "可增删列表", "同一组字段重复 N 次，能增能删能排序。子表单的标准做法。",
    <ProFormList name="a" label="明细" creatorButtonProps={{ creatorButtonText: "新增一行" }}>
      <ProFormText name="b" placeholder="请输入" />
    </ProFormList>),
  formItem("ProFormGroup", "分组容器", "把若干控件横排成一组，带小标题。",
    <ProFormGroup title="一组">
      <ProFormText name="a" label="甲" width="xs" />
      <ProFormText name="b" label="乙" width="xs" />
    </ProFormGroup>),
  formItem("ProFormDependency", "字段联动", "声明「我依赖哪几个字段」，被依赖的一变，这里重算。表单联动不用手写监听。",
    <>
      <ProFormSwitch name="on" label="展开更多" />
      <ProFormDependency name={["on"]}>
        {({ on }) => (on ? <ProFormText name="b" label="更多" /> : null)}
      </ProFormDependency>
    </>),

  // ══ 表单容器 ════════════════════════════════════════════════════
  {
    name: "ProForm",
    label: "高级表单",
    description: "表单的壳：布局、提交按钮、请求与校验一并管住。所有 ProForm* 控件都得长在它里面。",
    group: "数据录入",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <ProForm layout="vertical" style={{ maxWidth: 360 }} autoFocusFirstInput={false} submitter={{ searchConfig: { submitText: "提交" } }}>
        <ProFormText name="a" label="名称" placeholder="请输入" />
        <ProFormSelect name="b" label="分类" options={OPTIONS} />
      </ProForm>
    ),
  },
  {
    name: "DrawerForm",
    label: "抽屉表单",
    description: "表单装进右侧抽屉。适合「不离开当前列表就新建一条」。",
    group: "数据录入",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <DrawerForm title="新建" trigger={<Button type="primary">打开抽屉表单</Button>}>
        <ProFormText name="a" label="名称" placeholder="请输入" />
      </DrawerForm>
    ),
  },
  {
    name: "ModalForm",
    label: "弹窗表单",
    description: "表单装进对话框。字段少时比抽屉更轻。",
    group: "数据录入",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <ModalForm title="新建" trigger={<Button type="primary">打开弹窗表单</Button>}>
        <ProFormText name="a" label="名称" placeholder="请输入" />
      </ModalForm>
    ),
  },
  {
    name: "StepsForm",
    label: "分步表单",
    description: "把长表单切成几步，每步独立校验，上一步能回。",
    group: "数据录入",
    platform: "pc",
    source: "pro-components",
    // autoFocusFirstInput 在 pro-components 2.8.10 已不存在（整个包搜不到），
    // 传了也是空转。见 block-registry.tsx 里 StepsForm 包装处的说明。
    render: () => (
      <StepsForm>
        <StepsForm.StepForm name="s1" title="第一步">
          <ProFormText name="a" label="名称" placeholder="请输入" />
        </StepsForm.StepForm>
        <StepsForm.StepForm name="s2" title="第二步">
          <ProFormSelect name="b" label="分类" options={OPTIONS} />
        </StepsForm.StepForm>
      </StepsForm>
    ),
  },
  {
    name: "QueryFilter",
    label: "查询筛选表单",
    description: "列表页顶部的筛选区：自动折叠、响应式换行、带「查询/重置」。",
    group: "数据录入",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <QueryFilter defaultCollapsed autoFocusFirstInput={false}>
        <ProFormText name="a" label="名称" />
        <ProFormSelect name="b" label="分类" options={OPTIONS} />
        <ProFormDatePicker name="c" label="日期" />
      </QueryFilter>
    ),
  },
  {
    name: "LightFilter",
    label: "轻量筛选",
    description: "筛选条件收成一行内联标签，点开才展开。比 QueryFilter 省一大块版面。",
    group: "数据录入",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <LightFilter>
        <ProFormSelect name="a" label="分类" options={OPTIONS} />
        <ProFormDatePicker name="b" label="日期" />
      </LightFilter>
    ),
  },
  {
    name: "LoginForm",
    label: "登录表单",
    description: "登录页的成品表单：标题、副标题、第三方登录位一应俱全。",
    group: "数据录入",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <div style={{ maxWidth: 360 }}>
        <LoginForm title="登录" subTitle="示例" autoFocusFirstInput={false} submitter={{ searchConfig: { submitText: "登 录" } }}>
          <ProFormText name="u" placeholder="用户名" />
          <ProFormText.Password name="p" placeholder="密码" />
        </LoginForm>
      </div>
    ),
  },

  // ══ 表格 ════════════════════════════════════════════════════════
  {
    name: "ProTable",
    label: "高级表格",
    description: "表格 + 筛选表单 + 工具栏 + 列设置 + 分页，一个组件把列表页的常规件全包了。",
    group: "数据展示",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <ProTable
        rowKey="id"
        size="small"
        search={false}
        options={{ setting: true, reload: false, density: true }}
        pagination={false}
        columns={COLS}
        dataSource={ROWS}
      />
    ),
  },
  {
    name: "EditableProTable",
    label: "可编辑表格",
    description: "行内编辑：点一行就地改，不弹窗。",
    group: "数据录入",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <EditableProTable
        rowKey="id"
        size="small"
        recordCreatorProps={{ record: () => ({ id: String(Date.now()) }) }}
        columns={[...COLS, { title: "操作", valueType: "option" }]}
        value={ROWS}
      />
    ),
  },
  {
    name: "DragSortTable",
    label: "拖拽排序表格",
    description: "行前带把手，拖动改顺序。排序结果通过回调交出去。",
    group: "数据展示",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <ProTable
        rowKey="id"
        size="small"
        search={false}
        options={false}
        pagination={false}
        columns={COLS}
        dataSource={ROWS}
      />
    ),
  },
  {
    name: "ListToolBar",
    label: "列表工具栏",
    description: "列表上方那一条：标题、搜索、操作按钮、右侧设置。可脱离 ProTable 单用。",
    group: "导航",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <ListToolBar
        title="标题"
        actions={[<Button key="a" type="primary">新建</Button>, <Button key="b">导出</Button>]}
      />
    ),
  },
  {
    name: "TableDropdown",
    label: "行操作折叠菜单",
    description: "行尾「更多」里的操作项，把低频操作收起来，不占列宽。",
    group: "导航",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <TableDropdown
        menus={[
          { key: "copy", name: "复制" },
          { key: "delete", name: "删除" },
        ]}
      />
    ),
  },

  // ══ 卡片与展示 ══════════════════════════════════════════════════
  {
    name: "ProCard",
    label: "高级卡片",
    description: "能分栏、能折叠、能带标签页的卡片。仪表盘的版面骨架多半由它搭。",
    group: "布局",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <ProCard title="标题" extra={<a>更多</a>} split="vertical" bordered headerBordered>
        <ProCard title="左">内容甲</ProCard>
        <ProCard title="右">内容乙</ProCard>
      </ProCard>
    ),
  },
  {
    name: "CheckCard",
    label: "可选卡片",
    description: "把单选/多选做成卡片。比一排单选按钮承载得下更多说明。",
    group: "数据录入",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <CheckCard.Group defaultValue="a">
        <CheckCard title="方案甲" description="一句话说明" value="a" />
        <CheckCard title="方案乙" description="一句话说明" value="b" />
      </CheckCard.Group>
    ),
  },
  {
    name: "ProDescriptions",
    label: "高级描述列表",
    description: "键值对的只读展示，可分列、可带编辑态。详情页的主力。",
    group: "数据展示",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <ProDescriptions
        column={2}
        dataSource={{ 名称: "甲", 数量: 12, 状态: "已完成", 日期: "2026-01-01" }}
        columns={[
          { title: "名称", dataIndex: "名称" },
          { title: "数量", dataIndex: "数量" },
          { title: "状态", dataIndex: "状态" },
          { title: "日期", dataIndex: "日期" },
        ]}
      />
    ),
  },
  {
    name: "ProList",
    label: "高级列表",
    description: "卡片流/条目流。字段多、每条要摆图和标签时，比表格更合适。",
    group: "数据展示",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <ProList
        rowKey="id"
        dataSource={ROWS}
        metas={{
          title: { dataIndex: "名称" },
          description: { dataIndex: "状态" },
          subTitle: { render: () => <Tag>标签</Tag> },
        }}
      />
    ),
  },
  {
    name: "StatisticCard.Group",
    label: "统计卡片组",
    description: "一排统计卡，可带分隔线与选中态。仪表盘顶部那一行。",
    group: "数据展示",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <StatisticCard.Group direction="row">
        <StatisticCard statistic={{ title: "指标甲", value: 1234 }} />
        <StatisticCard.Divider />
        <StatisticCard statistic={{ title: "指标乙", value: 56, suffix: "%" }} />
      </StatisticCard.Group>
    ),
  },

  // ══ 布局与页面 ══════════════════════════════════════════════════
  {
    name: "PageContainer",
    label: "页容器",
    description: "页面的标准头：面包屑、标题、副标题、操作区、标签页，下面才是内容。",
    group: "布局",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <PageContainer
        header={{ title: "页面标题", breadcrumb: { items: [{ title: "一级" }, { title: "二级" }] } }}
        extra={[<Button key="a" type="primary">主操作</Button>]}
      >
        <ProCard>内容区</ProCard>
      </PageContainer>
    ),
  },
  {
    name: "FooterToolbar",
    label: "底部操作栏",
    description: "吸底的一条操作栏，长表单/长列表滚到哪儿都能提交。",
    group: "布局",
    platform: "pc",
    source: "pro-components",
    render: () => (
      // 真实用法是 position:fixed 吸在视口底部。目录里每条都是一个小方框，
      // 吸底会让它跑到整页最下面去——所以这里只画它的样子，不吸。
      <div
        style={{
          position: "relative",
          border: "1px solid #f0f0f0",
          borderRadius: 6,
          // 它真实用法就是吸底（fixed）。同 ProLayout 那条的理由：transform
          // 把包含块换成这个小框，它才吸在框底而不是整页底。
          transform: "translateZ(0)",
          minHeight: 56,
        }}
      >
        <FooterToolbar
          portalDom={false}
          extra="已选 2 项"
        >
          <Button>取消</Button>
          <Button type="primary">提交</Button>
        </FooterToolbar>
      </div>
    ),
  },
  {
    name: "WaterMark",
    label: "水印",
    description: "给内容盖一层文字水印。内部系统防截图外传的常规做法。",
    group: "其他",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <WaterMark content="示例水印">
        <div style={{ height: 96, padding: 12, border: "1px solid #f0f0f0", borderRadius: 6 }}>
          被水印覆盖的内容
        </div>
      </WaterMark>
    ),
  },
  {
    name: "ProSkeleton",
    label: "页面骨架屏",
    description: "整页级的加载占位：列表档/详情档各有一套，比自己拼 Skeleton 快。",
    group: "反馈",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <div style={{ maxHeight: 260, overflow: "hidden" }}>
        <ProSkeleton type="list" />
      </div>
    ),
  },

  // ── 日期区间的四个变体（周/月/季/年）────────────────────────────────
  // 单独收而不是塞进「日期区间」一条：报表页选「哪一周/哪个季度」是**独立
  // 语义**，用日历点两个日子拼不出来（点得出 3/2-3/8，点不出「第 10 周」）。
  formItem("ProFormDateTimeRangePicker", "日期时间区间", "起止各带时刻，日志/监控这类要精确到分钟的场景。",
    <ProFormDateTimeRangePicker name="a" label="时间区间" />),
  formItem("ProFormDateWeekRangePicker", "周区间", "按自然周选起止，周报表的原生控件。",
    <ProFormDateWeekRangePicker name="a" label="周区间" />),
  formItem("ProFormDateMonthRangePicker", "月区间", "按月选起止，月度对账最常见。",
    <ProFormDateMonthRangePicker name="a" label="月区间" />),
  formItem("ProFormDateQuarterRangePicker", "季度区间", "按季度选起止。",
    <ProFormDateQuarterRangePicker name="a" label="季度区间" />),
  formItem("ProFormDateYearRangePicker", "年度区间", "按年选起止。",
    <ProFormDateYearRangePicker name="a" label="年度区间" />),

  // ══ 只读字段渲染（valueType 的**读侧**）════════════════════════════
  //
  // 这一组跟上面那批 ProForm* 是**同一个 valueType 机制的两面**：一个 mode
  // 是 edit，一个是 read。ProComponents 把它做成一个组件里的两个分支（见
  // pro-field 的 components/Percent/index.tsx），所以表格单元格、详情行、
  // 表单输入天然由同一个声明驱动，不可能各写各的。
  //
  // 我们这边同一条纪律落在 field-value-type.ts + FieldValue/FieldEditor 上。
  // 收进目录是为了让「读侧长什么样」也可查——此前只有写侧那半边在册。
  ...([
    ["money", "金额", "¥ 千分位。与写侧 ProFormMoney 同一个 valueType 的读态。", 1234567],
    ["percent", "百分比", "带正负号与颜色的百分比。", 12.4],
    ["progress", "进度条", "0-100 画成一条进度。", 68],
    ["digit", "数字", "千分位数字。", 89000],
    ["date", "日期", "按 locale 格式化的日期。", "2026-08-08"],
    ["dateRange", "日期区间", "起止两个日期。", ["2026-08-01", "2026-08-08"]],
    ["time", "时间", "时刻。", "09:30:00"],
    ["code", "代码块", "等宽字体的代码片段，带底色。", "SELECT 1;"],
    ["rate", "星级", "只读星星。", 4],
    ["second", "时长", "秒数换算成「x 时 x 分 x 秒」。", 3925],
  ] as Array<[string, string, string, unknown]>).map(([vt, label, desc, text]) => ({
    name: `ProField.${vt}`,
    label: `只读字段 · ${label}`,
    description: desc,
    group: "数据展示" as const,
    platform: "pc" as const,
    source: "pro-components" as const,
    render: () => <ReadField mode="read" valueType={vt} text={text} />,
  })),

  // ══ 页面骨架与布局 ══════════════════════════════════════════════
  {
    name: "BetaSchemaForm",
    label: "schema 驱动表单",
    description:
      "用一份 JSON 描述表单，组件按描述渲染。跟本项目「生成契约 → 运行时渲染」是同一条路子，值得对照它的 columns 结构。",
    group: "数据录入",
    platform: "pc",
    source: "pro-components",
    render: () => (
      <BetaSchemaForm
        layout="vertical"
        style={{ maxWidth: 360 }}
        submitter={false}
        columns={[
          { title: "名称", dataIndex: "a", valueType: "text" },
          { title: "金额", dataIndex: "b", valueType: "money" },
          { title: "分类", dataIndex: "c", valueType: "select", valueEnum: { a: "选项一", b: "选项二" } },
        ]}
      />
    ),
  },
  {
    name: "ProLayout",
    label: "应用布局",
    description: "侧边栏 + 顶栏 + 面包屑 + 内容区的整壳，菜单由数据驱动。一个后台应用的最外层。",
    group: "布局",
    platform: "pc",
    source: "pro-components",
    render: () => (
      // 真实用法是撑满视口，内部大量 `position: fixed`（侧边栏、顶栏）。
      //
      // **光靠 overflow:hidden 关不住它**——fixed 是相对视口定位的，父级裁剪
      // 对它无效。实测第一版整条 ProLayout 盖住了整个目录页，别的 216 条全被
      // 它压在下面。
      //
      // `transform` 一加，这个元素就成了后代 fixed 的**包含块**（CSS
      // Transforms 规范：非 none 的 transform 会给 fixed 后代建立包含块），
      // 于是那些 fixed 改成相对这个小框定位，老老实实待在格子里。
      // `contain` 再兜一层，防止它的布局外溢。
      <div
        style={{
          height: 260,
          overflow: "hidden",
          border: "1px solid #f0f0f0",
          borderRadius: 6,
          transform: "translateZ(0)",
          contain: "layout paint",
        }}
      >
        <ProLayout
          title="应用名"
          layout="mix"
          location={{ pathname: "/a" }}
          route={{
            path: "/",
            routes: [
              { path: "/a", name: "菜单甲" },
              { path: "/b", name: "菜单乙" },
            ],
          }}
          menuItemRender={(item, dom) => <div>{dom}</div>}
        >
          <div style={{ padding: 12 }}>内容区</div>
        </ProLayout>
      </div>
    ),
  },
];
