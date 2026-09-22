/**
 * 基础组件目录的**类型叶子**（2026-09-04）。
 *
 * ⚠ 为什么单独一个文件：原来这四个类型定义在 `base-catalog.tsx` 里，而那个
 *   文件又要 import 三个变体（mobile / pro / custom）来拼总表；三个变体反过来
 *   又要 `import type { BaseComponentDef } from "./base-catalog"` —— 三个环：
 *
 *       base-catalog ↔ base-catalog-mobile
 *       base-catalog ↔ base-catalog-pro
 *       base-catalog ↔ base-catalog-custom
 *
 *   （`arch-graph-ts.mjs --report` 的模块级环清单里就是这三条。）
 *
 *   都是 `import type`，编译后擦除，所以**运行时不成环**——代价不在加载顺序，
 *   在边界：目录和它的变体焊成一坨，谁都拆不出来，而闸把它们算数。
 *
 *   解法就是本仓 `util` 层那条原则：**大家都要的东西，自己不许依赖别人**。
 *   这个文件不 import 任何本目录模块，所以谁都能安全引它。
 *
 * ⚠ 别把值（PC_BASE_COMPONENTS 这类常量）搬进来 —— 一搬就又得 import 变体，
 *   环立刻长回来。这里只放类型。
 */

/** 官方分组（antd 的 index.zh-CN.md 里那个 group 字段） */
export type BaseGroup = "通用" | "布局" | "导航" | "数据录入" | "数据展示" | "反馈" | "其他";

export type BasePlatform = "pc" | "mobile";

/**
 * 这个组件是**哪儿来的**（2026-08-08）。
 *
 * 此前目录里只有 antd 与 antd-mobile，来源不言自明所以没有这一栏。加它是因为
 * 用户提了一句要害的话：「基础组件是不是可以增加一项『自定义组件』」。
 *
 * 查了一遍供给才发现这一栏早就该有了：
 *
 *     antd（桌面）        库里 78 个，目录收了 67 —— **基本到顶**
 *     antd-mobile（手机）  库里 83 个，目录收了 72 —— 也基本到顶
 *     pro-components      库里 118 个，目录收了 1  —— **已经装着，几乎没登记**
 *     自定义（非组件库）    ECharts 一个，一直混在里面没标出来
 *
 * pro-components 那 117 个是最扎眼的一条：区块渲染器天天在用（ProTable /
 * 35 个 ProForm* / ProCard / DrawerForm / StepsForm 全在跑），但目录里没有，
 * 于是**AI 组装区块时看不见它们**。这跟"139 个里 118 个没被区块用上"是同一个
 * 病的反面——那边是登记了没人用，这边是用着却没登记。
 *
 * 标出来之后，"下一个量级从哪来"这个问题在界面上就能直接看见答案。
 */
export type BaseSource = "antd" | "antd-mobile" | "pro-components" | "custom";

export interface BaseComponentDef {
  /** 组件名，与官方一致（Input / DatePicker…） */
  name: string;
  /** 中文名，官方 subtitle */
  label: string;
  /** 一句话说明，官方 description 的精简版 */
  description: string;
  group: BaseGroup;
  platform: BasePlatform;
  /** 出处。不填按 antd / antd-mobile 推（见 BASE_COMPONENTS 的组装处）。 */
  source?: BaseSource;
  /** 通用示例。**不带业务数据**——出现"订单""门店"就是滑回业务积木那层了 */
  render: () => React.ReactNode;
}
