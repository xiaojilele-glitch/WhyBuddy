# UE5 家具模型导入指南

## 概述

本文档指导如何将 Kenney Furniture Kit 的 GLTF/GLB 模型转换并导入 UE5 项目，用于重建 WhyBuddy 办公室场景。Three.js 版本使用 GLB 格式直接加载模型，而 UE5 推荐使用 FBX 格式导入静态网格体。

---

## 1. 格式转换：GLTF/GLB → FBX

### 为什么需要转换

UE5 原生支持 FBX 导入，对 GLTF 的支持虽然在改善但仍不够稳定（尤其在材质和缩放方面）。建议统一使用 FBX 作为中间格式。

### 转换工具推荐

| 工具 | 说明 | 推荐场景 |
| ---- | ---- | -------- |
| **Blender 4.x** | 免费开源，支持 GLTF 导入和 FBX 导出，可通过 Python 脚本批量处理 | 首选，适合批量转换 |
| **Kenney FBX 原始文件** | Kenney Furniture Kit 自带 FBX 格式目录 | 如果 FBX 文件可用，可直接使用 |
| **Assimp** | 命令行转换工具 | 备选方案 |

> **注意**：Kenney Furniture Kit 已自带 `Models/FBX format/` 目录。如果该目录中的 FBX 文件完整，可以直接使用，无需从 GLTF 转换。但仍需调整缩放比例。

### Blender 手动转换步骤

1. 打开 Blender，`File → Import → glTF 2.0 (.glb/.gltf)`
2. 选择目标 GLB 文件
3. 在场景中选中导入的模型
4. 应用缩放：`S` → 输入 `100` → `Enter`（Three.js 使用米，UE5 使用厘米）
5. 应用变换：`Ctrl+A` → `All Transforms`
6. 导出：`File → Export → FBX (.fbx)`
7. 导出设置：
   - **Scale**: `1.0`（缩放已在步骤 4 中应用）
   - **Apply Scalings**: `FBX All`
   - **Forward**: `-Y Forward`
   - **Up**: `Z Up`
   - **Mesh → Smoothing**: `Face`

---

## 2. 缩放比例说明

### 单位系统差异

| 引擎 | 单位 | 1 个单位 = |
| ---- | ---- | ---------- |
| Three.js | 米 (m) | 1 米 |
| UE5 | 厘米 (cm) | 1 厘米 |

### 缩放因子

**统一缩放因子 = 100**

即 Three.js 中 1.0 单位的物体，在 UE5 中应为 100.0 单位。

### 在不同阶段应用缩放

| 阶段 | 方法 | 说明 |
| ---- | ---- | ---- |
| Blender 转换时 | 在 Blender 中缩放 100 倍后导出 | **推荐**，一次性解决 |
| UE5 导入时 | FBX Import Options → Transform → Import Uniform Scale = 100 | 备选方案 |
| UE5 场景中 | 手动调整 Actor Scale | 不推荐，容易遗漏 |

---

## 3. UE5 FBX 导入设置

### 推荐导入参数

在 UE5 Content Browser 中拖入 FBX 文件或使用 `Import` 按钮时，使用以下设置：

| 分类 | 参数 | 推荐值 | 说明 |
| ---- | ---- | ------ | ---- |
| **Mesh** | Skeletal Mesh | `false` | Kenney 模型为静态网格体 |
| **Mesh** | Import Mesh | `true` | |
| **Mesh** | Auto Generate Collision | `true` | 自动生成碰撞体 |
| **Mesh** | Combine Meshes | `true` | 将同一文件中的多个网格合并 |
| **Transform** | Import Uniform Scale | `1.0`（如已在 Blender 中缩放）或 `100.0`（如未缩放） | |
| **Transform** | Import Rotation | `[0, 0, 0]` | |
| **Material** | Import Materials | `true` | 导入材质定义 |
| **Material** | Import Textures | `true` | 导入关联贴图 |
| **Normals** | Normal Import Method | `Import Normals` | 保留原始法线 |
| **Normals** | Normal Generation Method | `MikkTSpace` | 与 Blender 一致 |
| **Miscellaneous** | Convert Scene | `true` | 自动转换坐标系 |
| **Miscellaneous** | Convert Scene Unit | `true` | 自动转换单位 |

### 导入后检查清单

- [ ] 模型尺寸是否正确（办公桌约 120-150cm 长）
- [ ] 法线方向是否正确（无黑面）
- [ ] 材质是否正确分配
- [ ] 碰撞体是否合理
- [ ] 枢轴点（Pivot）是否在模型底部中心

---

## 4. 完整资产映射表

以下表格列出 Three.js `FURNITURE_MODELS` 中所有模型与 UE5 资产的对应关系。

### 4.1 办公家具

| Three.js 模型名 | 源文件 | UE5 资产名 | 存放路径 | 说明 |
| --------------- | ------ | ---------- | -------- | ---- |
| `desk` | desk.glb | `SM_Desk_01` | `Content/CubePets/Environment/Office/Meshes/` | 办公桌 |
| `chairDesk` | chairDesk.glb | `SM_Chair_Desk_01` | 同上 | 办公椅（带轮） |
| `chairRounded` | chairRounded.glb | `SM_Chair_Rounded_01` | 同上 | 圆背椅 |
| `chairModernCushion` | chairModernCushion.glb | `SM_Chair_ModernCushion_01` | 同上 | 现代软垫椅 |

### 4.2 电脑设备

| Three.js 模型名 | 源文件 | UE5 资产名 | 存放路径 | 说明 |
| --------------- | ------ | ---------- | -------- | ---- |
| `computerScreen` | computerScreen.glb | `SM_Monitor_01` | `Content/CubePets/Environment/Office/Meshes/` | 显示器 |
| `computerKeyboard` | computerKeyboard.glb | `SM_Keyboard_01` | 同上 | 键盘 |
| `computerMouse` | computerMouse.glb | `SM_Mouse_01` | 同上 | 鼠标 |
| `laptop` | laptop.glb | `SM_Laptop_01` | 同上 | 笔记本电脑 |

### 4.3 桌类

| Three.js 模型名 | 源文件 | UE5 资产名 | 存放路径 | 说明 |
| --------------- | ------ | ---------- | -------- | ---- |
| `tableRound` | tableRound.glb | `SM_Table_Round_01` | `Content/CubePets/Environment/Office/Meshes/` | 圆桌 |
| `tableCoffeeSquare` | tableCoffeeSquare.glb | `SM_Table_CoffeeSquare_01` | 同上 | 方形茶几 |
| `tableCoffee` | tableCoffee.glb | `SM_Table_Coffee_01` | 同上 | 茶几 |
| `sideTable` | sideTable.glb | `SM_SideTable_01` | 同上 | 边桌 |

### 4.4 休息区家具

| Three.js 模型名 | 源文件 | UE5 资产名 | 存放路径 | 说明 |
| --------------- | ------ | ---------- | -------- | ---- |
| `loungeSofaLong` | loungeSofaLong.glb | `SM_Sofa_Long_01` | `Content/CubePets/Environment/Office/Meshes/` | 长沙发 |
| `loungeSofa` | loungeSofa.glb | `SM_Sofa_01` | 同上 | 沙发 |
| `loungeChair` | loungeChair.glb | `SM_Lounge_Chair_01` | 同上 | 休闲椅 |

### 4.5 收纳与书架

| Three.js 模型名 | 源文件 | UE5 资产名 | 存放路径 | 说明 |
| --------------- | ------ | ---------- | -------- | ---- |
| `bookcaseOpen` | bookcaseOpen.glb | `SM_Bookcase_Open_01` | `Content/CubePets/Environment/Office/Meshes/` | 开放式书架 |
| `bookcaseOpenLow` | bookcaseOpenLow.glb | `SM_Bookcase_OpenLow_01` | 同上 | 矮书架 |
| `books` | books.glb | `SM_Books_01` | 同上 | 书籍装饰 |
| `coatRackStanding` | coatRackStanding.glb | `SM_CoatRack_Standing_01` | 同上 | 立式衣帽架 |

### 4.6 地毯

| Three.js 模型名 | 源文件 | UE5 资产名 | 存放路径 | 说明 |
| --------------- | ------ | ---------- | -------- | ---- |
| `rugRounded` | rugRounded.glb | `SM_Rug_Rounded_01` | `Content/CubePets/Environment/Office/Meshes/` | 圆角地毯 |
| `rugRectangle` | rugRectangle.glb | `SM_Rug_Rectangle_01` | 同上 | 矩形地毯 |

### 4.7 植物

| Three.js 模型名 | 源文件 | UE5 资产名 | 存放路径 | 说明 |
| --------------- | ------ | ---------- | -------- | ---- |
| `pottedPlant` | pottedPlant.glb | `SM_Plant_Potted_01` | `Content/CubePets/Environment/Office/Meshes/` | 盆栽（大） |
| `plantSmall1` | plantSmall1.glb | `SM_Plant_Small_01` | 同上 | 小植物 1 |
| `plantSmall2` | plantSmall2.glb | `SM_Plant_Small_02` | 同上 | 小植物 2 |
| `plantSmall3` | plantSmall3.glb | `SM_Plant_Small_03` | 同上 | 小植物 3 |

### 4.8 灯具

| Three.js 模型名 | 源文件 | UE5 资产名 | 存放路径 | 说明 |
| --------------- | ------ | ---------- | -------- | ---- |
| `lampRoundFloor` | lampRoundFloor.glb | `SM_Lamp_Floor_01` | `Content/CubePets/Environment/Office/Meshes/` | 落地灯 |
| `lampRoundTable` | lampRoundTable.glb | `SM_Lamp_Table_01` | 同上 | 台灯 |
| `lampWall` | lampWall.glb | `SM_Lamp_Wall_01` | 同上 | 壁灯 |

### 4.9 建筑元素（墙体）

| Three.js 模型名 | 源文件 | UE5 资产名 | 存放路径 | 说明 |
| --------------- | ------ | ---------- | -------- | ---- |
| `wall` | wall.glb | `SM_Wall_01` | `Content/CubePets/Environment/Office/Meshes/` | 标准墙段 |
| `wallCorner` | wallCorner.glb | `SM_Wall_Corner_01` | 同上 | 墙角（直角） |
| `wallCornerRond` | wallCornerRond.glb | `SM_Wall_CornerRound_01` | 同上 | 墙角（圆角） |
| `wallDoorway` | wallDoorway.glb | `SM_Wall_Doorway_01` | 同上 | 门洞墙段 |
| `wallDoorwayWide` | wallDoorwayWide.glb | `SM_Wall_DoorwayWide_01` | 同上 | 宽门洞墙段 |
| `wallHalf` | wallHalf.glb | `SM_Wall_Half_01` | 同上 | 半高墙段 |
| `wallWindow` | wallWindow.glb | `SM_Wall_Window_01` | 同上 | 窗户墙段 |
| `wallWindowSlide` | wallWindowSlide.glb | `SM_Wall_WindowSlide_01` | 同上 | 推拉窗墙段 |

### 4.10 地板

| Three.js 模型名 | 源文件 | UE5 资产名 | 存放路径 | 说明 |
| --------------- | ------ | ---------- | -------- | ---- |
| `floorFull` | floorFull.glb | `SM_Floor_Full_01` | `Content/CubePets/Environment/Office/Meshes/` | 完整地板块 |
| `floorHalf` | floorHalf.glb | `SM_Floor_Half_01` | 同上 | 半块地板 |
| `floorCornerRound` | floorCornerRound.glb | `SM_Floor_CornerRound_01` | 同上 | 圆角地板 |

### 4.11 其他

| Three.js 模型名 | 源文件 | UE5 资产名 | 存放路径 | 说明 |
| --------------- | ------ | ---------- | -------- | ---- |
| `paneling` | paneling.glb | `SM_Paneling_01` | `Content/CubePets/Environment/Office/Meshes/` | 墙面护板 |

---

## 5. 按类别导入检查清单

### 5.1 办公家具（桌、椅）

- [ ] 导入 `desk.glb` → `SM_Desk_01`
- [ ] 导入 `chairDesk.glb` → `SM_Chair_Desk_01`
- [ ] 导入 `chairRounded.glb` → `SM_Chair_Rounded_01`
- [ ] 导入 `chairModernCushion.glb` → `SM_Chair_ModernCushion_01`
- [ ] 验证桌面高度约 75cm（UE5 单位）
- [ ] 验证椅子高度约 45cm（座面）
- [ ] 为桌椅生成简单碰撞体

### 5.2 电脑设备

- [ ] 导入 `computerScreen.glb` → `SM_Monitor_01`
- [ ] 导入 `computerKeyboard.glb` → `SM_Keyboard_01`
- [ ] 导入 `computerMouse.glb` → `SM_Mouse_01`
- [ ] 导入 `laptop.glb` → `SM_Laptop_01`
- [ ] 验证显示器屏幕面朝向正确
- [ ] 键盘和鼠标放置在桌面上时高度匹配

### 5.3 桌类与茶几

- [ ] 导入 `tableRound.glb` → `SM_Table_Round_01`
- [ ] 导入 `tableCoffeeSquare.glb` → `SM_Table_CoffeeSquare_01`
- [ ] 导入 `tableCoffee.glb` → `SM_Table_Coffee_01`
- [ ] 导入 `sideTable.glb` → `SM_SideTable_01`
- [ ] 验证茶几高度约 40-50cm

### 5.4 休息区家具

- [ ] 导入 `loungeSofaLong.glb` → `SM_Sofa_Long_01`
- [ ] 导入 `loungeSofa.glb` → `SM_Sofa_01`
- [ ] 导入 `loungeChair.glb` → `SM_Lounge_Chair_01`
- [ ] 验证沙发座面高度约 40cm

### 5.5 收纳与装饰

- [ ] 导入 `bookcaseOpen.glb` → `SM_Bookcase_Open_01`
- [ ] 导入 `bookcaseOpenLow.glb` → `SM_Bookcase_OpenLow_01`
- [ ] 导入 `books.glb` → `SM_Books_01`
- [ ] 导入 `coatRackStanding.glb` → `SM_CoatRack_Standing_01`

### 5.6 地毯与地板

- [ ] 导入 `rugRounded.glb` → `SM_Rug_Rounded_01`
- [ ] 导入 `rugRectangle.glb` → `SM_Rug_Rectangle_01`
- [ ] 导入 `floorFull.glb` → `SM_Floor_Full_01`
- [ ] 导入 `floorHalf.glb` → `SM_Floor_Half_01`
- [ ] 导入 `floorCornerRound.glb` → `SM_Floor_CornerRound_01`
- [ ] 验证地毯厚度极薄，不会穿透地板

### 5.7 植物

- [ ] 导入 `pottedPlant.glb` → `SM_Plant_Potted_01`
- [ ] 导入 `plantSmall1.glb` → `SM_Plant_Small_01`
- [ ] 导入 `plantSmall2.glb` → `SM_Plant_Small_02`
- [ ] 导入 `plantSmall3.glb` → `SM_Plant_Small_03`

### 5.8 灯具

- [ ] 导入 `lampRoundFloor.glb` → `SM_Lamp_Floor_01`
- [ ] 导入 `lampRoundTable.glb` → `SM_Lamp_Table_01`
- [ ] 导入 `lampWall.glb` → `SM_Lamp_Wall_01`
- [ ] 为灯具模型预留发光材质插槽

### 5.9 建筑元素

- [ ] 导入所有 `wall*.glb` 墙段模型
- [ ] 导入 `paneling.glb` → `SM_Paneling_01`
- [ ] 验证墙段之间可以无缝拼接
- [ ] 验证门洞尺寸与标准门框匹配

---

## 6. 批量导入技巧

### 6.1 使用 Blender Python 脚本批量转换

项目提供了 `ue5/Scripts/batch_import.py` 脚本，可在 Blender 中批量将 GLTF 转换为 FBX。

使用方法：

```bash
# 命令行调用 Blender 执行批量转换
blender --background --python ue5/Scripts/batch_import.py -- \
  --input "client/public/kenney_furniture-kit/Models/GLTF format" \
  --output "ue5/Import/FBX" \
  --scale 100
```

### 6.2 UE5 批量导入

1. 将所有转换好的 FBX 文件放入 `ue5/Import/FBX/` 目录
2. 在 UE5 Content Browser 中导航到 `Content/CubePets/Environment/Office/Meshes/`
3. 将所有 FBX 文件拖入 Content Browser
4. 在弹出的导入对话框中：
   - 取消勾选 `Import as Skeletal`
   - 勾选 `Auto Generate Collision`
   - 勾选 `Combine Meshes`
   - 如果已在 Blender 中缩放，`Import Uniform Scale` 设为 `1.0`
5. 点击 `Import All`

### 6.3 导入后批量重命名

使用 UE5 的 `Bulk Rename` 功能（右键 → Bulk Operations → Rename）按照命名规范统一重命名。

或者使用 UE5 Python 脚本：

```python
import unreal

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
editor_util = unreal.EditorAssetLibrary

# 重命名映射表
rename_map = {
    '/Game/CubePets/Environment/Office/Meshes/desk': 'SM_Desk_01',
    '/Game/CubePets/Environment/Office/Meshes/chairDesk': 'SM_Chair_Desk_01',
    # ... 按映射表补充
}

for old_path, new_name in rename_map.items():
    if editor_util.does_asset_exist(old_path):
        dir_path = old_path.rsplit('/', 1)[0]
        editor_util.rename_asset(old_path, f'{dir_path}/{new_name}')
```

---

## 7. 常见问题

### Q: 模型导入后太小或太大？

检查缩放因子。如果在 Blender 中未缩放 100 倍，需要在 UE5 导入时设置 `Import Uniform Scale = 100`。

### Q: 模型有黑面？

法线方向反转。在 Blender 中选中模型，进入编辑模式，`Mesh → Normals → Recalculate Outside`，然后重新导出。

### Q: Kenney 模型没有贴图？

Kenney Furniture Kit 是低多边形风格，模型使用顶点色（Vertex Color）而非贴图。导入 UE5 后需要创建使用顶点色的材质，或者按照设计文档中的材质系统为模型分配新的 PBR 材质实例。

### Q: 可以直接使用 Kenney 自带的 FBX 文件吗？

可以。Kenney Furniture Kit 的 `Models/FBX format/` 目录中已有 FBX 文件。但仍需注意：
1. 缩放比例可能需要调整（检查导入后的实际尺寸）
2. 坐标轴方向可能需要在导入设置中调整

---

## 8. 参考资源

- [Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit) — 模型资产来源
- [UE5 FBX Import Documentation](https://docs.unrealengine.com/5.0/en-US/fbx-import-options-reference-in-unreal-engine/) — 官方 FBX 导入文档
- [Blender FBX Export Guide](https://docs.blender.org/manual/en/latest/addons/import_export/scene_fbx.html) — Blender FBX 导出指南
- `ue5/docs/naming-conventions.md` — 项目资产命名规范
- `ue5/Scripts/batch_import.py` — 批量转换脚本
