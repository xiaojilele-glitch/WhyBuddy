/**
 * 基础组件库 —— Ant Design 官方组件的**通用示例**，不带任何业务数据。
 *
 * ## 与"体验区块"是两层，别混
 *
 * 2026-08-08 用户的纠正（原话）：「组件库这个地方更多偏通用，更模板一些，
 * 实际就是 schema……跟他们官方里面组件总览一样，其实就是偏通用的示例，什么
 * 输入框，什么 default size，各种各样的，比 upload 什么的，更偏通用，不是说
 * 里面有数据，也不是说各个行业。」
 *
 * 我此前把组件库做成了"14 个绑着订单数据的业务积木"，层次错了：
 *
 *   基础组件（这一层）  Input / Select / Upload / Table…  通用示例，无业务数据
 *        ↓ AI 组装时配上模拟的行业数据
 *   预设 / 模板         分行业，攒出来的
 *
 * 所以这一层**不该有 binding、dataKinds、槽位**——那些是业务积木的契约。
 * 这里只有：叫什么、属于哪个分组、哪个端、长什么样。
 *
 * ## 分组照抄官方
 *
 * antd 每个组件的 index.zh-CN.md 里带 `group:` 字段，实测取值分布：
 * 数据展示 18 / 数据录入 16 / 反馈 10 / 布局 6 / 导航 6 / 通用 3 / 其他 3。
 * 直接用它，不自己发明分类——用户在官网看到的是哪一组，这里就该是哪一组。
 *
 * antd-mobile 的 md 里没有 group 字段（实测），移动端的分组按同一套词自己标。
 *
 * ## 示例怎么写
 *
 * 照官方"基本用法"那一条，**最简**。这一页是让人一眼看出"这个组件长什么样、
 * 能干什么"，不是抄一份完整文档——真要查用法官网就在那儿。示例里不出现任何
 * 业务词（订单、门店、金额），出现了就说明又滑回业务积木那一层了。
 */

import React from "react";
import {
  Affix,
  Alert,
  Anchor,
  AutoComplete,
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Calendar,
  Card,
  Carousel,
  Cascader,
  Checkbox,
  Collapse,
  ColorPicker,
  ConfigProvider,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Flex,
  FloatButton,
  Form,
  Image,
  Input,
  InputNumber,
  Layout,
  List,
  Mentions,
  message,
  Menu,
  Modal,
  notification,
  Pagination,
  Popconfirm,
  Popover,
  Progress,
  QRCode,
  Radio,
  Rate,
  Result,
  Segmented,
  Select,
  Skeleton,
  Slider,
  Space,
  Spin,
  Splitter,
  Statistic,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  TimePicker,
  Timeline,
  Tooltip,
  Tour,
  Transfer,
  Tree,
  TreeSelect,
  Typography,
  Upload,
  Watermark,
} from "antd";
import { StatisticCard } from "@ant-design/pro-components";
import { InboxOutlined, UploadOutlined } from "@ant-design/icons";
import { MOBILE_BASE_COMPONENTS } from "./base-catalog-mobile";
import { PRO_BASE_COMPONENTS } from "./base-catalog-pro";
import { CUSTOM_BASE_COMPONENTS } from "./base-catalog-custom";

import type {
  BaseComponentDef,
  BaseGroup,
  BasePlatform,
  BaseSource,
} from "./base-catalog-types";

// 类型挪到 `base-catalog-types.ts`（叶子），这里 re-export 保持对外 API 不变。
// 三个变体改从叶子取，环就断了。
export type { BaseComponentDef, BaseGroup, BasePlatform, BaseSource };

// ── 示例用的中性数据 ───────────────────────────────────────────────
// 刻意用「选项一 / 甲 / 乙」这种没有行业色彩的词。写成"华东大区""待审核"
// 之类的，看着更真，但那正是这一层要避免的东西：一旦带上行业语义，用户就会
// 以为这个组件是给那个行业用的。
const OPTIONS = [
  { value: "a", label: "选项一" },
  { value: "b", label: "选项二" },
  { value: "c", label: "选项三" },
];

const TREE_DATA = [
  {
    title: "一级",
    key: "1",
    children: [
      { title: "二级 A", key: "1-1" },
      { title: "二级 B", key: "1-2" },
    ],
  },
];

const TABLE_COLS = [
  { title: "名称", dataIndex: "name", key: "name" },
  { title: "数值", dataIndex: "value", key: "value" },
];
const TABLE_ROWS = [
  { key: "1", name: "甲", value: 12 },
  { key: "2", name: "乙", value: 34 },
];

export const PC_BASE_COMPONENTS: BaseComponentDef[] = [
  // ── 通用 ────────────────────────────────────────────────────────
  {
    name: "Button",
    label: "按钮",
    description: "触发一个即时操作。五种类型，可带图标、加载态、禁用态。",
    group: "通用",
    platform: "pc",
    render: () => (
      <Space wrap>
        <Button type="primary">主按钮</Button>
        <Button>次按钮</Button>
        <Button type="dashed">虚线</Button>
        <Button type="link">链接</Button>
        <Button danger>危险</Button>
        <Button loading>加载中</Button>
        <Button disabled>禁用</Button>
      </Space>
    ),
  },
  {
    name: "ConfigProvider",
    label: "全局化配置",
    description: "为内部组件统一提供主题、语言和组件级配置。",
    group: "其他",
    platform: "pc",
    render: () => (
      <ConfigProvider theme={{ token: { colorPrimary: "#1677ff" } }}>
        <Button type="primary">主题内按钮</Button>
      </ConfigProvider>
    ),
  },
  {
    name: "Typography",
    label: "排版",
    description: "文本的基本格式：标题、正文、链接、各种语义色。",
    group: "通用",
    platform: "pc",
    render: () => (
      <Typography>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          标题
        </Typography.Title>
        <Typography.Paragraph>
          正文段落，可以带 <Typography.Text strong>加粗</Typography.Text>、
          <Typography.Text type="secondary">次要</Typography.Text>、
          <Typography.Text type="danger">强调</Typography.Text>、
          <Typography.Text code>代码</Typography.Text>。
        </Typography.Paragraph>
        <Typography.Link>一个链接</Typography.Link>
      </Typography>
    ),
  },
  // ── 布局 ────────────────────────────────────────────────────────
  {
    name: "Divider",
    label: "分割线",
    description: "区隔内容的分割线，可带文字。",
    group: "布局",
    platform: "pc",
    render: () => (
      <div>
        <div>上面的内容</div>
        <Divider />
        <div>下面的内容</div>
        <Divider orientation="left">带标题</Divider>
        <div>再下面</div>
      </div>
    ),
  },
  {
    name: "Flex",
    label: "弹性布局",
    description: "对齐与间距的容器，省掉手写 flex 样式。",
    group: "布局",
    platform: "pc",
    render: () => (
      <Flex gap="middle" vertical>
        <Flex gap="small">
          <Button>左</Button>
          <Button>中</Button>
          <Button>右</Button>
        </Flex>
        <Flex justify="space-between">
          <Tag>两端</Tag>
          <Tag>对齐</Tag>
        </Flex>
      </Flex>
    ),
  },
  {
    name: "Space",
    label: "间距",
    description: "把一组元素按固定间距排开，横竖都行。",
    group: "布局",
    platform: "pc",
    render: () => (
      <Space direction="vertical">
        <Space>
          <Button>紧凑</Button>
          <Button>排列</Button>
        </Space>
        <Space size="large">
          <Tag color="blue">大</Tag>
          <Tag color="green">间距</Tag>
        </Space>
      </Space>
    ),
  },
  // ── 导航 ────────────────────────────────────────────────────────
  {
    name: "Breadcrumb",
    label: "面包屑",
    description: "显示当前位置及其上级路径。",
    group: "导航",
    platform: "pc",
    render: () => (
      <Breadcrumb
        items={[{ title: "首页" }, { title: "一级页面" }, { title: "当前页" }]}
      />
    ),
  },
  {
    name: "Dropdown",
    label: "下拉菜单",
    description: "点击或悬停后弹出的操作菜单。",
    group: "导航",
    platform: "pc",
    render: () => (
      <Dropdown
        menu={{ items: [{ key: "1", label: "操作一" }, { key: "2", label: "操作二" }] }}
      >
        <Button>悬停展开</Button>
      </Dropdown>
    ),
  },
  {
    name: "Menu",
    label: "导航菜单",
    description: "页面的主导航，支持横向、纵向与多级。",
    group: "导航",
    platform: "pc",
    render: () => (
      <Menu
        mode="horizontal"
        selectedKeys={["1"]}
        items={[
          { key: "1", label: "第一项" },
          { key: "2", label: "第二项" },
          { key: "3", label: "第三项", disabled: true },
        ]}
      />
    ),
  },
  {
    name: "Pagination",
    label: "分页",
    description: "长列表分页浏览。",
    group: "导航",
    platform: "pc",
    render: () => <Pagination defaultCurrent={2} total={85} size="small" />,
  },
  {
    name: "Steps",
    label: "步骤条",
    description: "把一个流程拆成有先后的若干步。",
    group: "导航",
    platform: "pc",
    render: () => (
      <Steps
        size="small"
        current={1}
        items={[{ title: "第一步" }, { title: "第二步" }, { title: "第三步" }]}
      />
    ),
  },
  {
    name: "Anchor",
    label: "锚点",
    description: "跳转到页面内指定位置。",
    group: "导航",
    platform: "pc",
    render: () => (
      <Anchor
        direction="horizontal"
        items={[
          { key: "1", href: "#a", title: "第一节" },
          { key: "2", href: "#b", title: "第二节" },
        ]}
      />
    ),
  },
  // ── 数据录入 ────────────────────────────────────────────────────
  {
    name: "Input",
    label: "输入框",
    description: "最基础的表单域，支持前后缀、密码、多行、字数统计。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <Space direction="vertical" style={{ width: "100%" }}>
        <Input placeholder="基本用法" />
        <Input placeholder="带前缀" prefix="¥" suffix="元" />
        <Input.Password placeholder="密码" />
        <Input.TextArea placeholder="多行文本" rows={2} showCount maxLength={100} />
      </Space>
    ),
  },
  {
    name: "InputNumber",
    label: "数字输入框",
    description: "只允许数字，可设步长、上下限、格式化。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <Space>
        <InputNumber defaultValue={3} min={0} max={10} />
        <InputNumber defaultValue={1000} step={100} style={{ width: 140 }} />
      </Space>
    ),
  },
  {
    name: "Select",
    label: "选择器",
    description: "从若干选项里挑一个或多个，支持搜索。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <Space direction="vertical" style={{ width: "100%" }}>
        <Select placeholder="单选" options={OPTIONS} style={{ width: "100%" }} />
        <Select
          mode="multiple"
          placeholder="多选"
          options={OPTIONS}
          defaultValue={["a"]}
          style={{ width: "100%" }}
        />
      </Space>
    ),
  },
  {
    name: "AutoComplete",
    label: "自动完成",
    description: "输入时给候选，可选可不选。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <AutoComplete
        options={OPTIONS.map(o => ({ value: o.label }))}
        placeholder="输入试试"
        style={{ width: "100%" }}
      />
    ),
  },
  {
    name: "Cascader",
    label: "级联选择",
    description: "有层级关系的选项，一级一级往下选。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <Cascader
        placeholder="逐级选择"
        style={{ width: "100%" }}
        options={[
          {
            value: "1",
            label: "一级甲",
            children: [
              { value: "1-1", label: "二级甲" },
              { value: "1-2", label: "二级乙" },
            ],
          },
          { value: "2", label: "一级乙" },
        ]}
      />
    ),
  },
  {
    name: "Checkbox",
    label: "多选框",
    description: "一组选项里选多个。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <Space direction="vertical">
        <Checkbox defaultChecked>选中</Checkbox>
        <Checkbox disabled>禁用</Checkbox>
        <Checkbox.Group options={OPTIONS} defaultValue={["a"]} />
      </Space>
    ),
  },
  {
    name: "Radio",
    label: "单选框",
    description: "一组互斥选项里选一个。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <Space direction="vertical">
        <Radio.Group options={OPTIONS} defaultValue="a" />
        <Radio.Group defaultValue="a" optionType="button" buttonStyle="solid">
          <Radio.Button value="a">按钮式</Radio.Button>
          <Radio.Button value="b">单选</Radio.Button>
        </Radio.Group>
      </Space>
    ),
  },
  {
    name: "Switch",
    label: "开关",
    description: "两种状态之间切换。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <Space>
        <Switch defaultChecked />
        <Switch checkedChildren="开" unCheckedChildren="关" defaultChecked />
        <Switch disabled />
      </Space>
    ),
  },
  {
    name: "Slider",
    label: "滑动输入条",
    description: "拖动滑块在一个范围内取值。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <div>
        <Slider defaultValue={30} />
        <Slider range defaultValue={[20, 60]} />
      </div>
    ),
  },
  {
    name: "Rate",
    label: "评分",
    description: "打星评分，支持半星。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <Space direction="vertical">
        <Rate defaultValue={3} />
        <Rate allowHalf defaultValue={2.5} />
      </Space>
    ),
  },
  {
    name: "DatePicker",
    label: "日期选择框",
    description: "选日期、周、月、季、年，或一段区间。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <Space direction="vertical" style={{ width: "100%" }}>
        <DatePicker style={{ width: "100%" }} />
        <DatePicker.RangePicker style={{ width: "100%" }} />
      </Space>
    ),
  },
  {
    name: "TimePicker",
    label: "时间选择框",
    description: "选一个时刻。",
    group: "数据录入",
    platform: "pc",
    render: () => <TimePicker style={{ width: "100%" }} />,
  },
  {
    name: "TreeSelect",
    label: "树选择",
    description: "从一棵树里选节点。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <TreeSelect
        placeholder="选择节点"
        style={{ width: "100%" }}
        treeData={TREE_DATA}
      />
    ),
  },
  {
    name: "Transfer",
    label: "穿梭框",
    description: "在两栏之间搬运选项。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <Transfer
        dataSource={[
          { key: "1", title: "条目一" },
          { key: "2", title: "条目二" },
          { key: "3", title: "条目三" },
        ]}
        targetKeys={["1"]}
        render={item => item.title}
        listStyle={{ width: 130, height: 150 }}
      />
    ),
  },
  {
    name: "Upload",
    label: "上传",
    description: "把文件交上去，支持点击与拖拽。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <Space direction="vertical" style={{ width: "100%" }}>
        <Upload>
          <Button icon={<UploadOutlined />}>点击上传</Button>
        </Upload>
        <Upload.Dragger style={{ padding: 8 }}>
          <p style={{ margin: 0 }}>
            <InboxOutlined style={{ fontSize: 24, color: "#1677ff" }} />
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 12 }}>拖到这里上传</p>
        </Upload.Dragger>
      </Space>
    ),
  },
  {
    name: "Mentions",
    label: "提及",
    description: "输入 @ 之后弹出候选人。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <Mentions
        placeholder="输入 @ 试试"
        options={[{ value: "甲" }, { value: "乙" }]}
        style={{ width: "100%" }}
      />
    ),
  },
  {
    name: "ColorPicker",
    label: "颜色选择器",
    description: "选一个颜色。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <Space>
        <ColorPicker defaultValue="#1677ff" showText />
      </Space>
    ),
  },
  {
    name: "Segmented",
    label: "分段控制器",
    description: "在几个互斥选项之间切换，比 Radio 更紧凑。",
    group: "数据录入",
    platform: "pc",
    render: () => <Segmented options={["日", "周", "月"]} defaultValue="周" />,
  },
  {
    name: "Form",
    label: "表单",
    description: "把若干表单域组织起来，带校验与布局。",
    group: "数据录入",
    platform: "pc",
    render: () => (
      <Form layout="vertical" size="small">
        <Form.Item label="文本" required>
          <Input placeholder="请输入" />
        </Form.Item>
        <Form.Item label="选择">
          <Select options={OPTIONS} placeholder="请选择" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" size="small">
            提交
          </Button>
        </Form.Item>
      </Form>
    ),
  },
  // ── 数据展示 ────────────────────────────────────────────────────
  {
    name: "Table",
    label: "表格",
    description: "展示行列数据，带排序、筛选、分页、选择。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <Table
        size="small"
        columns={TABLE_COLS}
        dataSource={TABLE_ROWS}
        pagination={false}
      />
    ),
  },
  {
    name: "List",
    label: "列表",
    description: "最基础的列表容器。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <List
        size="small"
        bordered
        dataSource={["第一条", "第二条", "第三条"]}
        renderItem={item => <List.Item>{item}</List.Item>}
      />
    ),
  },
  {
    name: "Descriptions",
    label: "描述列表",
    description: "成组展示只读的字段与取值。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <Descriptions
        size="small"
        column={2}
        items={[
          { key: "1", label: "字段一", children: "取值一" },
          { key: "2", label: "字段二", children: "取值二" },
          { key: "3", label: "字段三", children: "取值三" },
        ]}
      />
    ),
  },
  {
    name: "Card",
    label: "卡片",
    description: "把内容装进一张带标题的卡里。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <Card size="small" title="卡片标题" extra={<a>更多</a>}>
        卡片内容
      </Card>
    ),
  },
  {
    name: "Collapse",
    label: "折叠面板",
    description: "把内容收起来，点开才看。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <Collapse
        size="small"
        defaultActiveKey={["1"]}
        items={[
          { key: "1", label: "第一段", children: <p style={{ margin: 0 }}>展开后的内容</p> },
          { key: "2", label: "第二段", children: <p style={{ margin: 0 }}>另一段内容</p> },
        ]}
      />
    ),
  },
  {
    name: "Tabs",
    label: "标签页",
    description: "在同一块区域里切换不同内容。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <Tabs
        size="small"
        defaultActiveKey="1"
        items={[
          { key: "1", label: "标签一", children: "第一页内容" },
          { key: "2", label: "标签二", children: "第二页内容" },
        ]}
      />
    ),
  },
  {
    name: "Tag",
    label: "标签",
    description: "标记与分类的小标签。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <Space wrap>
        <Tag>默认</Tag>
        <Tag color="blue">蓝色</Tag>
        <Tag color="success">成功</Tag>
        <Tag color="error">失败</Tag>
        <Tag.CheckableTag checked>可选中</Tag.CheckableTag>
      </Space>
    ),
  },
  {
    name: "Badge",
    label: "徽标数",
    description: "挂在图标或按钮角上的小红点/数字。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <Space size="large">
        <Badge count={5}>
          <Avatar shape="square" />
        </Badge>
        <Badge dot>
          <Avatar shape="square" />
        </Badge>
        <Badge status="processing" text="进行中" />
      </Space>
    ),
  },
  {
    name: "Avatar",
    label: "头像",
    description: "用来代表用户或事物。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <Space>
        <Avatar>甲</Avatar>
        <Avatar shape="square">乙</Avatar>
        <Avatar.Group>
          <Avatar>A</Avatar>
          <Avatar style={{ background: "#1677ff" }}>B</Avatar>
        </Avatar.Group>
      </Space>
    ),
  },
  {
    name: "Statistic",
    label: "统计数值",
    description: "突出显示一个数字。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <Space size="large">
        <Statistic title="数值一" value={1128} />
        <Statistic title="百分比" value={93} suffix="%" />
      </Space>
    ),
  },
  {
    name: "Progress",
    label: "进度条",
    description: "展示一个操作的完成程度。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <div>
        <Progress percent={60} />
        <Space>
          <Progress type="circle" percent={70} size={54} />
          <Progress type="dashboard" percent={40} size={54} />
        </Space>
      </div>
    ),
  },
  {
    name: "Timeline",
    label: "时间轴",
    description: "按时间顺序排列的一串事件。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <Timeline
        items={[
          { children: "第一件事" },
          { children: "第二件事", color: "green" },
          { children: "第三件事", color: "red" },
        ]}
      />
    ),
  },
  {
    name: "Tree",
    label: "树形控件",
    description: "展示有层级的数据，可展开可勾选。",
    group: "数据展示",
    platform: "pc",
    render: () => <Tree defaultExpandAll checkable treeData={TREE_DATA} />,
  },
  {
    name: "Calendar",
    label: "日历",
    description: "按月/年展示日期，可在格子里放内容。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <div style={{ transform: "scale(0.85)", transformOrigin: "top left" }}>
        <Calendar fullscreen={false} />
      </div>
    ),
  },
  {
    name: "Carousel",
    label: "走马灯",
    description: "一组内容轮流展示。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <Carousel autoplay>
        {["第一屏", "第二屏", "第三屏"].map(t => (
          <div key={t}>
            <div
              style={{
                height: 90,
                lineHeight: "90px",
                textAlign: "center",
                background: "#e8eeff",
                color: "#3b5bdb",
                borderRadius: 6,
              }}
            >
              {t}
            </div>
          </div>
        ))}
      </Carousel>
    ),
  },
  {
    name: "Tooltip",
    label: "文字提示",
    description: "悬停时出现的一小段说明。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <Space>
        <Tooltip title="这是提示文字">
          <Button>悬停看看</Button>
        </Tooltip>
      </Space>
    ),
  },
  {
    name: "Popover",
    label: "气泡卡片",
    description: "点击或悬停后浮出的一块内容，比 Tooltip 能放更多。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <Popover title="标题" content={<div>可以放一段内容</div>}>
        <Button>点我</Button>
      </Popover>
    ),
  },
  {
    name: "QRCode",
    label: "二维码",
    description: "把一段文本画成二维码。",
    group: "数据展示",
    platform: "pc",
    render: () => <QRCode value="https://ant.design" size={100} />,
  },
  {
    name: "Watermark",
    label: "水印",
    description: "在内容上盖一层重复的文字或图片。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <Watermark content="示例水印" font={{ fontSize: 12 }}>
        <div style={{ height: 90, background: "#fafafa", borderRadius: 6 }} />
      </Watermark>
    ),
  },
  // ── 反馈 ────────────────────────────────────────────────────────
  {
    name: "Alert",
    label: "警告提示",
    description: "常驻在页面上的一条提示信息。",
    group: "反馈",
    platform: "pc",
    render: () => (
      <Space direction="vertical" style={{ width: "100%" }}>
        <Alert message="提示信息" type="info" showIcon />
        <Alert message="操作成功" type="success" showIcon />
        <Alert message="出错了" type="error" showIcon closable />
      </Space>
    ),
  },
  {
    name: "Modal",
    label: "对话框",
    description: "打断当前流程、需要用户确认的浮层。",
    group: "反馈",
    platform: "pc",
    render: () => {
      const Demo = () => {
        const [open, setOpen] = React.useState(false);
        return (
          <>
            <Button onClick={() => setOpen(true)}>打开对话框</Button>
            <Modal
              open={open}
              title="对话框标题"
              onOk={() => setOpen(false)}
              onCancel={() => setOpen(false)}
            >
              对话框内容
            </Modal>
          </>
        );
      };
      return <Demo />;
    },
  },
  {
    name: "Drawer",
    label: "抽屉",
    description: "从边缘滑出的浮层面板，比对话框能放更多。",
    group: "反馈",
    platform: "pc",
    render: () => {
      const Demo = () => {
        const [open, setOpen] = React.useState(false);
        return (
          <>
            <Button onClick={() => setOpen(true)}>打开抽屉</Button>
            <Drawer title="抽屉标题" open={open} onClose={() => setOpen(false)}>
              抽屉内容
            </Drawer>
          </>
        );
      };
      return <Demo />;
    },
  },
  {
    name: "Popconfirm",
    label: "气泡确认框",
    description: "点击后就地确认，比对话框轻。",
    group: "反馈",
    platform: "pc",
    render: () => (
      <Popconfirm title="确定要这么做吗？">
        <Button danger>删除</Button>
      </Popconfirm>
    ),
  },
  {
    name: "Result",
    label: "结果页",
    description: "一次操作结束后的整页反馈。",
    group: "反馈",
    platform: "pc",
    render: () => (
      <Result
        status="success"
        title="操作成功"
        subTitle="附加说明文字"
        style={{ padding: 8 }}
      />
    ),
  },
  {
    name: "Skeleton",
    label: "骨架屏",
    description: "内容还没到时先占个位。",
    group: "反馈",
    platform: "pc",
    render: () => <Skeleton active paragraph={{ rows: 2 }} />,
  },
  {
    name: "Spin",
    label: "加载中",
    description: "一个转圈，表示正在等。",
    group: "反馈",
    platform: "pc",
    render: () => (
      <Space size="large">
        <Spin size="small" />
        <Spin />
        <Spin size="large" />
      </Space>
    ),
  },
  {
    name: "Empty",
    label: "空状态",
    description: "没有数据时该显示什么。",
    group: "反馈",
    platform: "pc",
    render: () => <Empty description="暂无内容" />,
  },
  {
    name: "FloatButton",
    label: "悬浮按钮",
    description: "钉在页面角上的操作入口。",
    group: "反馈",
    platform: "pc",
    render: () => (
      <div style={{ position: "relative", height: 90 }}>
        <FloatButton.Group shape="circle" style={{ position: "absolute", right: 8, bottom: 8 }}>
          <FloatButton />
          <FloatButton.BackTop visibilityHeight={0} />
        </FloatButton.Group>
      </div>
    ),
  },
  // ── 区块真正在用、而目录里漏了的两样（2026-08-08 第三批）──────────
  //
  // 建立"区块 uses 基础组件"这层关系时对账发现的：MetricGrid 用
  // ProComponents 的 StatisticCard、TrendChart 用 ECharts，而目录里都没有。
  // 不是可加可不加——**区块真的在用它们**，目录缺了就等于这本账对不上，
  // 而对账用例正是靠名字存不存在来判对错的。
  {
    name: "StatisticCard",
    source: "pro-components",
    label: "统计卡片",
    description:
      "ProComponents 的统计卡：数值 + 说明 + 趋势，比裸 Statistic 多一层卡片与分组能力。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <StatisticCard.Group>
        <StatisticCard statistic={{ title: "数值一", value: 1128 }} />
        <StatisticCard statistic={{ title: "数值二", value: 93, suffix: "%" }} />
      </StatisticCard.Group>
    ),
  },
  {
    name: "ECharts",
    // 这一条是"自定义组件"这一档**原本就存在的唯一成员**——它的说明一直写着
    // "它不是 Ant Design 组件"，只是没有一栏能把这件事标出来。
    source: "custom",
    label: "图表",
    description:
      "ECharts 图表容器。折线/柱状/饼图等由配置决定；它不是 Ant Design 组件，但已装在依赖里，是图表这项能力的唯一来源。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <div
        style={{
          height: 120,
          borderRadius: 6,
          background:
            "linear-gradient(180deg,rgba(22,119,255,0.10),rgba(22,119,255,0.01))",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* 画一条静态折线示意。这一页是组件总览，起一个真 ECharts 实例只为
            画个示例，代价（canvas + resize 监听 × 每张卡）不值当。 */}
        <svg viewBox="0 0 200 60" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
          <polyline
            points="0,45 30,32 60,38 90,18 120,26 150,10 180,20 200,14"
            fill="none"
            stroke="#1677ff"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div style={{ position: "absolute", left: 8, top: 6, fontSize: 11, color: "#8c8c8c" }}>
          折线示意
        </div>
      </div>
    ),
  },
  // ── 补齐 PC 端剩下的 7 个（2026-08-08 第二批）─────────────────────
  {
    name: "Affix",
    label: "固钉",
    description: "滚动时把元素钉在可视区里。",
    group: "导航",
    platform: "pc",
    render: () => (
      <div style={{ height: 90, overflow: "auto" }} id="affix-demo">
        <Affix offsetTop={0} target={() => document.getElementById("affix-demo")}>
          <Button size="small">滚动时我不动</Button>
        </Affix>
        <div style={{ height: 200, paddingTop: 8, fontSize: 12, color: "#8c8c8c" }}>
          往下滚一滚
        </div>
      </div>
    ),
  },
  {
    name: "Layout",
    label: "布局",
    description: "页面的整体骨架：头、侧、内容、脚。",
    group: "布局",
    platform: "pc",
    render: () => (
      <Layout style={{ borderRadius: 6, overflow: "hidden", fontSize: 12 }}>
        <Layout.Header style={{ height: 32, lineHeight: "32px", padding: "0 12px", color: "#fff" }}>
          页头
        </Layout.Header>
        <Layout>
          <Layout.Sider width={70} style={{ background: "#f0f2f5", padding: 8 }}>
            侧栏
          </Layout.Sider>
          <Layout.Content style={{ padding: 8, background: "#fff" }}>内容区</Layout.Content>
        </Layout>
        <Layout.Footer style={{ padding: 8, textAlign: "center", background: "#f0f2f5" }}>
          页脚
        </Layout.Footer>
      </Layout>
    ),
  },
  {
    name: "Splitter",
    label: "分隔面板",
    description: "可拖动改变两侧宽度的分栏。",
    group: "布局",
    platform: "pc",
    render: () => (
      <Splitter style={{ height: 90, borderRadius: 6, border: "1px solid #f0f0f0" }}>
        <Splitter.Panel defaultSize="40%">
          <div style={{ padding: 8, fontSize: 12 }}>左侧，拖中间那条线</div>
        </Splitter.Panel>
        <Splitter.Panel>
          <div style={{ padding: 8, fontSize: 12 }}>右侧</div>
        </Splitter.Panel>
      </Splitter>
    ),
  },
  {
    name: "Image",
    label: "图片",
    description: "带预览、加载占位与失败兜底的图片。",
    group: "数据展示",
    platform: "pc",
    render: () => (
      <Space>
        {/* 用内联 SVG 占位而不是外链图：这一页要在没有外网的环境里也长一样，
            外链图挂了就变成一片"加载失败"，那不是这个组件真实的样子。 */}
        <Image
          width={80}
          src={
            "data:image/svg+xml;utf8," +
            encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120">' +
                '<rect width="160" height="120" fill="#e8eeff"/>' +
                '<text x="80" y="66" font-size="16" fill="#3b5bdb" text-anchor="middle">图片</text>' +
                "</svg>"
            )
          }
        />
        <Image width={80} src="broken" fallback="" />
      </Space>
    ),
  },
  {
    name: "Message",
    label: "全局提示",
    description: "顶部飘一条轻提示，不打断操作。",
    group: "反馈",
    platform: "pc",
    render: () => {
      const Demo = () => {
        const [api, holder] = message.useMessage();
        return (
          <>
            {holder}
            <Space wrap>
              <Button size="small" onClick={() => api.info("一条提示")}>
                普通
              </Button>
              <Button size="small" onClick={() => api.success("成功了")}>
                成功
              </Button>
              <Button size="small" onClick={() => api.error("出错了")}>
                失败
              </Button>
            </Space>
          </>
        );
      };
      return <Demo />;
    },
  },
  {
    name: "Notification",
    label: "通知提醒框",
    description: "角落弹出的通知，能放标题加正文。",
    group: "反馈",
    platform: "pc",
    render: () => {
      const Demo = () => {
        const [api, holder] = notification.useNotification();
        return (
          <>
            {holder}
            <Button
              size="small"
              onClick={() => api.info({ message: "通知标题", description: "一段说明文字。" })}
            >
              弹一条通知
            </Button>
          </>
        );
      };
      return <Demo />;
    },
  },
  {
    name: "Tour",
    label: "漫游式引导",
    description: "分步指着界面讲一遍怎么用。",
    group: "反馈",
    platform: "pc",
    render: () => {
      const Demo = () => {
        const ref = React.useRef<HTMLButtonElement>(null);
        const [open, setOpen] = React.useState(false);
        return (
          <>
            <Button size="small" ref={ref} onClick={() => setOpen(true)}>
              开始引导
            </Button>
            <Tour
              open={open}
              onClose={() => setOpen(false)}
              steps={[
                { title: "第一步", description: "先看这里。", target: () => ref.current! },
              ]}
            />
          </>
        );
      };
      return <Demo />;
    },
  },
];

/**
 * 全量 = antd 桌面 + antd-mobile + ProComponents + 自定义。
 *
 * 分四个文件是因为加起来两百多条，单文件读不动；契约（BaseComponentDef）
 * 是同一个。
 *
 * **`source` 在这里补默认值**，而不是让每条都写一遍：前两档的来源由它在
 * 哪个文件里决定，重复写 200 遍只会漏。后两档在各自文件里显式标了。
 */
export const BASE_COMPONENTS: BaseComponentDef[] = [
  ...PC_BASE_COMPONENTS.map(c => ({ source: "antd" as const, ...c })),
  ...MOBILE_BASE_COMPONENTS.map(c => ({ source: "antd-mobile" as const, ...c })),
  ...PRO_BASE_COMPONENTS,
  ...CUSTOM_BASE_COMPONENTS,
];

/**
 * 来源分档，与 BaseSource 同序。
 *
 * 这一栏在界面上是个筛选维度，也是「下一个量级从哪来」的答案本身：
 * antd 两档基本到顶，能长的是后两档。
 */
export const BASE_SOURCES: Array<{ value: BaseSource; label: string }> = [
  { value: "antd", label: "Ant Design" },
  { value: "antd-mobile", label: "Ant Design Mobile" },
  { value: "pro-components", label: "ProComponents" },
  { value: "custom", label: "自定义组件" },
];

export const BASE_GROUPS: BaseGroup[] = [
  "通用",
  "布局",
  "导航",
  "数据录入",
  "数据展示",
  "反馈",
  "其他",
];
