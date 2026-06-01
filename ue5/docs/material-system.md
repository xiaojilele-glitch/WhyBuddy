# UE5 材质系统设计文档

## 概述

本文档定义 WhyBuddy UE5 项目的完整材质系统，包括 Master Material 设计、材质实例参数、家具材质分配表以及 Kenney 模型顶点色支持方案。所有材质遵循 `ue5/docs/naming-conventions.md` 中定义的命名规范。

---

## 1. Master Material 设计（MM_Office_Master）

### 1.1 设计目标

- 使用单一 Master Material 覆盖办公室场景中所有非特殊材质需求
- 支持 PBR 工作流：BaseColor、Normal、ORM（Occlusion / Roughness / Metallic）
- 支持纯色 Tint 模式（无贴图时使用颜色参数驱动）
- 支持 Kenney 模型的顶点色（Vertex Color）模式
- 通过 Material Instance 调整参数，无需修改 Master Material 本身

### 1.2 参数列表

| 参数名（FName）              | 类型            | 默认值                     | 说明                                      |
| ---------------------------- | --------------- | -------------------------- | ----------------------------------------- |
| `BaseColorTint`              | LinearColor     | (1.0, 1.0, 1.0, 1.0)      | 基础颜色 Tint，与贴图相乘                 |
| `BaseColorTexture`           | Texture2D       | 白色默认贴图               | BaseColor 贴图（BC）                       |
| `NormalTexture`              | Texture2D       | 平面法线默认贴图           | 法线贴图（N）                              |
| `NormalIntensity`            | Scalar          | 1.0                        | 法线强度，0 = 无法线效果                   |
| `ORMTexture`                 | Texture2D       | 白色默认贴图               | ORM 合并贴图（R=AO, G=Roughness, B=Metal）|
| `Roughness`                  | Scalar          | 0.8                        | 粗糙度覆盖值（无 ORM 贴图时使用）         |
| `Metallic`                   | Scalar          | 0.0                        | 金属度覆盖值（无 ORM 贴图时使用）         |
| `AmbientOcclusion`           | Scalar          | 1.0                        | AO 覆盖值（无 ORM 贴图时使用）            |
| `EmissiveColor`              | LinearColor     | (0.0, 0.0, 0.0, 0.0)      | 自发光颜色                                |
| `EmissiveIntensity`          | Scalar          | 0.0                        | 自发光强度                                |
| `Opacity`                    | Scalar          | 1.0                        | 不透明度（仅 Translucent 模式生效）       |
| `UseVertexColor`             | StaticBool      | false                      | 是否使用顶点色替代 BaseColor 贴图         |
| `VertexColorIntensity`       | Scalar          | 1.0                        | 顶点色强度乘数                            |
| `UseTextures`                | StaticBool      | false                      | 是否使用贴图（false 时使用纯色 + 标量）   |
| `UVTiling`                   | Vector2D        | (1.0, 1.0)                 | UV 平铺缩放                               |

### 1.3 材质图逻辑

```
                    ┌─────────────────────────────────────────┐
                    │           MM_Office_Master               │
                    ├─────────────────────────────────────────┤
                    │                                         │
  UseVertexColor ──►│  if UseVertexColor:                     │
                    │    BaseColor = VertexColor * Tint        │
                    │  elif UseTextures:                       │
                    │    BaseColor = Tex(BC) * Tint             │
                    │  else:                                   │
                    │    BaseColor = Tint                       │
                    │                                         │
  UseTextures ────►│  if UseTextures:                         │
                    │    Normal = Tex(N) * NormalIntensity      │
                    │    AO = ORM.R, Rough = ORM.G, Metal = ORM.B │
                    │  else:                                   │
                    │    Normal = FlatNormal                    │
                    │    AO/Rough/Metal = Scalar overrides     │
                    │                                         │
                    │  Emissive = EmissiveColor * Intensity     │
                    │  Opacity = Opacity scalar                 │
                    └─────────────────────────────────────────┘
```

### 1.4 Static Switch 说明

- `UseVertexColor`：编译时分支，启用后 BaseColor 从顶点色读取。适用于 Kenney 模型。
- `UseTextures`：编译时分支，启用后从贴图采样 BC/N/ORM。适用于自制高精度材质。
- 两个开关均为 false 时，材质使用纯色 Tint + 标量参数，适用于低多边形风格化场景。

---

## 2. 材质实例完整列表

### 2.1 木材类

| 材质实例名         | BaseColorTint (sRGB)  | Roughness | Metallic | 说明                     |
| ------------------ | --------------------- | --------- | -------- | ------------------------ |
| `MI_Wood_Light`    | #CBB596 (0.80,0.71,0.59) | 0.84      | 0.0      | 浅色木材，桌面、架子     |
| `MI_Wood_Dark`     | #8C765F (0.55,0.46,0.37) | 0.84      | 0.0      | 深色木材，桌腿、白板支架 |
| `MI_Wood_Warm`     | #8E775F (0.56,0.47,0.37) | 0.82      | 0.0      | 暖色木材，装饰盒、书架   |
| `MI_Wood_Rich`     | #90755B (0.56,0.46,0.36) | 0.86      | 0.0      | 深暖木材，白板底座       |
| `MI_Wood_Leg`      | #6F5B48 (0.44,0.36,0.28) | 0.86      | 0.0      | 深色木腿、支撑结构       |

### 2.2 织物类

| 材质实例名         | BaseColorTint (sRGB)  | Roughness | Metallic | 说明                     |
| ------------------ | --------------------- | --------- | -------- | ------------------------ |
| `MI_Fabric_Blue`   | #2563EB (0.15,0.39,0.92) | 0.92      | 0.0      | 蓝色织物，椅子坐垫       |
| `MI_Fabric_Gray`   | #6B7280 (0.42,0.45,0.50) | 0.92      | 0.0      | 灰色织物，沙发           |
| `MI_Fabric_Orange` | #D97706 (0.85,0.47,0.02) | 0.90      | 0.0      | 橙色织物，装饰靠垫       |
| `MI_Fabric_Green`  | #059669 (0.02,0.59,0.41) | 0.90      | 0.0      | 绿色织物，休闲椅         |
| `MI_Fabric_Purple` | #7C3AED (0.49,0.23,0.93) | 0.90      | 0.0      | 紫色织物，装饰元素       |

### 2.3 金属类

| 材质实例名           | BaseColorTint (sRGB)  | Roughness | Metallic | 说明                     |
| -------------------- | --------------------- | --------- | -------- | ------------------------ |
| `MI_Metal_Chrome`    | #C0C0C0 (0.75,0.75,0.75) | 0.25      | 0.90     | 铬金属，椅子底座、灯架   |
| `MI_Metal_Brushed`   | #A0A0A0 (0.63,0.63,0.63) | 0.45      | 0.80     | 拉丝金属，桌腿金属件     |
| `MI_Metal_DarkSteel` | #56483D (0.34,0.28,0.24) | 0.56      | 0.12     | 深色钢材，脚轮、小五金   |
| `MI_Metal_Brass`     | #8B6914 (0.55,0.41,0.08) | 0.70      | 0.60     | 黄铜，相框、装饰条       |

### 2.4 塑料类

| 材质实例名           | BaseColorTint (sRGB)  | Roughness | Metallic | 说明                     |
| -------------------- | --------------------- | --------- | -------- | ------------------------ |
| `MI_Plastic_White`   | #F9F7F2 (0.98,0.97,0.95) | 0.72      | 0.0      | 白色塑料，键盘、鼠标     |
| `MI_Plastic_Black`   | #2D2D2D (0.18,0.18,0.18) | 0.68      | 0.0      | 黑色塑料，显示器外壳     |
| `MI_Plastic_Cream`   | #FFF5E2 (1.00,0.96,0.89) | 0.52      | 0.0      | 奶油色塑料，装饰物       |

### 2.5 墙面与建筑类

| 材质实例名           | BaseColorTint (sRGB)  | Roughness | Metallic | Opacity | 说明                 |
| -------------------- | --------------------- | --------- | -------- | ------- | -------------------- |
| `MI_Wall_Back`       | #D8C8B7 (0.85,0.78,0.72) | 0.98      | 0.0      | 1.0     | 后墙                 |
| `MI_Wall_Side`       | #D2C2B2 (0.82,0.76,0.70) | 0.98      | 0.0      | 1.0     | 侧墙                 |
| `MI_Baseboard_Back`  | #B39C83 (0.70,0.61,0.51) | 1.00      | 0.0      | 0.72    | 后墙踢脚线           |
| `MI_Baseboard_Side`  | #AE9881 (0.68,0.60,0.51) | 1.00      | 0.0      | 0.64    | 侧墙踢脚线           |

### 2.6 地板类

| 材质实例名           | BaseColorTint (sRGB)  | Roughness | Metallic | Opacity | 说明                 |
| -------------------- | --------------------- | --------- | -------- | ------- | -------------------- |
| `MI_Floor_Outer`     | #CBB596 (0.80,0.71,0.59) | 0.90      | 0.0      | 1.0     | 外层地板             |
| `MI_Floor_Middle`    | #D8C2A5 (0.85,0.76,0.65) | 0.94      | 0.0      | 1.0     | 中层地板             |
| `MI_Floor_Inner`     | #E4D2BA (0.89,0.82,0.73) | 0.98      | 0.0      | 0.62    | 内层地板（半透明）   |
| `MI_Floor_Shadow`    | #8C765F (0.55,0.46,0.37) | 0.90      | 0.0      | 0.14    | 地板阴影条纹         |

### 2.7 特殊用途类

| 材质实例名           | BaseColorTint (sRGB)  | Roughness | Metallic | 说明                     |
| -------------------- | --------------------- | --------- | -------- | ------------------------ |
| `MI_Cork`            | #C4956A (0.77,0.58,0.42) | 0.95      | 0.0      | 软木板                   |
| `MI_Frame_Brass`     | #8B6914 (0.55,0.41,0.08) | 0.70      | 0.60     | 相框/软木板边框           |
| `MI_Whiteboard`      | #F9F7F2 (0.98,0.97,0.95) | 0.92      | 0.0      | 白板面板                 |
| `MI_Glass_Frosted`   | #EDF4FB (0.93,0.96,0.98) | 0.25      | 0.12     | 磨砂玻璃隔板（半透明）   |
| `MI_StickyNote_Yellow`| #FFE4B5 (1.00,0.89,0.71) | 0.90      | 0.0      | 黄色便签                 |
| `MI_StickyNote_Blue` | #E3F2FD (0.89,0.95,0.99) | 0.90      | 0.0      | 蓝色便签                 |
| `MI_StickyNote_Gold` | #FDE68A (0.99,0.90,0.54) | 0.88      | 0.0      | 金色便签                 |
| `MI_StickyNote_LightBlue` | #BFDBFE (0.75,0.86,1.00) | 0.88  | 0.0      | 浅蓝便签                 |
| `MI_StickyNote_Pink` | #FBCFE8 (0.98,0.81,0.91) | 0.88      | 0.0      | 粉色便签                 |
| `MI_ZoneBase`        | 按区域颜色设置         | 0.80      | 0.0      | 区域地面标识（半透明）   |

### 2.8 Kenney 模型专用（顶点色模式）

| 材质实例名           | UseVertexColor | VertexColorIntensity | Roughness | 说明                     |
| -------------------- | -------------- | -------------------- | --------- | ------------------------ |
| `MI_Kenney_Default`  | true           | 1.0                  | 0.80      | Kenney 模型默认顶点色   |
| `MI_Kenney_Matte`    | true           | 0.9                  | 0.92      | Kenney 模型哑光变体     |

---

## 3. 材质分配表

### 3.1 工位区

| 模型                  | 材质槽位         | 材质实例                |
| --------------------- | ---------------- | ----------------------- |
| SM_Desk_01            | 桌面             | MI_Kenney_Default       |
| SM_Desk_01            | 桌腿（如分离）   | MI_Kenney_Default       |
| SM_Chair_Office_01    | 整体             | MI_Kenney_Default       |
| SM_Monitor_01         | 外壳             | MI_Kenney_Default       |
| SM_Keyboard_01        | 整体             | MI_Kenney_Default       |
| SM_Mouse_01           | 整体             | MI_Kenney_Default       |
| SM_Laptop_01          | 整体             | MI_Kenney_Default       |
| SM_Lamp_Table_01      | 整体             | MI_Kenney_Default       |

### 3.2 会议区

| 模型                  | 材质槽位         | 材质实例                |
| --------------------- | ---------------- | ----------------------- |
| SM_Table_Meeting_01   | 整体             | MI_Kenney_Default       |
| SM_Chair_Rounded_01   | 整体             | MI_Kenney_Default       |
| SM_Whiteboard_01      | 白板面           | MI_Whiteboard           |
| SM_Whiteboard_01      | 支架/腿          | MI_Wood_Dark            |
| SM_Whiteboard_01      | 顶部色条         | 按区域颜色设置          |
| SM_Whiteboard_01      | 底座             | MI_Wood_Rich            |

### 3.3 休息区

| 模型                  | 材质槽位         | 材质实例                |
| --------------------- | ---------------- | ----------------------- |
| SM_Sofa_01            | 整体             | MI_Kenney_Default       |
| SM_Chair_Lounge_01    | 整体             | MI_Kenney_Default       |
| SM_Table_Coffee_01    | 整体             | MI_Kenney_Default       |
| SM_SideTable_01       | 整体             | MI_Kenney_Default       |

### 3.4 走廊与装饰

| 模型                  | 材质槽位         | 材质实例                |
| --------------------- | ---------------- | ----------------------- |
| SM_Shelf_01           | 整体             | MI_Kenney_Default       |
| SM_Books_01           | 整体             | MI_Kenney_Default       |
| SM_CoatRack_01        | 整体             | MI_Kenney_Default       |
| SM_Plant_01/02/03     | 整体             | MI_Kenney_Default       |
| SM_Lamp_Floor_01      | 整体             | MI_Kenney_Default       |
| SM_Lamp_Wall_01       | 整体             | MI_Kenney_Default       |

### 3.5 建筑结构

| 模型/几何体           | 材质槽位         | 材质实例                |
| --------------------- | ---------------- | ----------------------- |
| 后墙                  | 墙面             | MI_Wall_Back            |
| 侧墙（左/右）        | 墙面             | MI_Wall_Side            |
| 后墙踢脚线            | 踢脚线           | MI_Baseboard_Back       |
| 侧墙踢脚线            | 踢脚线           | MI_Baseboard_Side       |
| 外层地板              | 地面             | MI_Floor_Outer          |
| 中层地板              | 地面             | MI_Floor_Middle         |
| 内层地板              | 地面             | MI_Floor_Inner          |
| 地板阴影条纹          | 地面             | MI_Floor_Shadow         |
| 软木板                | 板面             | MI_Cork                 |
| 软木板边框            | 边框             | MI_Frame_Brass          |
| 便签                  | 各色             | MI_StickyNote_*         |
| 墙角装饰              | 整体             | MI_Kenney_Default       |
| 门框                  | 整体             | MI_Kenney_Default       |
| 玻璃隔板              | 玻璃             | MI_Glass_Frosted        |

### 3.6 分配原则

1. **Kenney 模型优先使用顶点色**：所有从 Kenney Furniture Kit 导入的 `.glb` 模型默认使用 `MI_Kenney_Default`，保留原始顶点色。
2. **自建几何体使用纯色材质**：墙面、地板、踢脚线等 BSP/自建 Static Mesh 使用对应的纯色材质实例。
3. **特殊表面单独分配**：白板面、软木板、玻璃等特殊表面使用专用材质实例。
4. **区域标识使用半透明材质**：地面区域标识使用 `MI_ZoneBase`，颜色按部门设置。

---

## 4. 顶点色支持方案

### 4.1 Kenney 模型特点

Kenney Furniture Kit 的 `.glb` 模型使用顶点色（Vertex Color）而非 UV 贴图来定义颜色。导入 UE5 后，顶点色数据存储在 Static Mesh 的 `COLOR0` 通道中。

### 4.2 Master Material 中的顶点色支持

当 `UseVertexColor = true` 时：

```
BaseColor = VertexColor.RGB * BaseColorTint.RGB * VertexColorIntensity
```

这允许：
- 直接使用 Kenney 模型的原始配色
- 通过 `BaseColorTint` 微调整体色调
- 通过 `VertexColorIntensity` 调整亮度

### 4.3 导入设置建议

| 设置项                        | 推荐值           | 说明                           |
| ----------------------------- | ---------------- | ------------------------------ |
| Import Vertex Colors          | ✅ 启用          | 保留 glTF 顶点色数据          |
| Replace Vertex Colors         | ❌ 禁用          | 不覆盖原始顶点色              |
| Import Materials              | ❌ 禁用          | 使用自定义 Master Material     |
| Import Textures               | ❌ 禁用          | Kenney 模型无贴图              |
| Auto Generate Collision       | ✅ 启用          | 自动生成碰撞体                |
| Combine Meshes                | 视情况           | 单一物体建议合并               |

### 4.4 批量材质分配脚本

导入后可使用 Python 脚本批量为 Kenney 模型分配 `MI_Kenney_Default`：

```python
# 在 UE5 Python 控制台中执行
import unreal

asset_path = "/Game/CubePets/Environment/Office/Meshes/"
mi_path = "/Game/CubePets/Environment/Office/Materials/MI_Kenney_Default"

mi = unreal.EditorAssetLibrary.load_asset(mi_path)
assets = unreal.EditorAssetLibrary.list_assets(asset_path, recursive=True)

for asset in assets:
    if asset.endswith("_C"):
        continue
    obj = unreal.EditorAssetLibrary.load_asset(asset)
    if isinstance(obj, unreal.StaticMesh):
        for i in range(obj.get_num_sections(0)):
            obj.set_material(i, mi)
        unreal.EditorAssetLibrary.save_asset(asset)
```

---

## 5. 贴图分辨率指南

### 5.1 分辨率建议

| 资产类别         | 推荐分辨率     | 说明                           |
| ---------------- | -------------- | ------------------------------ |
| 主要家具         | 2048 × 2048    | 桌、椅、沙发等近景物体         |
| 小道具           | 1024 × 1024    | 键盘、鼠标、书本等             |
| 远景/装饰        | 512 × 512      | 远处植物、墙角装饰等           |
| 地板/墙面        | 2048 × 2048    | 大面积平面，需要细节           |
| 便签/标签        | 256 × 256      | 极小面积，低分辨率即可         |

### 5.2 当前阶段说明

当前阶段以 Kenney 低多边形风格为主，大部分模型使用顶点色而非贴图。贴图分辨率指南主要适用于：

- 后续添加自制高精度模型时
- 为墙面、地板添加细节纹理时
- 制作特殊效果材质（如白板上的内容）时

### 5.3 ORM 通道分配

所有 ORM 贴图统一使用以下通道分配：

| 通道 | 内容                | 说明                           |
| ---- | ------------------- | ------------------------------ |
| R    | Ambient Occlusion   | 环境光遮蔽，1.0 = 无遮蔽      |
| G    | Roughness           | 粗糙度，0.0 = 光滑，1.0 = 粗糙|
| B    | Metallic            | 金属度，0.0 = 非金属，1.0 = 金属|

### 5.4 贴图格式

- 导入格式：PNG 或 TGA（无损）
- 引擎内压缩：由 UE5 自动处理
- Normal Map：使用 DirectX 格式（绿色通道向下）
- sRGB：BaseColor 贴图启用 sRGB，Normal/ORM 贴图禁用 sRGB

---

## 6. 颜色参考对照表（Three.js → UE5）

以下表格列出 Three.js OfficeRoom 中使用的所有颜色及其在 UE5 材质系统中的对应关系：

| Three.js 颜色 (Hex) | 用途                | UE5 材质实例          | Roughness | Metallic |
| -------------------- | ------------------- | --------------------- | --------- | -------- |
| #CBB596              | 外层地板            | MI_Floor_Outer        | 0.90      | 0.0      |
| #D8C2A5              | 中层地板            | MI_Floor_Middle       | 0.94      | 0.0      |
| #E4D2BA              | 内层地板            | MI_Floor_Inner        | 0.98      | 0.0      |
| #8C765F              | 地板阴影/木腿       | MI_Floor_Shadow / MI_Wood_Dark | 0.84-0.90 | 0.0 |
| #D8C8B7              | 后墙                | MI_Wall_Back          | 0.98      | 0.0      |
| #D2C2B2              | 侧墙                | MI_Wall_Side          | 0.98      | 0.0      |
| #B39C83              | 后墙踢脚线          | MI_Baseboard_Back     | 1.00      | 0.0      |
| #AE9881              | 侧墙踢脚线          | MI_Baseboard_Side     | 1.00      | 0.0      |
| #C4956A              | 软木板              | MI_Cork               | 0.95      | 0.0      |
| #8B6914              | 相框/边框            | MI_Frame_Brass        | 0.70      | 0.60     |
| #F9F7F2              | 白板面              | MI_Whiteboard         | 0.92      | 0.0      |
| #FFE4B5              | 黄色便签            | MI_StickyNote_Yellow  | 0.90      | 0.0      |
| #E3F2FD              | 蓝色便签            | MI_StickyNote_Blue    | 0.90      | 0.0      |
| #FDE68A              | 金色便签            | MI_StickyNote_Gold    | 0.88      | 0.0      |
| #BFDBFE              | 浅蓝便签            | MI_StickyNote_LightBlue | 0.88   | 0.0      |
| #FBCFE8              | 粉色便签            | MI_StickyNote_Pink    | 0.88      | 0.0      |
| #EDF4FB              | 磨砂玻璃            | MI_Glass_Frosted      | 0.25      | 0.12     |
