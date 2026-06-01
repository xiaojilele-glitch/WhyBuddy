# UE5 资产命名规范与目录组织

## 概述

本文档定义 WhyBuddy UE5 项目中所有资产的命名规范与目录组织规则。所有参与场景搭建的成员必须遵循本规范，以确保多人协作时资产结构清晰、可维护。

---

## 1. 目录结构

项目资产统一存放在 `Content/CubePets/` 下，按功能区域和资产类型分层组织：

```
Content/CubePets/
├── Environment/
│   ├── Office/
│   │   ├── Meshes/          # 静态网格体 (SM_*)
│   │   ├── Materials/        # 材质与材质实例 (MM_* / MI_*)
│   │   ├── Textures/         # 贴图 (T_*_BC / T_*_N / T_*_ORM)
│   │   ├── Blueprints/       # 可交互物体蓝图 (BP_*)
│   │   └── Lighting/         # 灯光预设蓝图 (BP_DayLight 等)
│   └── Props/                # 通用道具（跨区域复用的小物件）
├── Maps/
│   ├── L_Office_Main         # 主关卡
│   ├── L_Office_WorkArea     # 工位区子关卡
│   └── L_Office_MeetingRoom  # 会议室子关卡
```

### 目录组织规则

- **按区域划分**：`Environment/Office/` 存放办公室场景专属资产，`Environment/Props/` 存放可跨区域复用的通用道具。
- **按类型细分**：每个区域下按 `Meshes`、`Materials`、`Textures`、`Blueprints`、`Lighting` 分类存放。
- **禁止根目录堆放**：不允许将资产直接放在 `Content/CubePets/` 根目录下。
- **子关卡独立**：每个功能区域（工位区、会议室等）使用独立子关卡，便于按需加载和团队分工。

---

## 2. 静态网格体（Static Mesh）

### 命名格式

```
SM_<类别>_<名称>_<变体>
```

### 字段说明

| 字段     | 说明                                   | 是否必填 |
| -------- | -------------------------------------- | -------- |
| `SM`     | 固定前缀，表示 Static Mesh             | 是       |
| `类别`   | 物体所属大类，如 Desk、Chair、Shelf 等 | 是       |
| `名称`   | 具体名称或描述                         | 是       |
| `变体`   | 变体编号或描述，如 01、Large、Corner    | 否       |

### 示例

| 资产名称              | 说明               |
| --------------------- | ------------------ |
| `SM_Desk_01`          | 办公桌第 1 号变体  |
| `SM_Desk_02`          | 办公桌第 2 号变体  |
| `SM_Chair_Office_01`  | 办公椅第 1 号变体  |
| `SM_Shelf_01`         | 书架第 1 号变体    |
| `SM_Whiteboard_01`    | 白板               |
| `SM_Sofa_01`          | 沙发               |
| `SM_Table_Meeting_01` | 会议桌             |
| `SM_Table_Coffee_01`  | 茶几               |
| `SM_Monitor_01`       | 显示器             |
| `SM_WaterDispenser_01`| 饮水机             |

---

## 3. 材质（Material）

### 主材质（Master Material）

```
MM_<名称>
```

主材质是参数化的基础材质模板，支持通过材质实例调整外观。

### 材质实例（Material Instance）

```
MI_<名称>
```

材质实例继承自主材质，通过调整参数（颜色、粗糙度、金属度等）生成具体外观。

### 示例

| 资产名称              | 说明                         |
| --------------------- | ---------------------------- |
| `MM_Office_Master`    | 办公室通用主材质             |
| `MI_Wood_Light`       | 浅色木材材质实例             |
| `MI_Wood_Dark`        | 深色木材材质实例             |
| `MI_Fabric_Blue`      | 蓝色织物材质实例             |
| `MI_Fabric_Gray`      | 灰色织物材质实例             |
| `MI_Metal_Chrome`     | 铬金属材质实例               |
| `MI_Metal_Brushed`    | 拉丝金属材质实例             |
| `MI_Plastic_White`    | 白色塑料材质实例             |
| `MI_Plastic_Black`    | 黑色塑料材质实例             |

---

## 4. 贴图（Texture）

### 命名格式

```
T_<名称>_<类型>
```

### 贴图类型后缀

| 后缀   | 含义                                          |
| ------ | --------------------------------------------- |
| `BC`   | Base Color — 基础颜色贴图                     |
| `N`    | Normal — 法线贴图                             |
| `ORM`  | Occlusion / Roughness / Metallic — 合并贴图   |
| `E`    | Emissive — 自发光贴图（可选）                 |
| `M`    | Mask — 遮罩贴图（可选）                       |

### 示例

| 资产名称          | 说明                     |
| ----------------- | ------------------------ |
| `T_Wood_BC`       | 木材基础颜色贴图         |
| `T_Wood_N`        | 木材法线贴图             |
| `T_Wood_ORM`      | 木材 ORM 合并贴图        |
| `T_Fabric_BC`     | 织物基础颜色贴图         |
| `T_Fabric_N`      | 织物法线贴图             |
| `T_Fabric_ORM`    | 织物 ORM 合并贴图        |
| `T_Metal_BC`      | 金属基础颜色贴图         |
| `T_Metal_N`       | 金属法线贴图             |
| `T_Metal_ORM`     | 金属 ORM 合并贴图        |
| `T_Concrete_BC`   | 混凝土基础颜色贴图       |
| `T_Concrete_N`    | 混凝土法线贴图           |
| `T_Concrete_ORM`  | 混凝土 ORM 合并贴图      |

### 贴图规范

- PBR 工作流：每种材质至少提供 `BC`（BaseColor）、`N`（Normal）、`ORM`（Occlusion/Roughness/Metallic）三张贴图。
- ORM 通道分配：R = Ambient Occlusion，G = Roughness，B = Metallic。
- 分辨率建议：主要家具 2048×2048，小道具 1024×1024，远景物体 512×512。
- 格式：使用无损压缩格式导入（PNG / TGA），引擎内由 UE5 自动压缩。

---

## 5. 蓝图（Blueprint）

### 命名格式

```
BP_<名称>
```

蓝图用于封装可交互物体或灯光预设，每个可交互物体应有独立的 Actor 蓝图。

### 示例

| 资产名称              | 说明                     |
| --------------------- | ------------------------ |
| `BP_Desk`             | 办公桌蓝图（可交互）     |
| `BP_Chair`            | 椅子蓝图（可交互）       |
| `BP_Whiteboard`       | 白板蓝图（可交互）       |
| `BP_Monitor`          | 显示器蓝图（可交互）     |
| `BP_WaterDispenser`   | 饮水机蓝图（可交互）     |
| `BP_DayLight`         | 日间灯光预设蓝图         |
| `BP_NightLight`       | 夜间灯光预设蓝图         |
| `BP_MeetingLight`     | 会议灯光预设蓝图         |
| `BP_PresentationLight`| 演示灯光预设蓝图         |

---

## 6. 关卡（Map / Level）

### 命名格式

```
L_<区域>_<子区域>
```

### 示例

| 资产名称              | 说明               |
| --------------------- | ------------------ |
| `L_Office_Main`       | 办公室主关卡       |
| `L_Office_WorkArea`   | 工位区子关卡       |
| `L_Office_MeetingRoom`| 会议室子关卡       |
| `L_Office_Lounge`     | 休息区子关卡       |
| `L_Office_Corridor`   | 走廊子关卡         |

### 关卡组织规则

- 主关卡 `L_Office_Main` 作为持久关卡（Persistent Level），负责加载各子关卡。
- 每个功能区域使用独立子关卡，支持 World Partition 或 Level Streaming 按需加载。
- 子关卡命名必须以 `L_Office_` 为前缀，保持一致性。

---

## 7. 其他资产类型（扩展）

| 前缀   | 资产类型                | 示例                     |
| ------ | ----------------------- | ------------------------ |
| `SK_`  | 骨骼网格体              | `SK_Pet_Cat_01`          |
| `ANIM_`| 动画序列                | `ANIM_Pet_Idle`          |
| `ABP_` | 动画蓝图                | `ABP_Pet_Cat`            |
| `WBP_` | Widget Blueprint        | `WBP_HUD_Main`           |
| `PC_`  | 粒子 / Niagara 系统     | `PC_Dust_01`             |
| `SND_` | 音效                    | `SND_Keyboard_Type`      |
| `DT_`  | Data Table              | `DT_FurnitureConfig`     |
| `E_`   | 枚举                    | `E_LightingPreset`       |
| `S_`   | 结构体                  | `S_FurnitureData`        |

---

## 8. 通用命名规则

1. **使用英文命名**：所有资产名称使用英文，不使用中文或拼音。
2. **PascalCase 风格**：每个单词首字母大写，不使用空格或连字符。例如 `SM_WaterDispenser_01` 而非 `SM_water-dispenser-01`。
3. **前缀必填**：所有资产必须带有类型前缀（`SM_`、`MI_`、`T_`、`BP_`、`L_` 等）。
4. **编号从 01 开始**：变体编号使用两位数字，从 `01` 开始递增。
5. **禁止特殊字符**：文件名中不使用空格、中文、特殊符号（`@#$%` 等）。
6. **语义清晰**：名称应能直接反映资产用途，避免使用 `test`、`temp`、`new` 等临时命名。
7. **一致性优先**：同类资产的命名模式必须保持一致，新增资产前先查阅已有命名。

---

## 9. 版本控制注意事项

- `.uasset` 和 `.umap` 文件为二进制格式，应使用 Git LFS 管理。
- 贴图源文件（PSD / Substance 等）存放在项目外部或 `RawAssets/` 目录，不提交到主仓库。
- 每次提交前确认资产命名符合本规范，避免后续批量重命名。

---

## 10. 场景区域与资产对照表

| 区域     | 包含物体                           | 对应 Three.js 组件          |
| -------- | ---------------------------------- | --------------------------- |
| 工位区   | 4 张办公桌、4 把椅子、显示器、键盘 | `OfficeRoom.desks`          |
| 会议区   | 会议桌、6 把椅子、白板、投影幕     | `OfficeRoom.meetingArea`    |
| 休息区   | 沙发、茶几、饮水机                 | `OfficeRoom.lounge`         |
| 走廊     | 书架、绿植、装饰画                 | `OfficeRoom.corridor`       |
