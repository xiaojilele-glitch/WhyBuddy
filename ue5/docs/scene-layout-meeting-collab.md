# UE5 办公室会议与协作区场景布局规格

## 概述

本文档定义 WhyBuddy UE5 场景中会议与协作相关元素的精确放置规格，包括：

- **CorkBoard**（软木公告板）— 中央后墙
- **MobileBoard**（移动白板）— 每个 Pod 各 1 块，共 4 块
- **TaskCart**（任务推车）— 每个 Pod 各 1 辆，共 4 辆

本文档是 `scene-layout-work-areas.md` 的补充文档，聚焦于会议/协作类物件。MeetingSet（会议桌 + 椅子组合）的放置数据已在工位区文档中定义（Pod B 和 Pod C 各有一套），此处不再重复。

---

## 1. 坐标系映射（与 `scene-layout-room-shell.md` 一致）

### 1.1 位置转换公式

```
UE5_X =  ThreeJS_X × 100        (cm)
UE5_Y =  ThreeJS_Z × -100       (cm，Z 轴取反)
UE5_Z =  ThreeJS_Y × 100        (cm)
```

### 1.2 旋转转换公式

```
UE5_Yaw = -ThreeJS_RotationY × (180 / π)   (度)
```

> **注意**：Three.js 使用米（m）为单位，UE5 使用厘米（cm）为单位，统一缩放因子 = **100**。

---

## 2. CorkBoard（软木公告板）— 中央后墙

### 2.1 位置总览

CorkBoard 位于房间后墙中央，挂在墙面上方，是全办公室共享的信息展示区域。

### 2.2 Three.js 原始数据

| 属性 | 值 |
| ---- | -- |
| 位置 | (0, 2.02, -4.72) |
| 旋转 | 无 |

### 2.3 UE5 放置数据

| 属性 | UE5 值 |
| ---- | ------ |
| 位置 (cm) | (0, 472, 202) |
| Yaw (°) | 0 |

### 2.4 构造细节

CorkBoard 是一个组合件，包含以下子物体：

| 子物体 | 尺寸 (cm) | 颜色 | 说明 |
| ------ | --------- | ---- | ---- |
| 主板面 | 270 × 6 × 116 (W × D × H) | #C4956A（软木色） | 软木板主体 |
| 外框 | 286 × 3 × 129 (W × D × H) | #8B6914（深金色木框） | 包围主板面的装饰框 |
| 便签 A | 小尺寸 | 彩色 | 贴在板面上的便签纸 |
| 便签 B | 小尺寸 | 彩色 | 贴在板面上的便签纸 |

> **UE5 搭建说明**：
> - 主板面和外框的 Pivot 应在底面中心
> - 外框略大于主板面，形成边框效果
> - 便签作为 Decal 或小型 Static Mesh 贴附在板面上
> - 建议创建 `BP_CorkBoard` Blueprint Actor 统一管理

### 2.5 材质建议

| 部件 | 材质实例 | 说明 |
| ---- | -------- | ---- |
| 主板面 | MI_Cork_Board | BaseColor=#C4956A，粗糙度偏高 |
| 外框 | MI_Wood_DarkGold | BaseColor=#8B6914，木质纹理 |
| 便签 | MI_StickyNote_Color | 彩色不透明材质 |

---

## 3. MobileBoard（移动白板）— 4 块

### 3.1 位置总览

每个 Pod 配备 1 块移动白板，用于团队协作和头脑风暴。

### 3.2 放置表

| Pod | Three.js 位置 | Three.js 旋转 Y | UE5 位置 (cm) | UE5 Yaw (°) | 说明 |
| --- | ------------- | --------------- | ------------- | ------------ | ---- |
| Pod A | (-5.92, 0, -1.15) | π/2 ≈ 1.5708 | (-592, 115, 0) | -90.0 | 左后方，面朝右 |
| Pod B | (5.95, 0, -2.45) | -π/2.3 ≈ -1.3653 | (595, 245, 0) | 78.3 | 右后方，斜向 |
| Pod C | (-5.98, 0, 1.48) | π/2 ≈ 1.5708 | (-598, -148, 0) | -90.0 | 左前方，面朝右 |
| Pod D | (5.95, 0, 1.58) | -π/2 ≈ -1.5708 | (595, -158, 0) | 90.0 | 右前方，面朝左 |

### 3.3 构造细节

每块 MobileBoard 是一个组合件，包含以下子物体（相对于组合件原点的局部偏移）：

| 子物体 | 说明 |
| ------ | ---- |
| 白板面 | 1.18m × 0.88m (118 × 88 cm) 白色书写面 |
| 彩色条带 | 白板顶部或底部的 Pod 标识色条 |
| 支撑腿 | 两根立柱 + 底部横杆，带脚轮 |
| 便签 | 贴在白板面上的小便签 |
| 标签 | Pod 标识文字（HTML label 在 Three.js 中，UE5 中用 TextRender 或 Widget） |

> **UE5 搭建说明**：
> - 建议创建 `BP_MobileBoard` Blueprint Actor
> - 白板面使用高反射白色材质（MI_Whiteboard_Surface）
> - 彩色条带颜色按 Pod 区分（A=蓝、B=绿、C=橙、D=紫，具体参考 Three.js 源码）
> - 支撑腿使用金属材质
> - 标签在 UE5 中可用 TextRenderComponent 或 UMG Widget

---

## 4. TaskCart（任务推车）— 4 辆

### 4.1 位置总览

每个 Pod 配备 1 辆任务推车，用于存放文件和办公用品。

### 4.2 放置表

| Pod | Three.js 位置 | Three.js 旋转 Y | UE5 位置 (cm) | UE5 Yaw (°) | 说明 |
| --- | ------------- | --------------- | ------------- | ------------ | ---- |
| Pod A | (-5.25, 0, -2.72) | π/8 ≈ 0.3927 | (-525, 272, 0) | -22.5 | 左后方 |
| Pod B | (2.05, 0, -2.52) | -π/10 ≈ -0.3142 | (205, 252, 0) | 18.0 | 右后方 |
| Pod C | (-1.98, 0, 2.62) | π/7 ≈ 0.4488 | (-198, -262, 0) | -25.7 | 左前方 |
| Pod D | (1.96, 0, 2.88) | -π/8 ≈ -0.3927 | (196, -288, 0) | 22.5 | 右前方 |

### 4.3 构造细节

TaskCart 是一个小型推车，包含：

| 子物体 | 说明 |
| ------ | ---- |
| 推车框架 | 金属框架，2-3 层搁板 |
| 搁板 | 放置文件、笔筒等 |
| 脚轮 | 底部 4 个小轮 |

> **UE5 搭建说明**：
> - 可使用 Kenney Furniture Kit 中的推车模型，或自建简单几何体
> - 建议创建 `BP_TaskCart` Blueprint Actor
> - 金属框架使用 MI_Metal_Chrome 或类似材质

---

## 5. MeetingSet 参考（已在工位区文档中定义）

MeetingSet（会议桌 + 3 把椅子）的放置数据已在 `scene-layout-work-areas.md` 中定义：

| Pod | UE5 位置 (cm) | UE5 Yaw (°) | 说明 |
| --- | ------------- | ------------ | ---- |
| Pod B | (485, 142, 0) | 22.5 | 右后方会议区 |
| Pod C | (-355, -228, 0) | -18.0 | 左前方会议区 |

MeetingSet 子组件偏移（局部空间）：

| 子物体 | 模型 | 局部位置 (cm) | 局部旋转 |
| ------ | ---- | ------------- | -------- |
| 圆桌 | SM_Table_Round_01 | (0, 0, 0) | — |
| 椅子 A（右） | SM_Chair_Rounded_01 | (95, 0, 0) | Yaw=90° |
| 椅子 B（左） | SM_Chair_Rounded_01 | (-95, 0, 0) | Yaw=-90° |
| 椅子 C（前） | SM_Chair_Rounded_01 | (0, -95, 0) | Yaw=180° |

---

## 6. 会议与协作区搭建步骤

### 6.1 推荐搭建顺序

1. **放置 CorkBoard**：在后墙中央 `(0, 472, 202)` 挂载公告板组合件。
2. **放置 4 块 MobileBoard**：按 Pod A → D 顺序，依次放置移动白板。
3. **放置 4 辆 TaskCart**：按 Pod A → D 顺序，依次放置任务推车。
4. **检查 MeetingSet**：确认 Pod B 和 Pod C 的会议桌组合已正确放置（参考工位区文档）。

### 6.2 Blueprint 组合件建议

| Blueprint | 包含子物体 | 说明 |
| --------- | ---------- | ---- |
| BP_CorkBoard | 主板面 + 外框 + 便签 | 挂墙式公告板 |
| BP_MobileBoard | 白板面 + 彩色条带 + 支撑腿 + 便签 + 标签 | 可移动白板 |
| BP_TaskCart | 推车框架 + 搁板 + 脚轮 | 任务推车 |
| BP_MeetingSet | 圆桌 + 3 把椅子 | 会议桌组合（已在工位区定义） |

### 6.3 注意事项

- CorkBoard 的 Z 坐标为 202cm（UE5），表示板面中心距地面约 2.02m，需确保挂在后墙面上。
- MobileBoard 和 TaskCart 的 Z 坐标为 0（UE5），表示底部在地面上。
- 所有旋转值均为 Yaw（绕 Z 轴），Pitch 和 Roll 保持为 0。
- 彩色条带和便签的具体颜色请参考 `client/src/components/three/OfficeRoom.tsx` 中各 Pod 的配色方案。

---

## 7. 参考文件

- `client/src/components/three/OfficeRoom.tsx` — Three.js 源文件
- `ue5/docs/scene-layout-room-shell.md` — 房间外壳布局规格
- `ue5/docs/scene-layout-work-areas.md` — 工位区布局规格（含 MeetingSet）
- `ue5/docs/naming-conventions.md` — UE5 资产命名规范
- `ue5/docs/furniture-import-guide.md` — 家具模型导入指南
- `ue5/Source/CubePetsOffice/SceneLayout/RoomShellData.h` — 房间外壳 C++ 常量
- `ue5/Source/CubePetsOffice/SceneLayout/WorkAreaData.h` — 工位区 C++ 常量
- `ue5/Source/CubePetsOffice/SceneLayout/MeetingCollabData.h` — 会议协作区 C++ 常量
