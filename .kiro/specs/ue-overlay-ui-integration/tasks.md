<!--
 * @Author: wangchunji
 * @Date: 2026-04-28 11:24:15
 * @Description: 
 * @LastEditTime: 2026-04-28 13:48:00
 * @LastEditors: wangchunji
-->
# 任务清单：UI 浮层叠加集成

## 任务

- [x] 1. 实现分层渲染容器
  - [x] 1.1 创建 OverlayContainer 组件，管理视频层、UI 层、HUD 层的 z-index
  - [x] 1.2 实现视频流自适应容器尺寸与宽高比保持
  - [x] 1.3 实现 UI 浮层半透明背景与 backdrop-filter

- [x] 2. 实现事件穿透策略
  - [x] 2.1 为 UI 浮层设置 pointer-events: none 基础策略
  - [x] 2.2 为所有可交互 UI 元素设置 pointer-events: auto
  - [x] 2.3 实现可配置的穿透区域定义
  - [x] 2.4 验证拖拽操作在穿透区域的正确性

- [x] 3. 实现 HUD 跟踪系统
  - [x] 3.1 接收 UE 侧推送的角色屏幕坐标
  - [x] 3.2 实现 HUD 元素（名称标签、状态图标）的绝对定位渲染
  - [x] 3.3 实现 HUD 元素的可见性控制（遮挡 / 离屏时隐藏）
  - [x] 3.4 实现 HUD 元素的距离缩放

- [x] 4. 适配现有 UI 组件
  - [x] 4.1 将侧边栏组件迁移到 OverlayContainer 内
  - [x] 4.2 将任务面板组件迁移到 OverlayContainer 内
  - [x] 4.3 将发起面板组件迁移到 OverlayContainer 内
  - [x] 4.4 验证所有现有 UI 交互在浮层模式下正常工作

- [x] 5. 实现响应式适配
  - [x] 5.1 实现桌面端（≥1280px）完整布局
  - [x] 5.2 实现窄屏（<1280px）折叠布局
  - [x] 5.3 实现 HUD 元素随视频缩放的位置调整

- [-] 6. 测试与回归
  - [x] 6.1 编写事件穿透的自动化测试
  - [x] 6.2 编写 HUD 坐标同步的集成测试
  - [~] 6.3 进行桌面端与窄屏的视觉回归测试
