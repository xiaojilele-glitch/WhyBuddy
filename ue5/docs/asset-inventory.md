# 完整资产清单

## 概述

本文档列出 WhyBuddy UE5 项目中的所有资产，包括静态网格体、材质实例、贴图、蓝图和关卡。所有资产遵循 `ue5/docs/naming-conventions.md` 中定义的命名规范，存放在 `Content/CubePets/` 目录下。

---

## 1. 静态网格体（Static Mesh）

### 1.1 工位区家具

| 编号 | 资产名称 | 来源 | 估计面数 | LOD 级别 | 说明 |
|------|----------|------|----------|----------|------|
| 1 | SM_Desk_01 | Kenney | ~800 | 2 | 办公桌第 1 号变体 |
| 2 | SM_Desk_02 | Kenney | ~750 | 2 | 办公桌第 2 号变体 |
| 3 | SM_Chair_Office_01 | Kenney | ~1200 | 2 | 办公椅（带扶手、脚轮） |
| 4 | SM_Monitor_01 | Kenney | ~600 | 2 | 显示器 |
| 5 | SM_Keyboard_01 | Kenney | ~400 | 2 | 键盘 |
| 6 | SM_Mouse_01 | Kenney | ~200 | 2 | 鼠标 |
| 7 | SM_Laptop_01 | Kenney | ~500 | 2 | 笔记本电脑 |
| 8 | SM_Lamp_Table_01 | Kenney | ~300 | 2 | 桌面台灯 |

### 1.2 会议区家具

| 编号 | 资产名称 | 来源 | 估计面数 | LOD 级别 | 说明 |
|------|----------|------|----------|----------|------|
| 9 | SM_Table_Meeting_01 | Kenney | ~600 | 2 | 会议桌 |
| 10 | SM_Chair_Rounded_01 | Kenney | ~1000 | 2 | 会议椅（圆形靠背） |
| 11 | SM_Whiteboard_01 | Kenney + 自定义 | ~500 | 2 | 白板（含支架） |
| 12 | SM_Projector_Screen_01 | 自定义 | ~200 | 1 | 投影幕布 |

### 1.3 休息区家具

| 编号 | 资产名称 | 来源 | 估计面数 | LOD 级别 | 说明 |
|------|----------|------|----------|----------|------|
| 13 | SM_Sofa_01 | Kenney | ~1500 | 2 | 沙发 |
| 14 | SM_Chair_Lounge_01 | Kenney | ~800 | 2 | 休闲椅 |
| 15 | SM_Table_Coffee_01 | Kenney | ~400 | 2 | 茶几 |
| 16 | SM_SideTable_01 | Kenney | ~300 | 2 | 边桌 |
| 17 | SM_WaterDispenser_01 | Kenney | ~500 | 2 | 饮水机 |

### 1.4 走廊与装饰

| 编号 | 资产名称 | 来源 | 估计面数 | LOD 级别 | 说明 |
|------|----------|------|----------|----------|------|
| 18 | SM_Shelf_01 | Kenney | ~600 | 2 | 书架 |
| 19 | SM_Shelf_02 | Kenney | ~550 | 2 | 书架变体 |
| 20 | SM_Books_01 | Kenney | ~400 | 2 | 书本组合 A |
| 21 | SM_Books_02 | Kenney | ~350 | 2 | 书本组合 B |
| 22 | SM_CoatRack_01 | Kenney | ~300 | 2 | 衣帽架 |
| 23 | SM_Plant_01 | Kenney | ~800 | 2 | 盆栽绿植 A |
| 24 | SM_Plant_02 | Kenney | ~750 | 2 | 盆栽绿植 B |
| 25 | SM_Plant_03 | Kenney | ~700 | 2 | 盆栽绿植 C |
| 26 | SM_Lamp_Floor_01 | Kenney | ~400 | 2 | 落地灯 |
| 27 | SM_Lamp_Wall_01 | Kenney | ~200 | 2 | 壁灯 |
| 28 | SM_Picture_Frame_01 | Kenney | ~150 | 1 | 装饰画框 A |
| 29 | SM_Picture_Frame_02 | Kenney | ~150 | 1 | 装饰画框 B |
| 30 | SM_Rug_01 | 自定义 | ~100 | 1 | 地毯 |

### 1.5 建筑结构

| 编号 | 资产名称 | 来源 | 估计面数 | LOD 级别 | 说明 |
|------|----------|------|----------|----------|------|
| 31 | SM_Wall_Back | 自定义 | ~12 | 1 | 后墙（18m × 3m） |
| 32 | SM_Wall_Left | 自定义 | ~12 | 1 | 左侧墙（14m × 3m） |
| 33 | SM_Wall_Right | 自定义 | ~12 | 1 | 右侧墙（14m × 3m） |
| 34 | SM_Floor_Main | 自定义 | ~24 | 1 | 主地板（18m × 14m，三层） |
| 35 | SM_Ceiling_01 | 自定义 | ~8 | 1 | 天花板 |
| 36 | SM_Baseboard_Back | 自定义 | ~8 | 1 | 后墙踢脚线 |
| 37 | SM_Baseboard_Left | 自定义 | ~8 | 1 | 左侧踢脚线 |
| 38 | SM_Baseboard_Right | 自定义 | ~8 | 1 | 右侧踢脚线 |
| 39 | SM_Door_Frame_01 | Kenney | ~200 | 1 | 门框 |
| 40 | SM_Glass_Partition_01 | 自定义 | ~50 | 1 | 玻璃隔板 |

### 1.6 互动道具

| 编号 | 资产名称 | 来源 | 估计面数 | LOD 级别 | 说明 |
|------|----------|------|----------|----------|------|
| 41 | SM_CorkBoard_01 | 自定义 | ~100 | 1 | 软木板 |
| 42 | SM_StickyNote_01 | 自定义 | ~8 | 1 | 便签（多色变体） |
| 43 | SM_Trash_Bin_01 | Kenney | ~200 | 1 | 垃圾桶 |
| 44 | SM_Cup_01 | Kenney | ~150 | 1 | 杯子 |
| 45 | SM_Phone_01 | Kenney | ~200 | 1 | 电话 |

**静态网格体总计：45+ 个**

---

## 2. 材质实例（Material Instance）

### 2.1 主材质

| 编号 | 资产名称 | 类型 | 说明 |
|------|----------|------|------|
| 1 | MM_Office_Master | Master Material | 办公室通用主材质（支持 BC/N/ORM + 顶点色） |

### 2.2 木材类

| 编号 | 资产名称 | 基础色 (sRGB) | Roughness | Metallic | 说明 |
|------|----------|---------------|-----------|----------|------|
| 2 | MI_Wood_Light | #CBB596 | 0.84 | 0.0 | 浅色木材 |
| 3 | MI_Wood_Dark | #8C765F | 0.84 | 0.0 | 深色木材 |
| 4 | MI_Wood_Warm | #8E775F | 0.82 | 0.0 | 暖色木材 |
| 5 | MI_Wood_Rich | #90755B | 0.86 | 0.0 | 深暖木材 |
| 6 | MI_Wood_Leg | #6F5B48 | 0.86 | 0.0 | 深色木腿 |

### 2.3 织物类

| 编号 | 资产名称 | 基础色 (sRGB) | Roughness | Metallic | 说明 |
|------|----------|---------------|-----------|----------|------|
| 7 | MI_Fabric_Blue | #2563EB | 0.92 | 0.0 | 蓝色织物 |
| 8 | MI_Fabric_Gray | #6B7280 | 0.92 | 0.0 | 灰色织物 |
| 9 | MI_Fabric_Orange | #D97706 | 0.90 | 0.0 | 橙色织物 |
| 10 | MI_Fabric_Green | #059669 | 0.90 | 0.0 | 绿色织物 |
| 11 | MI_Fabric_Purple | #7C3AED | 0.90 | 0.0 | 紫色织物 |

### 2.4 金属类

| 编号 | 资产名称 | 基础色 (sRGB) | Roughness | Metallic | 说明 |
|------|----------|---------------|-----------|----------|------|
| 12 | MI_Metal_Chrome | #C0C0C0 | 0.25 | 0.90 | 铬金属 |
| 13 | MI_Metal_Brushed | #A0A0A0 | 0.45 | 0.80 | 拉丝金属 |
| 14 | MI_Metal_DarkSteel | #56483D | 0.56 | 0.12 | 深色钢材 |
| 15 | MI_Metal_Brass | #8B6914 | 0.70 | 0.60 | 黄铜 |

### 2.5 塑料类

| 编号 | 资产名称 | 基础色 (sRGB) | Roughness | Metallic | 说明 |
|------|----------|---------------|-----------|----------|------|
| 16 | MI_Plastic_White | #F9F7F2 | 0.72 | 0.0 | 白色塑料 |
| 17 | MI_Plastic_Black | #2D2D2D | 0.68 | 0.0 | 黑色塑料 |
| 18 | MI_Plastic_Cream | #FFF5E2 | 0.52 | 0.0 | 奶油色塑料 |

### 2.6 墙面与建筑类

| 编号 | 资产名称 | 基础色 (sRGB) | Roughness | 说明 |
|------|----------|---------------|-----------|------|
| 19 | MI_Wall_Back | #D8C8B7 | 0.98 | 后墙 |
| 20 | MI_Wall_Side | #D2C2B2 | 0.98 | 侧墙 |
| 21 | MI_Baseboard_Back | #B39C83 | 1.00 | 后墙踢脚线 |
| 22 | MI_Baseboard_Side | #AE9881 | 1.00 | 侧墙踢脚线 |

### 2.7 地板类

| 编号 | 资产名称 | 基础色 (sRGB) | Roughness | 说明 |
|------|----------|---------------|-----------|------|
| 23 | MI_Floor_Outer | #CBB596 | 0.90 | 外层地板 |
| 24 | MI_Floor_Middle | #D8C2A5 | 0.94 | 中层地板 |
| 25 | MI_Floor_Inner | #E4D2BA | 0.98 | 内层地板 |
| 26 | MI_Floor_Shadow | #8C765F | 0.90 | 地板阴影条纹 |

### 2.8 特殊用途类

| 编号 | 资产名称 | 说明 |
|------|----------|------|
| 27 | MI_Cork | 软木板 |
| 28 | MI_Frame_Brass | 相框/边框 |
| 29 | MI_Whiteboard | 白板面板 |
| 30 | MI_Glass_Frosted | 磨砂玻璃隔板 |
| 31 | MI_StickyNote_Yellow | 黄色便签 |
| 32 | MI_StickyNote_Blue | 蓝色便签 |
| 33 | MI_StickyNote_Gold | 金色便签 |
| 34 | MI_StickyNote_LightBlue | 浅蓝便签 |
| 35 | MI_StickyNote_Pink | 粉色便签 |
| 36 | MI_ZoneBase | 区域地面标识 |

### 2.9 Kenney 模型专用

| 编号 | 资产名称 | 说明 |
|------|----------|------|
| 37 | MI_Kenney_Default | Kenney 模型默认顶点色 |
| 38 | MI_Kenney_Matte | Kenney 模型哑光变体 |

**材质实例总计：38 个（含 1 个 Master Material）**

---

## 3. 贴图（Texture）

### 3.1 木材贴图组

| 编号 | 资产名称 | 类型 | 分辨率 | 说明 |
|------|----------|------|--------|------|
| 1 | T_Wood_BC | BaseColor | 2048² | 木材基础颜色 |
| 2 | T_Wood_N | Normal | 2048² | 木材法线 |
| 3 | T_Wood_ORM | ORM | 2048² | 木材 AO/Roughness/Metallic |

### 3.2 织物贴图组

| 编号 | 资产名称 | 类型 | 分辨率 | 说明 |
|------|----------|------|--------|------|
| 4 | T_Fabric_BC | BaseColor | 2048² | 织物基础颜色 |
| 5 | T_Fabric_N | Normal | 2048² | 织物法线 |
| 6 | T_Fabric_ORM | ORM | 2048² | 织物 AO/Roughness/Metallic |

### 3.3 金属贴图组

| 编号 | 资产名称 | 类型 | 分辨率 | 说明 |
|------|----------|------|--------|------|
| 7 | T_Metal_BC | BaseColor | 2048² | 金属基础颜色 |
| 8 | T_Metal_N | Normal | 2048² | 金属法线 |
| 9 | T_Metal_ORM | ORM | 2048² | 金属 AO/Roughness/Metallic |

### 3.4 塑料贴图组

| 编号 | 资产名称 | 类型 | 分辨率 | 说明 |
|------|----------|------|--------|------|
| 10 | T_Plastic_BC | BaseColor | 1024² | 塑料基础颜色 |
| 11 | T_Plastic_N | Normal | 1024² | 塑料法线 |
| 12 | T_Plastic_ORM | ORM | 1024² | 塑料 AO/Roughness/Metallic |

### 3.5 混凝土/墙面贴图组

| 编号 | 资产名称 | 类型 | 分辨率 | 说明 |
|------|----------|------|--------|------|
| 13 | T_Concrete_BC | BaseColor | 2048² | 混凝土基础颜色 |
| 14 | T_Concrete_N | Normal | 2048² | 混凝土法线 |
| 15 | T_Concrete_ORM | ORM | 2048² | 混凝土 AO/Roughness/Metallic |

### 3.6 地板贴图组

| 编号 | 资产名称 | 类型 | 分辨率 | 说明 |
|------|----------|------|--------|------|
| 16 | T_Floor_Wood_BC | BaseColor | 2048² | 木地板基础颜色 |
| 17 | T_Floor_Wood_N | Normal | 2048² | 木地板法线 |
| 18 | T_Floor_Wood_ORM | ORM | 2048² | 木地板 AO/Roughness/Metallic |

### 3.7 通用/工具贴图

| 编号 | 资产名称 | 类型 | 分辨率 | 说明 |
|------|----------|------|--------|------|
| 19 | T_Default_White | BaseColor | 4² | 默认白色贴图 |
| 20 | T_Default_Normal | Normal | 4² | 默认平面法线 |
| 21 | T_Default_ORM | ORM | 4² | 默认 ORM |

**贴图总计：21 个（7 组 × 3 通道）**

> 注意：当前阶段 Kenney 模型使用顶点色，大部分贴图为预留资产。实际使用的贴图主要用于墙面、地板等自建几何体的细节增强。

---

## 4. 蓝图（Blueprint）

### 4.1 家具蓝图

| 编号 | 资产名称 | 类型 | 说明 |
|------|----------|------|------|
| 1 | BP_Desk | Actor BP | 办公桌蓝图（含桌面物品插槽） |
| 2 | BP_CorkBoard | Actor BP | 软木板蓝图（含便签交互） |
| 3 | BP_MobileBoard | Actor BP | 移动白板蓝图（含书写交互） |
| 4 | BP_TaskCart | Actor BP | 任务推车蓝图（含物品放置） |
| 5 | BP_MeetingSet | Actor BP | 会议桌椅组合蓝图 |

### 4.2 灯光预设蓝图

| 编号 | 资产名称 | 类型 | 说明 |
|------|----------|------|------|
| 6 | BP_LightingPreset | Actor BP | 灯光预设控制器（日间/夜间/会议/演示） |
| 7 | BP_DayLight | 子蓝图 | 日间灯光预设 |
| 8 | BP_NightLight | 子蓝图 | 夜间灯光预设 |
| 9 | BP_MeetingLight | 子蓝图 | 会议灯光预设 |
| 10 | BP_PresentationLight | 子蓝图 | 演示灯光预设 |

### 4.3 交互蓝图

| 编号 | 资产名称 | 类型 | 说明 |
|------|----------|------|------|
| 11 | BP_Chair | Actor BP | 椅子蓝图（可旋转） |
| 12 | BP_Monitor | Actor BP | 显示器蓝图（可显示内容） |
| 13 | BP_Whiteboard | Actor BP | 白板蓝图（可书写） |
| 14 | BP_WaterDispenser | Actor BP | 饮水机蓝图（可交互） |

**蓝图总计：14 个**

---

## 5. 关卡（Map / Level）

| 编号 | 资产名称 | 类型 | 说明 |
|------|----------|------|------|
| 1 | L_Office_Main | Persistent Level | 办公室主关卡（持久关卡） |
| 2 | L_Office_WorkArea | Sub Level | 工位区子关卡 |
| 3 | L_Office_MeetingRoom | Sub Level | 会议室子关卡 |
| 4 | L_Office_Lounge | Sub Level | 休息区子关卡 |
| 5 | L_Office_Corridor | Sub Level | 走廊子关卡 |

**关卡总计：5 个（1 主关卡 + 4 子关卡）**

### 关卡组织说明

- `L_Office_Main` 作为持久关卡，负责加载各子关卡
- 每个子关卡对应一个功能区域，支持 Level Streaming 按需加载
- 子关卡之间共享建筑结构（墙面、地板、天花板在主关卡中）
- 灯光预设蓝图放置在主关卡中，控制全场景灯光

---

## 6. 资产统计汇总

| 资产类别 | 数量 | 说明 |
|----------|------|------|
| 静态网格体（Static Mesh） | 45+ | Kenney 模型 + 自建几何体 |
| 材质实例（Material Instance） | 38 | 含 1 个 Master Material |
| 贴图（Texture） | 21 | 7 组 PBR 贴图 + 3 个默认贴图 |
| 蓝图（Blueprint） | 14 | 家具 + 灯光 + 交互 |
| 关卡（Map） | 5 | 1 主关卡 + 4 子关卡 |
| **总计** | **123+** | |

### 面数预算

| 区域 | 物体数量 | 估计总面数 |
|------|----------|-----------|
| 工位区（×4 组） | ~32 个物体 | ~28,000 |
| 会议区 | ~10 个物体 | ~8,000 |
| 休息区 | ~8 个物体 | ~5,000 |
| 走廊与装饰 | ~15 个物体 | ~6,000 |
| 建筑结构 | ~10 个几何体 | ~200 |
| **场景总计** | **~75 个物体** | **~47,200** |

> 场景总面数远低于 200 万三角面预算。Kenney 低多边形风格的优势在于极低的几何复杂度，性能瓶颈更可能出现在灯光（Lumen）和材质（Shader 复杂度）而非网格面数。

---

## 7. 目录结构

```
Content/CubePets/
├── Environment/
│   ├── Office/
│   │   ├── Meshes/              # 45+ 静态网格体
│   │   │   ├── SM_Desk_01
│   │   │   ├── SM_Chair_Office_01
│   │   │   ├── SM_Shelf_01
│   │   │   └── ...
│   │   ├── Materials/            # 38 材质实例
│   │   │   ├── MM_Office_Master
│   │   │   ├── MI_Wood_Light
│   │   │   ├── MI_Fabric_Blue
│   │   │   └── ...
│   │   ├── Textures/             # 21 贴图
│   │   │   ├── T_Wood_BC
│   │   │   ├── T_Wood_N
│   │   │   ├── T_Wood_ORM
│   │   │   └── ...
│   │   ├── Blueprints/           # 14 蓝图
│   │   │   ├── BP_Desk
│   │   │   ├── BP_CorkBoard
│   │   │   ├── BP_LightingPreset
│   │   │   └── ...
│   │   └── Lighting/             # 灯光预设数据
│   │       ├── BP_DayLight
│   │       ├── BP_NightLight
│   │       └── ...
│   └── Props/                    # 通用道具
├── Maps/                         # 5 关卡
│   ├── L_Office_Main
│   ├── L_Office_WorkArea
│   ├── L_Office_MeetingRoom
│   ├── L_Office_Lounge
│   └── L_Office_Corridor
```

---

## 8. 文件引用

| 文件 | 说明 |
|------|------|
| `ue5/docs/naming-conventions.md` | 资产命名规范与目录组织 |
| `ue5/docs/material-system.md` | 材质系统设计（含完整参数表） |
| `ue5/docs/lighting-system.md` | 灯光系统配置 |
| `ue5/docs/lod-performance-guide.md` | LOD 与性能优化指南 |
