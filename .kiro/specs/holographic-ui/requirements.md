<!--
 * @Author: wangchunji
 * @Date: 2026-04-07 13:33:55
 * @Description: 
 * @LastEditTime: 2026-04-07 13:44:58
 * @LastEditors: wangchunji
-->
# Holographic Command Deck UI 升级 需求文档

## 概述

将 WhyBuddy 前端从扁平白板风格升级为"全息操控舱 (Holographic Command Deck)"风格——毛玻璃拟态 + 有机科幻。目标是让用户感觉在操控高科技的微观数字生命体系统，而不是在看一个普通的 Web 应用。

## 用户故事

### US-1: 全局材质升级——毛玻璃拟态
作为用户，我希望所有面板和卡片都有半透明毛玻璃质感，能透出 3D 场景的光影，这样 UI 和 3D 场景融为一体而不是互相遮挡。

#### 验收标准
- AC-1.1: 所有 `bg-white` 实底背景替换为 `bg-white/40 dark:bg-black/40` + `backdrop-blur-xl`
- AC-1.2: 所有面板边框改为 1px 半透明白边 `border-white/20`
- AC-1.3: 阴影升级为多层阴影 `shadow-[0_8px_32px_rgba(0,0,0,0.12)]`
- AC-1.4: 深色模式下自动切换为暗色毛玻璃 `bg-black/40`
- AC-1.5: 滚动条样式与毛玻璃风格统一

### US-2: 胶囊状悬浮 Dock 栏
作为用户，我希望底部导航不再是沉底的长条，而是一个悬浮在 3D 场景上方的胶囊型 Dock，类似 macOS Dock 的交互体验。

#### 验收标准
- AC-2.1: Dock 栏为水平胶囊形状，居中悬浮在底部，距底边 16-24px
- AC-2.2: Dock 背景为毛玻璃材质 `bg-white/30 backdrop-blur-2xl`，圆角 `rounded-full`
- AC-2.3: 鼠标悬停图标时，图标产生弹簧放大动效（scale 1.0 → 1.3，spring 物理曲线）
- AC-2.4: 悬停图标时，相邻图标也有轻微放大（scale 1.0 → 1.1），形成"鱼眼"效果
- AC-2.5: 活跃图标下方有发光指示点
- AC-2.6: Dock 不遮挡 3D 场景的核心区域，z-index 高于 3D Canvas 但低于弹窗

### US-3: 侧边全息抽屉面板
作为用户，我希望工作流面板、聊天面板等从右侧滑入，作为全高吸附式抽屉存在，不遮挡底部 Dock 栏。

#### 验收标准
- AC-3.1: 右侧面板从屏幕右边缘滑入，高度为 `calc(100vh - Dock高度 - 顶部间距)`
- AC-3.2: 面板背景为毛玻璃材质，与全局风格统一
- AC-3.3: 面板打开时 3D 场景可见区域缩小但不消失（面板宽度最大 420px）
- AC-3.4: 面板关闭动画为向右滑出 + 淡出
- AC-3.5: 面板不遮挡底部 Dock 栏（bottom padding 留出 Dock 高度）

### US-4: 核心 CTA 按钮交互升级
作为用户，我希望"发布指令"等核心操作按钮有高饱和度渐变色和发光效果，让我一眼就能找到最重要的操作入口。

#### 验收标准
- AC-4.1: CTA 按钮背景为渐变色 `bg-gradient-to-r from-cyan-500 to-blue-600`
- AC-4.2: 鼠标悬停时按钮外围产生发光外晕 `shadow-[0_0_20px_rgba(6,182,212,0.5)]`
- AC-4.3: 点击时产生波纹扩散动画（ripple effect）
- AC-4.4: 按钮文字使用白色，字重 semibold
- AC-4.5: 禁用状态下渐变色降低饱和度，无发光效果

### US-5: 3D 场景内 UI 融合
作为用户，我希望 3D 场景中的 Agent 姓名牌和状态气泡也是毛玻璃材质，与整体风格统一，不再是突兀的实心色块。

#### 验收标准
- AC-5.1: Agent 姓名牌背景改为 `bg-black/50 backdrop-blur-md`，圆角 `rounded-lg`
- AC-5.2: 工作状态下姓名牌边框有呼吸光晕动画（border-color 在 cyan/blue 之间渐变循环）
- AC-5.3: 空闲状态下姓名牌边框为静态半透明白边
- AC-5.4: 状态文字颜色根据状态变化：working=cyan, thinking=amber, reviewing=purple, idle=white/60
- AC-5.5: Preview 模式警告条从底部移至顶部，改为半透明小条 `bg-amber-500/20 backdrop-blur-sm`

### US-6: 排版个性化
作为用户，我希望界面有科技感的排版风格，标题和数据使用不同的字体。

#### 验收标准
- AC-6.1: 标题字体使用 DM Sans / Noto Sans SC（Google Fonts 加载）
- AC-6.2: 数据/代码字体使用 JetBrains Mono
- AC-6.3: 正文字体保持 DM Sans
- AC-6.4: 字体加载使用 `font-display: swap` 避免 FOIT
- AC-6.5: 字体 CSS 变量定义在 `:root` 中，方便全局引用

### US-7: 微交互与动效
作为用户，我希望界面有流畅的微交互动效，增强操控感。

#### 验收标准
- AC-7.1: 面板展开/收起使用 spring 物理动画（framer-motion）
- AC-7.2: 卡片 hover 时有轻微上浮效果 `translateY(-2px)` + 阴影加深
- AC-7.3: 数据变化时数字有计数器滚动动画
- AC-7.4: 阶段切换时进度条有流体填充动画
- AC-7.5: 所有过渡动画时长 200-300ms，不超过 500ms
