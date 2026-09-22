/**
 * 基础组件库 · 移动端 —— antd-mobile 官方组件的通用示例。
 *
 * 与 PC 那份（base-catalog.tsx）同一条纪律，两点值得单独说：
 *
 * ## 一、分组是我们标的，不是抄的
 *
 * antd 每个组件的 index.zh-CN.md 里有 `group:` 字段，直接抄就行；
 * **antd-mobile 的 md 里没有这个字段**（实测 `grep -h "^group:" src/components/​*​/index.zh.md`
 * 一条都没有）。所以移动端的分组是按 PC 那套词自己标的——同一个概念在两个端
 * 落在同一组里，用户切档位时筛选不会跳。
 *
 * ## 二、每个示例都套一个窄壳
 *
 * 手机组件是照着 375~390px 机身设计的：NavBar、TabBar、ActionSheet 这些直接
 * 摆在桌面宽度里会拉成一条，看不出它真实的样子。所以统一用 PhoneFrame 罩住，
 * 宽度固定 320px。这不是装饰，是**不这么做就等于在展示一个假的组件**。
 *
 * 组件目录数：83 个，去掉 config-provider / auto-center / safe-area /
 * scroll-mask / ellipsis / virtual-input 这些工具类，再去掉 *-view 内联变体
 * （官网把它们归在同名组件下），实际 72 个。
 */

import React from "react";
import {
  CalendarPickerView,
  CascadePickerView,
  CascaderView,
  DatePickerView,
  Ellipsis,
  PickerView,
  ActionSheet,
  Avatar,
  Badge,
  Button,
  Calendar,
  CalendarPicker,
  CapsuleTabs,
  Card,
  CascadePicker,
  Cascader,
  CenterPopup,
  CheckList,
  Checkbox,
  Collapse,
  DatePicker,
  Dialog,
  Divider,
  DotLoading,
  Dropdown,
  Empty,
  ErrorBlock,
  FloatingBubble,
  FloatingPanel,
  Footer,
  Form,
  Grid,
  Image,
  ImageUploader,
  ImageViewer,
  IndexBar,
  InfiniteScroll,
  Input,
  JumboTabs,
  List,
  Loading,
  Mask,
  Modal,
  NavBar,
  NoticeBar,
  NumberKeyboard,
  PageIndicator,
  PasscodeInput,
  Picker,
  Popover,
  Popup,
  ProgressBar,
  ProgressCircle,
  PullToRefresh,
  Radio,
  Rate,
  Result,
  ResultPage,
  SearchBar,
  Segmented,
  Selector,
  SideBar,
  Skeleton,
  Slider,
  Space,
  SpinLoading,
  Stepper,
  Steps,
  SwipeAction,
  Swiper,
  Switch,
  TabBar,
  Tabs,
  Tag,
  TextArea,
  Toast,
  TreeSelect,
  WaterMark,
} from "antd-mobile";
import type { BaseComponentDef } from "./base-catalog-types";

/**
 * 窄壳。手机组件必须在手机宽度里看才是它真实的样子——
 * 直接摆在桌面宽度里，NavBar 会拉成一条、TabBar 的图标散开、
 * ActionSheet 的按钮变得又宽又扁，那展示的就不是这个组件了。
 */
function PhoneFrame({ children, height }: { children: React.ReactNode; height?: number }) {
  return (
    <div
      style={{
        width: 320,
        maxWidth: "100%",
        margin: "0 auto",
        border: "1px solid #eee",
        borderRadius: 10,
        overflow: "hidden",
        background: "#fff",
        height,
        position: "relative",
      }}
    >
      {children}
    </div>
  );
}

const OPTS = [
  { label: "选项一", value: "a" },
  { label: "选项二", value: "b" },
  { label: "选项三", value: "c" },
];

const PICKER_COLS = [[{ label: "甲", value: "1" }, { label: "乙", value: "2" }]];

const IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120">' +
      '<rect width="160" height="120" fill="#e8eeff"/>' +
      '<text x="80" y="66" font-size="16" fill="#3b5bdb" text-anchor="middle">图片</text>' +
      "</svg>"
  );

/** 弹层类组件共用的"点按钮打开"骨架 —— 十几个组件都是这个形状，抽一次。 */
function Trigger({
  text,
  render,
}: {
  text: string;
  render: (open: boolean, close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="small" color="primary" fill="outline" onClick={() => setOpen(true)}>
        {text}
      </Button>
      {render(open, () => setOpen(false))}
    </>
  );
}

export const MOBILE_BASE_COMPONENTS: BaseComponentDef[] = [
  // ── 通用 ────────────────────────────────────────────────────────
  {
    name: "M.Button", label: "按钮", description: "移动端按钮，四种填充方式与五种色板。",
    group: "通用", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Space wrap>
            <Button color="primary">主要</Button>
            <Button>默认</Button>
            <Button color="primary" fill="outline">描边</Button>
            <Button color="danger" fill="none">文字</Button>
            <Button loading color="primary">加载</Button>
            <Button disabled>禁用</Button>
          </Space>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Divider", label: "分割线", description: "区隔内容，可带文字。",
    group: "通用", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <div>上面</div>
          <Divider>带文字</Divider>
          <div>下面</div>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Space", label: "间距", description: "把一组元素按固定间距排开。",
    group: "通用", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Space direction="vertical" block>
            <Space><Tag color="primary">甲</Tag><Tag color="success">乙</Tag></Space>
            <Space wrap><Button size="mini">一</Button><Button size="mini">二</Button></Space>
          </Space>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Footer", label: "页脚", description: "页面底部的版权与链接。",
    group: "通用", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <Footer label="没有更多了" content="底部说明文字" />
      </PhoneFrame>
    ),
  },
  // ── 布局 ────────────────────────────────────────────────────────
  {
    name: "M.Grid", label: "栅格", description: "等分的网格布局。",
    group: "布局", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Grid columns={3} gap={8}>
            {["一", "二", "三", "四", "五", "六"].map(t => (
              <Grid.Item key={t}>
                <div style={{ background: "#f0f2f5", borderRadius: 6, padding: 12, textAlign: "center" }}>
                  {t}
                </div>
              </Grid.Item>
            ))}
          </Grid>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.FloatingPanel", label: "浮动面板", description: "从底部拖起来的面板。",
    group: "布局", platform: "mobile",
    render: () => (
      <PhoneFrame height={180}>
        <div style={{ padding: 10, fontSize: 12, color: "#999" }}>把下面的面板往上拖</div>
        <FloatingPanel anchors={[60, 140]}>
          <div style={{ padding: 12 }}>面板内容</div>
        </FloatingPanel>
      </PhoneFrame>
    ),
  },
  {
    name: "M.FloatingBubble", label: "悬浮气泡", description: "可拖动的悬浮操作入口。",
    group: "布局", platform: "mobile",
    render: () => (
      <PhoneFrame height={140}>
        <div style={{ padding: 10, fontSize: 12, color: "#999" }}>右下角那个可以拖</div>
        <FloatingBubble
          style={{ "--initial-position-bottom": "16px", "--initial-position-right": "16px", "--edge-distance": "16px" } as React.CSSProperties}
        >
          <span style={{ fontSize: 18 }}>＋</span>
        </FloatingBubble>
      </PhoneFrame>
    ),
  },
  // ── 导航 ────────────────────────────────────────────────────────
  {
    name: "M.NavBar", label: "导航栏", description: "页面顶部的标题与返回。",
    group: "导航", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <NavBar right={<span style={{ fontSize: 14 }}>更多</span>}>页面标题</NavBar>
      </PhoneFrame>
    ),
  },
  {
    name: "M.TabBar", label: "标签栏", description: "页面底部的主导航。",
    group: "导航", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <TabBar>
          <TabBar.Item key="1" title="首页" icon="●" />
          <TabBar.Item key="2" title="消息" icon="◆" badge="5" />
          <TabBar.Item key="3" title="我的" icon="▲" />
        </TabBar>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Tabs", label: "标签页", description: "在同一区域切换内容。",
    group: "导航", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <Tabs>
          <Tabs.Tab title="标签一" key="1"><div style={{ padding: 10 }}>第一页</div></Tabs.Tab>
          <Tabs.Tab title="标签二" key="2"><div style={{ padding: 10 }}>第二页</div></Tabs.Tab>
        </Tabs>
      </PhoneFrame>
    ),
  },
  {
    name: "M.CapsuleTabs", label: "胶囊标签", description: "胶囊形态的标签切换，更轻。",
    group: "导航", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <CapsuleTabs>
          <CapsuleTabs.Tab title="全部" key="1"><div style={{ padding: 10 }}>全部内容</div></CapsuleTabs.Tab>
          <CapsuleTabs.Tab title="进行中" key="2"><div style={{ padding: 10 }}>进行中</div></CapsuleTabs.Tab>
        </CapsuleTabs>
      </PhoneFrame>
    ),
  },
  {
    name: "M.JumboTabs", label: "巨型标签", description: "带副标题的大号标签。",
    group: "导航", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <JumboTabs>
          <JumboTabs.Tab title="标签一" description="说明一" key="1">
            <div style={{ padding: 10 }}>内容一</div>
          </JumboTabs.Tab>
          <JumboTabs.Tab title="标签二" description="说明二" key="2">
            <div style={{ padding: 10 }}>内容二</div>
          </JumboTabs.Tab>
        </JumboTabs>
      </PhoneFrame>
    ),
  },
  {
    name: "M.SideBar", label: "侧边栏", description: "纵向的分类导航。",
    group: "导航", platform: "mobile",
    render: () => (
      <PhoneFrame height={140}>
        <SideBar>
          <SideBar.Item key="1" title="分类一" />
          <SideBar.Item key="2" title="分类二" />
          <SideBar.Item key="3" title="分类三" />
        </SideBar>
      </PhoneFrame>
    ),
  },
  {
    name: "M.IndexBar", label: "索引栏", description: "右侧字母索引，长列表快速定位。",
    group: "导航", platform: "mobile",
    render: () => (
      <PhoneFrame height={150}>
        <IndexBar>
          {["A", "B", "C"].map(g => (
            <IndexBar.Panel index={g} title={g} key={g}>
              <List>
                <List.Item>{g} 开头的一项</List.Item>
                <List.Item>{g} 开头的另一项</List.Item>
              </List>
            </IndexBar.Panel>
          ))}
        </IndexBar>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Dropdown", label: "下拉菜单", description: "从顶部展开的筛选菜单。",
    group: "导航", platform: "mobile",
    render: () => (
      <PhoneFrame height={150}>
        <Dropdown>
          <Dropdown.Item key="a" title="排序">
            <div style={{ padding: 12 }}>排序方式</div>
          </Dropdown.Item>
          <Dropdown.Item key="b" title="筛选">
            <div style={{ padding: 12 }}>筛选条件</div>
          </Dropdown.Item>
        </Dropdown>
      </PhoneFrame>
    ),
  },
  {
    name: "M.PageIndicator", label: "分页指示器", description: "轮播下方那排小点。",
    group: "导航", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 14, display: "flex", justifyContent: "center" }}>
          <PageIndicator total={4} current={1} />
        </div>
      </PhoneFrame>
    ),
  },
  // ── 数据录入 ────────────────────────────────────────────────────
  {
    name: "M.Input", label: "输入框", description: "单行文本输入。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <List>
          <List.Item><Input placeholder="请输入" /></List.Item>
          <List.Item><Input placeholder="清除按钮" clearable /></List.Item>
        </List>
      </PhoneFrame>
    ),
  },
  {
    name: "M.TextArea", label: "多行输入", description: "多行文本，可自增高、带字数。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <TextArea placeholder="请输入" rows={2} showCount maxLength={100} />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.SearchBar", label: "搜索栏", description: "顶部的搜索输入。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}><SearchBar placeholder="搜索" /></div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Form", label: "表单", description: "把表单域组织起来，带校验。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <Form layout="horizontal" mode="card" footer={<Button block color="primary" size="small">提交</Button>}>
          <Form.Item label="文本" name="a"><Input placeholder="请输入" /></Form.Item>
          <Form.Item label="开关" name="b" childElementPosition="right"><Switch /></Form.Item>
        </Form>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Checkbox", label: "多选框", description: "一组选项里选多个。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Space direction="vertical">
            <Checkbox defaultChecked>选中</Checkbox>
            <Checkbox disabled>禁用</Checkbox>
          </Space>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Radio", label: "单选框", description: "一组互斥选项里选一个。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Radio.Group defaultValue="a">
            <Space direction="vertical">
              <Radio value="a">选项一</Radio>
              <Radio value="b">选项二</Radio>
            </Space>
          </Radio.Group>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Switch", label: "开关", description: "两种状态之间切换。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Space><Switch defaultChecked /><Switch /><Switch disabled /></Space>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Selector", label: "选择组", description: "标签形态的单选或多选。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Selector options={OPTS} defaultValue={["a"]} />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Stepper", label: "步进器", description: "加减调节一个数值。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}><Stepper defaultValue={1} min={0} max={10} /></div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Slider", label: "滑动条", description: "拖动取值，可区间。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: "10px 16px" }}>
          <Slider defaultValue={40} />
          <Slider range defaultValue={[20, 70]} />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Rate", label: "评分", description: "打星评分。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}><Rate defaultValue={3} /></div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Picker", label: "选择器", description: "从底部弹起的滚轮选择。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Trigger
            text="打开选择器"
            render={(open, close) => (
              <Picker columns={PICKER_COLS} visible={open} onClose={close} onConfirm={close} />
            )}
          />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.CascadePicker", label: "级联选择器", description: "有层级的滚轮选择。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Trigger
            text="打开级联"
            render={(open, close) => (
              <CascadePicker
                options={[{ label: "一级", value: "1", children: [{ label: "二级", value: "1-1" }] }]}
                visible={open}
                onClose={close}
                onConfirm={close}
              />
            )}
          />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Cascader", label: "级联选择", description: "分栏式的层级选择。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Trigger
            text="打开级联选择"
            render={(open, close) => (
              <Cascader
                options={[{ label: "一级", value: "1", children: [{ label: "二级", value: "1-1" }] }]}
                visible={open}
                onClose={close}
                onConfirm={close}
              />
            )}
          />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.DatePicker", label: "日期选择器", description: "滚轮式选日期。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Trigger
            text="选日期"
            render={(open, close) => (
              <DatePicker visible={open} onClose={close} onConfirm={close} />
            )}
          />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.CalendarPicker", label: "日历选择器", description: "整月日历里选日期或区间。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Trigger
            text="打开日历"
            render={(open, close) => (
              <CalendarPicker visible={open} onClose={close} />
            )}
          />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.CheckList", label: "可选列表", description: "列表形态的多选。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <CheckList defaultValue={["a"]}>
          <CheckList.Item value="a">选项一</CheckList.Item>
          <CheckList.Item value="b">选项二</CheckList.Item>
        </CheckList>
      </PhoneFrame>
    ),
  },
  {
    name: "M.TreeSelect", label: "树形选择", description: "多级分栏的树选择。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame height={170}>
        <TreeSelect
          options={[
            { label: "一级甲", value: "1", children: [{ label: "二级甲", value: "1-1" }] },
            { label: "一级乙", value: "2" },
          ]}
        />
      </PhoneFrame>
    ),
  },
  {
    name: "M.NumberKeyboard", label: "数字键盘", description: "自带的数字输入键盘。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame height={230}>
        <div style={{ padding: 10 }}>
          <Trigger
            text="调出键盘"
            render={(open, close) => (
              <NumberKeyboard visible={open} onClose={close} getContainer={null} />
            )}
          />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.PasscodeInput", label: "密码输入框", description: "分格的短密码输入。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}><PasscodeInput seperated /></div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.ImageUploader", label: "图片上传", description: "选图并上传，带预览。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <ImageUploader value={[{ url: IMG }]} upload={async () => ({ url: IMG })} />
        </div>
      </PhoneFrame>
    ),
  },
  // ── 数据展示 ────────────────────────────────────────────────────
  {
    name: "M.List", label: "列表", description: "移动端最常用的容器。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <List header="列表标题">
          <List.Item description="说明文字">第一项</List.Item>
          <List.Item extra="右侧">第二项</List.Item>
          <List.Item clickable>可点击</List.Item>
        </List>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Card", label: "卡片", description: "带标题的内容卡。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Card title="卡片标题" extra="更多">卡片内容</Card>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Collapse", label: "折叠面板", description: "收起来，点开才看。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <Collapse defaultActiveKey={["1"]}>
          <Collapse.Panel key="1" title="第一段">展开后的内容</Collapse.Panel>
          <Collapse.Panel key="2" title="第二段">另一段内容</Collapse.Panel>
        </Collapse>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Steps", label: "步骤条", description: "流程的先后顺序。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Steps current={1}>
            <Steps.Step title="第一步" description="已完成" />
            <Steps.Step title="第二步" description="进行中" />
            <Steps.Step title="第三步" description="待开始" />
          </Steps>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Tag", label: "标签", description: "小标签，标记与分类。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Space wrap>
            <Tag color="primary">主要</Tag>
            <Tag color="success">成功</Tag>
            <Tag color="warning">警告</Tag>
            <Tag color="danger" fill="outline">描边</Tag>
          </Space>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Badge", label: "徽标", description: "角上的小红点或数字。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 14 }}>
          <Space style={{ "--gap": "24px" } as React.CSSProperties}>
            <Badge content="5"><Avatar src="" style={{ "--size": "32px" } as React.CSSProperties} /></Badge>
            <Badge content={Badge.dot}><Avatar src="" style={{ "--size": "32px" } as React.CSSProperties} /></Badge>
          </Space>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Avatar", label: "头像", description: "代表用户或事物。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Space>
            <Avatar src={IMG} />
            <Avatar src="" />
          </Space>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Image", label: "图片", description: "带懒加载与失败兜底的图片。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}><Image src={IMG} width={120} height={90} fit="cover" /></div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.ImageViewer", label: "图片查看器", description: "全屏看图，可缩放。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Trigger
            text="全屏看图"
            render={(open, close) => (
              <ImageViewer image={IMG} visible={open} onClose={close} />
            )}
          />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Swiper", label: "走马灯", description: "一组内容左右轮播。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <Swiper autoplay loop>
          {["第一屏", "第二屏", "第三屏"].map(t => (
            <Swiper.Item key={t}>
              <div style={{ height: 80, lineHeight: "80px", textAlign: "center", background: "#e8eeff", color: "#3b5bdb" }}>
                {t}
              </div>
            </Swiper.Item>
          ))}
        </Swiper>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Calendar", label: "日历", description: "整月日历展示。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ transform: "scale(0.82)", transformOrigin: "top left", width: 390 }}>
          <Calendar selectionMode="single" />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.ProgressBar", label: "进度条", description: "横向的完成度。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 14 }}><ProgressBar percent={60} text /></div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.ProgressCircle", label: "环形进度条", description: "圆环形态的完成度。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 14, display: "flex", justifyContent: "center" }}>
          <ProgressCircle percent={70} style={{ "--size": "60px" } as React.CSSProperties}>
            70%
          </ProgressCircle>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.WaterMark", label: "水印", description: "内容上盖一层重复文字。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame height={110}>
        <WaterMark content="示例水印" fullPage={false} />
      </PhoneFrame>
    ),
  },
  {
    name: "M.SwipeAction", label: "滑动操作", description: "左滑或右滑露出操作按钮。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <List>
          <SwipeAction rightActions={[{ key: "del", text: "删除", color: "danger" }]}>
            <List.Item>向左滑试试</List.Item>
          </SwipeAction>
        </List>
      </PhoneFrame>
    ),
  },
  {
    name: "M.PullToRefresh", label: "下拉刷新", description: "往下拉触发刷新。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame height={130}>
        <PullToRefresh onRefresh={async () => {}}>
          <List>
            <List.Item>下拉我</List.Item>
            <List.Item>第二项</List.Item>
          </List>
        </PullToRefresh>
      </PhoneFrame>
    ),
  },
  {
    name: "M.InfiniteScroll", label: "无限滚动", description: "滚到底自动加载下一页。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame height={130}>
        <div style={{ height: "100%", overflow: "auto" }}>
          <List>
            <List.Item>第一项</List.Item>
            <List.Item>第二项</List.Item>
          </List>
          <InfiniteScroll loadMore={async () => {}} hasMore={false} />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Popover", label: "气泡", description: "点击后浮出的一小块内容。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame height={120}>
        <div style={{ padding: 10 }}>
          <Popover content="这是气泡内容" trigger="click" placement="right">
            <Button size="small">点我</Button>
          </Popover>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Segmented", label: "分段器", description: "在几个互斥选项之间切换。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}><Segmented options={["日", "周", "月"]} /></div>
      </PhoneFrame>
    ),
  },
  // ── 反馈 ────────────────────────────────────────────────────────
  {
    name: "M.Toast", label: "轻提示", description: "一闪而过的提示，不打断。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Space wrap>
            <Button size="small" onClick={() => void Toast.show({ content: "一条提示" })}>普通</Button>
            <Button size="small" onClick={() => void Toast.show({ icon: "success", content: "成功" })}>成功</Button>
            <Button size="small" onClick={() => void Toast.show({ icon: "loading", content: "加载中" })}>加载</Button>
          </Space>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Dialog", label: "对话框", description: "需要确认的浮层。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Space wrap>
            <Button size="small" onClick={() => void Dialog.alert({ content: "提示内容" })}>提示</Button>
            <Button size="small" onClick={() => void Dialog.confirm({ content: "确定要这么做吗？" })}>确认</Button>
          </Space>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Modal", label: "模态框", description: "自定义内容的浮层。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Button size="small" onClick={() => void Modal.show({ content: "模态框内容", closeOnMaskClick: true })}>
            打开模态框
          </Button>
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.ActionSheet", label: "动作面板", description: "从底部弹起的一组操作。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame height={150}>
        <div style={{ padding: 10 }}>
          <Trigger
            text="打开动作面板"
            render={(open, close) => (
              <ActionSheet
                visible={open}
                onClose={close}
                actions={[{ text: "操作一", key: "1" }, { text: "操作二", key: "2" }]}
                getContainer={null}
              />
            )}
          />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Popup", label: "弹出层", description: "从任意边缘滑出的容器。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame height={150}>
        <div style={{ padding: 10 }}>
          <Trigger
            text="打开弹出层"
            render={(open, close) => (
              <Popup visible={open} onMaskClick={close} getContainer={null} position="bottom">
                <div style={{ padding: 16 }}>弹出层内容</div>
              </Popup>
            )}
          />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.CenterPopup", label: "居中弹出层", description: "居中显示的弹层容器。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame height={150}>
        <div style={{ padding: 10 }}>
          <Trigger
            text="居中弹出"
            render={(open, close) => (
              <CenterPopup visible={open} onMaskClick={close} getContainer={null}>
                <div style={{ padding: 20 }}>居中的内容</div>
              </CenterPopup>
            )}
          />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Mask", label: "遮罩", description: "盖住底层内容的半透明层。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame height={140}>
        <div style={{ padding: 10 }}>
          <Trigger
            text="显示遮罩"
            render={(open, close) => <Mask visible={open} onMaskClick={close} getContainer={null} />}
          />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.NoticeBar", label: "通告栏", description: "横向滚动的一条公告。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <NoticeBar content="这是一条通告，内容比较长的时候会自己滚动起来。" closeable />
      </PhoneFrame>
    ),
  },
  {
    name: "M.Result", label: "结果", description: "一次操作之后的结果反馈。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <Result status="success" title="操作成功" description="附加说明文字" />
      </PhoneFrame>
    ),
  },
  {
    name: "M.ResultPage", label: "结果页", description: "整页的结果反馈，可带后续操作。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame height={190}>
        <ResultPage status="success" title="提交成功" description="说明文字" />
      </PhoneFrame>
    ),
  },
  {
    name: "M.ErrorBlock", label: "错误块", description: "出错或没内容时的占位。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <ErrorBlock status="empty" title="暂无内容" description="换个条件试试" />
      </PhoneFrame>
    ),
  },
  {
    name: "M.Empty", label: "空状态", description: "没有数据时的占位。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <Empty description="暂无数据" />
      </PhoneFrame>
    ),
  },
  {
    name: "M.Skeleton", label: "骨架屏", description: "内容没到时先占位。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 10 }}>
          <Skeleton.Title animated />
          <Skeleton.Paragraph lineCount={3} animated />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Loading", label: "加载中", description: "转圈，表示正在等。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 14, display: "flex", justifyContent: "center" }}>
          <Loading />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.SpinLoading", label: "旋转加载", description: "另一种转圈样式。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 14, display: "flex", justifyContent: "center" }}>
          <SpinLoading style={{ "--size": "32px" } as React.CSSProperties} />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.DotLoading", label: "点状加载", description: "三个点，用在行内。",
    group: "反馈", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 14 }}>加载中 <DotLoading /></div>
      </PhoneFrame>
    ),
  },

  // ── 内联版选择器（2026-08-08 补齐）───────────────────────────────────
  //
  // antd-mobile 里每个弹层选择器都配一个 `*View`：同样的选择逻辑，**不弹层，
  // 直接嵌在页面里**。此前一个都没收，于是"内联选择"这项能力在目录里等于
  // 不存在——而它恰恰是移动端筛选面板、分步表单里最常见的形态（弹层套弹层
  // 在手机上是很糟的体验）。
  {
    name: "M.PickerView", label: "内联选择器", description: "滚轮选择器的内嵌版，不弹层，直接占一块版面。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <PickerView
          columns={[[
            { label: "选项一", value: "a" },
            { label: "选项二", value: "b" },
            { label: "选项三", value: "c" },
          ]]}
          defaultValue={["a"]}
        />
      </PhoneFrame>
    ),
  },
  {
    name: "M.DatePickerView", label: "内联日期选择", description: "日期滚轮的内嵌版。筛选面板里比弹层顺手。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <DatePickerView defaultValue={new Date("2026-08-08")} />
      </PhoneFrame>
    ),
  },
  {
    name: "M.CascaderView", label: "内联级联选择", description: "多级联动的内嵌版，逐级收窄。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <CascaderView
          options={[
            { label: "一级甲", value: "a", children: [{ label: "二级甲", value: "a1" }] },
            { label: "一级乙", value: "b", children: [{ label: "二级乙", value: "b1" }] },
          ]}
          defaultValue={["a", "a1"]}
        />
      </PhoneFrame>
    ),
  },
  {
    name: "M.CascadePickerView", label: "内联级联滚轮", description: "级联 + 滚轮的内嵌版，省地方；省市区这类固定层级用它。",
    group: "数据录入", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <CascadePickerView
          options={[
            { label: "一级甲", value: "a", children: [{ label: "二级甲", value: "a1" }] },
            { label: "一级乙", value: "b", children: [{ label: "二级乙", value: "b1" }] },
          ]}
          defaultValue={["a", "a1"]}
        />
      </PhoneFrame>
    ),
  },
  {
    name: "M.CalendarPickerView", label: "内联日历选择", description: "整月日历的内嵌版，可选区间。订房、排班这类要看全月的场景。",
    group: "数据录入", platform: "mobile",
    render: () => (
      // 它**按月无限往下铺**（不是 bug，日历本来就该能一直翻）。不给高度的话
      // 这一格会长到八百多像素，把整面墙的瀑布流拉变形。给个高度 + 自己滚动，
      // 跟真实用法（放在一个可滚区域里）也更接近。
      <PhoneFrame height={280}>
        <div style={{ height: "100%", overflowY: "auto" }}>
          <CalendarPickerView selectionMode="range" />
        </div>
      </PhoneFrame>
    ),
  },
  {
    name: "M.Ellipsis", label: "文本省略", description: "长文本按行数截断，可「展开/收起」。手机屏窄，这个几乎每页都要用。",
    group: "数据展示", platform: "mobile",
    render: () => (
      <PhoneFrame>
        <div style={{ padding: 14, fontSize: 13 }}>
          <Ellipsis
            direction="end"
            rows={2}
            expandText="展开"
            collapseText="收起"
            content={"这是一段很长的说明文字，用来演示按行数截断之后如何展开与收起。".repeat(3)}
          />
        </div>
      </PhoneFrame>
    ),
  },
];
