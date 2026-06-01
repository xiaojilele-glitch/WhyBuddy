# 场景搭建指南与协作规范

## 概述

本文档是 WhyBuddy UE5 场景搭建的完整操作指南，涵盖环境准备、搭建步骤、团队协作规范与质量检查清单。适用于所有参与场景搭建的团队成员。

---

## 1. 前置条件

### 1.1 软件要求

| 软件 | 版本要求 | 说明 |
|------|----------|------|
| Unreal Engine | 5.4+ | 需要 Lumen GI 和 Virtual Shadow Maps 支持 |
| Blender | 4.x | 用于模型预处理和格式转换（可选） |
| Git | 2.40+ | 版本控制 |
| Git LFS | 3.0+ | 管理 `.uasset` / `.umap` 二进制文件 |
| Visual Studio | 2022 | C++ 编译（如需自定义插件） |

### 1.2 资产要求

| 资产 | 来源 | 说明 |
|------|------|------|
| Kenney Furniture Kit | [kenney.nl](https://kenney.nl/assets/furniture-kit) | 低多边形家具模型（CC0 许可） |
| Three.js OfficeRoom 源码 | 本项目 `client/src/components/office/` | 布局参考蓝本 |

### 1.3 硬件建议

| 配置 | 最低要求 | 推荐配置 |
|------|----------|----------|
| GPU | GTX 1060 6GB | RTX 3060 12GB |
| CPU | i5-8400 / Ryzen 5 2600 | i7-12700 / Ryzen 7 5800X |
| RAM | 16 GB | 32 GB |
| 存储 | SSD 50GB 可用空间 | NVMe SSD 100GB+ |

---

## 2. 搭建步骤（按顺序执行）

### 步骤 1：项目创建与初始配置

1. 使用 UE5 创建空白项目（Blank Template）
2. 启用以下插件：
   - Pixel Streaming（用于远程渲染）
   - Modeling Tools Editor Mode（用于基础几何体创建）
   - glTF Importer（用于导入 Kenney `.glb` 模型）
3. 配置项目设置：
   - `Rendering > Global Illumination Method`: Lumen
   - `Rendering > Reflection Method`: Lumen
   - `Rendering > Shadow Map Method`: Virtual Shadow Maps
   - `Rendering > Generate Mesh Distance Fields`: true
4. 创建目录结构（参考 `ue5/docs/naming-conventions.md`）

### 步骤 2：导入 Kenney 家具模型

1. 将 Kenney Furniture Kit 的 `.glb` 文件放入临时导入目录
2. 使用 glTF Importer 批量导入到 `Content/CubePets/Environment/Office/Meshes/`
3. 导入设置：
   - Import Vertex Colors: ✅
   - Import Materials: ❌（使用自定义 Master Material）
   - Import Textures: ❌
   - Auto Generate Collision: ✅
4. 按命名规范重命名所有导入的 Static Mesh
5. 批量分配 `MI_Kenney_Default` 材质（参考 `ue5/docs/material-system.md` 中的脚本）

### 步骤 3：搭建房间外壳

参考 Three.js OfficeRoom 尺寸：
- 地板：18m × 14m（UE5: 1800cm × 1400cm）
- 墙高：3.0m（UE5: 300cm）
- 坐标转换：UE5_X = ThreeJS_X × 100, UE5_Y = ThreeJS_Z × -100, UE5_Z = ThreeJS_Y × 100

搭建顺序：
1. 创建地板平面（三层：外层、中层、内层）
2. 创建后墙和两侧墙
3. 创建天花板
4. 添加踢脚线
5. 添加门框和玻璃隔板
6. 分配建筑材质（参考 `ue5/docs/material-system.md` 第 3.5 节）

### 步骤 4：布置工位区

每组工位包含：
- 1 × SM_Desk_01（办公桌）
- 1 × SM_Chair_Office_01（办公椅）
- 1 × SM_Monitor_01（显示器）
- 1 × SM_Keyboard_01（键盘）
- 1 × SM_Mouse_01（鼠标）
- 1 × SM_Lamp_Table_01（台灯，可选）

共 4 组工位，参考 Three.js `OfficeRoom.desks` 的位置数据布置。

### 步骤 5：布置会议区

会议区包含：
- 1 × SM_Table_Meeting_01（会议桌）
- 6 × SM_Chair_Rounded_01（会议椅）
- 1 × SM_Whiteboard_01（白板）
- 1 × SM_Projector_Screen_01（投影幕布，可选）

参考 Three.js `OfficeRoom.meetingArea` 的位置数据布置。

### 步骤 6：布置休息区

休息区包含：
- 1 × SM_Sofa_01（沙发）
- 1–2 × SM_Chair_Lounge_01（休闲椅）
- 1 × SM_Table_Coffee_01（茶几）
- 1 × SM_WaterDispenser_01（饮水机）
- 1 × SM_Lamp_Floor_01（落地灯）

参考 Three.js `OfficeRoom.lounge` 的位置数据布置。

### 步骤 7：配置灯光系统

按 `ue5/docs/lighting-system.md` 配置：
1. 放置 Directional Light（主光源）
2. 放置 6 盏 Rect Light（天花板顶灯）
3. 放置 Point Light（落地灯、壁灯、台灯）
4. 放置 Sky Light
5. 放置 Post Process Volume（Unbound）
6. 配置 Lumen GI 参数
7. 创建灯光预设蓝图（日间/夜间/会议/演示）

### 步骤 8：配置材质系统

按 `ue5/docs/material-system.md` 配置：
1. 创建 MM_Office_Master 主材质
2. 创建所有材质实例（38 个）
3. 为 Kenney 模型分配 MI_Kenney_Default
4. 为建筑结构分配对应材质
5. 为特殊表面分配专用材质

### 步骤 9：生成 LOD

按 `ue5/docs/lod-performance-guide.md` 配置：
1. 为所有主要家具模型生成 2 级 LOD
2. 配置 Screen Size 切换阈值
3. 使用 LOD Coloring 可视化验证

### 步骤 10：性能测试与优化

1. 运行 `stat unit` 检查帧率
2. 运行 `stat scenerendering` 检查 Draw Calls
3. 运行 `stat streaming` 检查纹理流送
4. 按画质档位逐一验证性能
5. 完成性能分析检查清单（参考 `ue5/docs/lod-performance-guide.md` 第 6.4 节）

---

## 3. 团队协作规范

### 3.1 文件所有权

| 区域 | 负责人 | 可编辑文件 |
|------|--------|-----------|
| 工位区 | 成员 A | `L_Office_WorkArea` 及其中的所有 Actor |
| 会议区 | 成员 B | `L_Office_MeetingRoom` 及其中的所有 Actor |
| 休息区 | 成员 C | `L_Office_Lounge` 及其中的所有 Actor |
| 走廊 | 成员 D | `L_Office_Corridor` 及其中的所有 Actor |
| 主关卡 | 主管 | `L_Office_Main`（建筑结构、灯光、Post Process） |
| 材质 | 美术主管 | `Materials/` 目录下所有文件 |
| 蓝图 | 技术美术 | `Blueprints/` 目录下所有文件 |

### 3.2 命名执行规则

- **提交前检查**：所有资产必须符合 `ue5/docs/naming-conventions.md` 中的命名规范
- **禁止临时命名**：不允许使用 `test_`、`temp_`、`new_`、`copy_` 等前缀
- **编号从 01 开始**：变体编号使用两位数字
- **英文命名**：所有资产名称使用英文 PascalCase

### 3.3 版本控制规范

#### Git LFS 配置

```gitattributes
# UE5 二进制资产
*.uasset filter=lfs diff=lfs merge=lfs -text
*.umap filter=lfs diff=lfs merge=lfs -text

# 贴图源文件
*.psd filter=lfs diff=lfs merge=lfs -text
*.tga filter=lfs diff=lfs merge=lfs -text
*.png filter=lfs diff=lfs merge=lfs -text

# 模型源文件
*.fbx filter=lfs diff=lfs merge=lfs -text
*.glb filter=lfs diff=lfs merge=lfs -text
*.gltf filter=lfs diff=lfs merge=lfs -text
```

#### 分支策略

| 分支 | 用途 | 合并规则 |
|------|------|----------|
| `main` | 稳定版本 | 仅通过 PR 合并 |
| `develop` | 开发集成 | 每日合并各功能分支 |
| `feature/work-area` | 工位区开发 | 完成后合并到 develop |
| `feature/meeting-room` | 会议区开发 | 完成后合并到 develop |
| `feature/lounge` | 休息区开发 | 完成后合并到 develop |
| `feature/lighting` | 灯光系统 | 完成后合并到 develop |
| `feature/materials` | 材质系统 | 完成后合并到 develop |

#### 提交规范

```
# 提交消息格式
<类型>(<范围>): <描述>

# 类型
feat:     新增资产或功能
fix:      修复问题
refactor: 重构（不改变功能）
docs:     文档更新
style:    格式调整（不影响功能）

# 示例
feat(work-area): 添加 4 组办公桌椅布局
fix(lighting): 修正会议区 Rect Light 衰减半径
refactor(materials): 统一木材材质实例参数
docs(guide): 更新场景搭建步骤说明
```

### 3.4 合并策略

1. **子关卡独立开发**：每个功能区域在独立子关卡中开发，避免主关卡冲突
2. **材质统一管理**：材质修改由美术主管统一处理，其他成员不直接修改 `Materials/` 目录
3. **每日集成**：每天结束前将完成的工作合并到 `develop` 分支
4. **冲突解决**：`.uasset` 二进制文件冲突时，以最新提交为准，手动合并变更
5. **锁定机制**：使用 Git LFS 文件锁定（`git lfs lock`）防止并行编辑同一文件

### 3.5 沟通规范

- 修改共享资产（主材质、灯光预设、建筑结构）前，在群组中通知
- 新增资产前，先确认命名不与已有资产冲突
- 发现命名不规范的资产，立即提出并修正
- 每周进行一次资产审计，清理未使用的资产

---

## 4. 质量检查清单

### 4.1 资产质量

- [ ] 所有 Static Mesh 已按命名规范命名（`SM_` 前缀）
- [ ] 所有材质实例已按命名规范命名（`MI_` 前缀）
- [ ] 所有贴图已按命名规范命名（`T_` 前缀 + 类型后缀）
- [ ] 所有蓝图已按命名规范命名（`BP_` 前缀）
- [ ] 所有关卡已按命名规范命名（`L_` 前缀）
- [ ] 无临时命名或未分类的资产
- [ ] 无未使用的资产残留

### 4.2 布局质量

- [ ] 工位区 4 组桌椅布局完整
- [ ] 会议区桌椅 + 白板布局完整
- [ ] 休息区沙发 + 茶几 + 饮水机布局完整
- [ ] 走廊书架 + 绿植 + 装饰布局完整
- [ ] 所有家具位置与 Three.js 版本偏差 ≤ 5%
- [ ] 无穿模或悬浮物体
- [ ] 所有物体有合理的碰撞体

### 4.3 灯光质量

- [ ] 主光源（Directional Light）配置正确
- [ ] 6 盏天花板 Rect Light 位置和参数正确
- [ ] 落地灯、壁灯、台灯 Point Light 配置正确
- [ ] 4 个灯光预设（日间/夜间/会议/演示）可正常切换
- [ ] Lumen GI 效果正常，无明显漏光
- [ ] Post Process Volume 参数合理

### 4.4 材质质量

- [ ] Master Material 三种模式（纯色/贴图/顶点色）均正常工作
- [ ] 所有 Kenney 模型使用 MI_Kenney_Default，顶点色显示正确
- [ ] 建筑结构材质颜色与 Three.js 版本一致
- [ ] 特殊材质（白板、软木板、玻璃）效果正确
- [ ] 无缺失材质（粉红色警告）

### 4.5 性能质量

- [ ] 场景总三角面 ≤ 200 万
- [ ] GTX 1060 @ 1080p Medium ≥ 30fps
- [ ] 所有主要家具已生成 LOD
- [ ] 纹理流送池未溢出
- [ ] 总显存占用 ≤ 4GB
- [ ] 无明显卡顿或帧率波动

### 4.6 提交前检查

- [ ] 所有修改已保存
- [ ] 资产命名符合规范
- [ ] 提交消息格式正确
- [ ] 无未解决的冲突
- [ ] 本地构建/打包测试通过

---

## 5. 参考文档索引

| 文档 | 路径 | 说明 |
|------|------|------|
| 命名规范 | `ue5/docs/naming-conventions.md` | 资产命名与目录组织 |
| 材质系统 | `ue5/docs/material-system.md` | Master Material 与材质实例 |
| 灯光系统 | `ue5/docs/lighting-system.md` | 灯光配置与预设 |
| LOD 与性能 | `ue5/docs/lod-performance-guide.md` | LOD 策略与性能优化 |
| 资产清单 | `ue5/docs/asset-inventory.md` | 完整资产列表 |
| 截图对比 | `ue5/docs/threejs-ue5-comparison-guide.md` | UE5 与 Three.js 对比方法 |
| 设计文档 | `.kiro/specs/ue-office-scene-build/design.md` | 场景设计概述 |
| 需求文档 | `.kiro/specs/ue-office-scene-build/requirements.md` | 场景需求定义 |
