# LOD 与性能优化指南

## 概述

本文档定义 WhyBuddy UE5 场景的 LOD（Level of Detail）策略、虚拟纹理 / Mipmap 配置、性能预算与调优方法。目标是在 GTX 1060 级别显卡上以 30fps 以上稳定运行，同时在高端硬件上保持视觉品质。

**性能预算总览：**
- 场景总面数上限：200 万三角面（高画质档位）
- 最低目标帧率：30fps @ 1080p（GTX 1060 6GB）
- 推荐目标帧率：60fps @ 1080p（RTX 2060 及以上）
- 显存预算：≤ 4GB（纹理 + 网格 + 缓冲区）

---

## 1. LOD 策略概述

### 1.1 设计原则

Kenney Furniture Kit 为低多边形风格资产，单个模型面数通常在 200–2000 三角面之间。对于此类资产，LOD 策略以"减少远距离渲染开销"为主，而非传统高模到低模的大幅简化。

建议为所有主要家具模型生成 **2 级 LOD**：

| LOD 层级 | 说明 | 面数目标 | 适用距离 |
|----------|------|----------|----------|
| LOD0 | 原始模型（高精度） | 100% 原始面数 | 近距离（0–500cm） |
| LOD1 | 简化模型（低精度） | 原始面数的 50%–70% | 远距离（500cm+） |

### 1.2 为什么只需 2 级

- Kenney 模型本身已经是低多边形，进一步简化空间有限
- 办公室场景为室内封闭空间，最远观察距离约 20m
- 2 级 LOD 已足够覆盖近景与远景的性能差异
- 过多 LOD 层级会增加内存占用，对低多边形模型得不偿失

---

## 2. 各家具类别 LOD 配置

### 2.1 办公桌类

| 模型 | LOD0 面数（估） | LOD1 面数（估） | 切换距离 | 说明 |
|------|-----------------|-----------------|----------|------|
| SM_Desk_01 | ~800 | ~480 | 500cm | 桌面保留，抽屉细节简化 |
| SM_Desk_02 | ~750 | ~450 | 500cm | 同上 |
| SM_Table_Meeting_01 | ~600 | ~360 | 600cm | 会议桌较大，切换距离稍远 |
| SM_Table_Coffee_01 | ~400 | ~240 | 400cm | 茶几较小，可更早切换 |
| SM_SideTable_01 | ~300 | ~180 | 400cm | 边桌 |

### 2.2 椅子类

| 模型 | LOD0 面数（估） | LOD1 面数（估） | 切换距离 | 说明 |
|------|-----------------|-----------------|----------|------|
| SM_Chair_Office_01 | ~1200 | ~720 | 500cm | 办公椅细节较多 |
| SM_Chair_Rounded_01 | ~1000 | ~600 | 500cm | 会议椅 |
| SM_Chair_Lounge_01 | ~800 | ~480 | 500cm | 休闲椅 |

### 2.3 储物与展示类

| 模型 | LOD0 面数（估） | LOD1 面数（估） | 切换距离 | 说明 |
|------|-----------------|-----------------|----------|------|
| SM_Shelf_01 | ~600 | ~360 | 600cm | 书架 |
| SM_Books_01 | ~400 | ~200 | 400cm | 书本组合 |
| SM_CoatRack_01 | ~300 | ~180 | 400cm | 衣帽架 |

### 2.4 沙发与休息区

| 模型 | LOD0 面数（估） | LOD1 面数（估） | 切换距离 | 说明 |
|------|-----------------|-----------------|----------|------|
| SM_Sofa_01 | ~1500 | ~900 | 600cm | 沙发面数较高 |
| SM_WaterDispenser_01 | ~500 | ~300 | 400cm | 饮水机 |

### 2.5 电子设备类

| 模型 | LOD0 面数（估） | LOD1 面数（估） | 切换距离 | 说明 |
|------|-----------------|-----------------|----------|------|
| SM_Monitor_01 | ~600 | ~360 | 400cm | 显示器 |
| SM_Keyboard_01 | ~400 | ~200 | 300cm | 键盘，小物件更早切换 |
| SM_Mouse_01 | ~200 | ~120 | 300cm | 鼠标 |
| SM_Laptop_01 | ~500 | ~300 | 400cm | 笔记本电脑 |

### 2.6 装饰与灯具类

| 模型 | LOD0 面数（估） | LOD1 面数（估） | 切换距离 | 说明 |
|------|-----------------|-----------------|----------|------|
| SM_Plant_01/02/03 | ~800 | ~480 | 500cm | 绿植 |
| SM_Lamp_Floor_01 | ~400 | ~240 | 400cm | 落地灯 |
| SM_Lamp_Table_01 | ~300 | ~180 | 300cm | 台灯 |
| SM_Lamp_Wall_01 | ~200 | ~120 | 300cm | 壁灯 |
| SM_Whiteboard_01 | ~500 | ~300 | 600cm | 白板 |

### 2.7 建筑结构

| 几何体 | LOD 策略 | 说明 |
|--------|----------|------|
| 墙面 | 不需要 LOD | 简单平面几何体 |
| 地板 | 不需要 LOD | 简单平面几何体 |
| 天花板 | 不需要 LOD | 简单平面几何体 |
| 踢脚线 | 不需要 LOD | 简单条状几何体 |
| 门框 | 可选 LOD1 | 面数极低，通常不需要 |

---

## 3. UE5 LOD 自动生成设置

### 3.1 在 Static Mesh Editor 中配置

打开任意 Static Mesh，在 **Details > LOD Settings** 中配置：

| 设置项 | 推荐值 | 说明 |
|--------|--------|------|
| Number of LODs | 2 | LOD0 + LOD1 |
| Auto Compute LOD Distances | true | 自动计算切换距离 |
| LOD Group | SmallProp / LargeProp | 按物体大小选择 |

### 3.2 LOD Reduction Settings（LOD1）

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| Percent Triangles | 0.5–0.7 | 保留 50%–70% 三角面 |
| Max Deviation | 2.0 | 最大允许偏差（像素） |
| Welding Threshold | 0.1 | 顶点焊接阈值 |
| Hard Edge Angle | 80° | 硬边角度阈值 |
| Silhouette | Normal | 轮廓保持级别 |
| Texture | Normal | 纹理坐标保持级别 |
| Shading | Normal | 着色保持级别 |

### 3.3 Screen Size 阈值

UE5 使用 Screen Size（屏幕占比）来决定 LOD 切换，而非绝对距离。以下为推荐阈值：

| LOD 层级 | Screen Size 阈值 | 说明 |
|----------|------------------|------|
| LOD0 | 1.0（默认） | 物体占屏幕比例较大时使用 |
| LOD1 | 0.3–0.5 | 物体占屏幕比例较小时切换 |

**按物体大小的推荐值：**

| 物体类别 | LOD1 Screen Size | 说明 |
|----------|------------------|------|
| 大型家具（桌、沙发、书架） | 0.3 | 较晚切换，保持近景品质 |
| 中型家具（椅子、茶几） | 0.4 | 适中 |
| 小型道具（键盘、鼠标、台灯） | 0.5 | 较早切换，节省性能 |

### 3.4 批量 LOD 生成脚本

```python
# UE5 Python 脚本：批量为 Kenney 模型生成 LOD
import unreal

mesh_path = "/Game/CubePets/Environment/Office/Meshes/"
assets = unreal.EditorAssetLibrary.list_assets(mesh_path, recursive=True)

reduction_options = unreal.MeshReductionSettings()
reduction_options.percent_triangles = 0.6
reduction_options.max_deviation = 2.0

for asset in assets:
    obj = unreal.EditorAssetLibrary.load_asset(asset)
    if isinstance(obj, unreal.StaticMesh):
        # 设置 LOD 数量为 2
        obj.set_editor_property("num_lods", 2)
        # 配置 LOD1 简化参数
        lod_info = obj.get_editor_property("lod_info")
        if len(lod_info) > 1:
            lod_info[1].reduction_settings = reduction_options
            lod_info[1].screen_size = 0.4
        unreal.EditorAssetLibrary.save_asset(asset)

print("LOD generation complete.")
```

---

## 4. 虚拟纹理（Virtual Texture）配置

### 4.1 适用场景

虚拟纹理（VT）适用于大面积表面的纹理流送，可显著降低显存占用。在本项目中，以下表面建议启用虚拟纹理：

| 表面 | 是否启用 VT | 原因 |
|------|-------------|------|
| 地板（18m × 14m） | ✅ 推荐 | 大面积平面，VT 可按需加载 |
| 墙面（18m × 3m / 14m × 3m） | ✅ 推荐 | 大面积平面 |
| 天花板 | ✅ 可选 | 面积较大但通常不是视觉焦点 |
| 家具贴图 | ❌ 不推荐 | Kenney 模型使用顶点色，无贴图 |

### 4.2 项目级 VT 设置

在 `Project Settings > Rendering > Virtual Textures` 中：

| 设置项 | 推荐值 | 说明 |
|--------|--------|------|
| Enable Virtual Texture Support | true | 启用 VT 系统 |
| Enable Virtual Texture Lightmaps | true | 光照贴图使用 VT |
| Virtual Texture Tile Size | 128 | 瓦片大小 |
| Virtual Texture Tile Border Size | 4 | 瓦片边框 |
| Virtual Texture Feedback Factor | 16 | 反馈因子 |

### 4.3 Runtime Virtual Texture (RVT) 配置

为地板和墙面创建 Runtime Virtual Texture：

1. 在场景中放置 `Runtime Virtual Texture Volume`，覆盖整个房间
2. 创建 `Runtime Virtual Texture` 资产，设置：
   - Virtual Texture Content: Base Color, Normal, Roughness, Specular
   - Tile Count: 8 × 8
   - Tile Size: 256
   - Tile Border Size: 4
3. 在地板/墙面材质中启用 RVT 输出

### 4.4 当前阶段说明

由于 Kenney 模型使用顶点色而非贴图，虚拟纹理在当前阶段的收益有限。主要收益来自：
- 地板/墙面如果后续添加细节纹理
- Lightmap 使用 VT 可减少内存占用
- 为后续高精度资产扩展预留能力

---

## 5. Mipmap 策略

### 5.1 Mipmap 基础配置

所有导入的 Texture2D 资产默认启用 Mipmap。在 Texture Editor 中确认：

| 设置项 | 推荐值 | 说明 |
|--------|--------|------|
| Mip Gen Settings | FromTextureGroup | 从纹理组继承 |
| LOD Bias | 0 | 默认无偏移 |
| LOD Group | World / WorldNormalMap | 按贴图类型选择 |
| Never Stream | false | 允许流送 |
| Streaming Priority | 0 | 默认优先级 |

### 5.2 纹理流送（Texture Streaming）配置

在 `Project Settings > Rendering > Streaming` 中：

| 设置项 | 推荐值 | 说明 |
|--------|--------|------|
| Texture Streaming | true | 启用纹理流送 |
| Pool Size (MB) | 1024 | 纹理流送池大小（GTX 1060 建议 1GB） |
| Use All Mips | false | 不强制加载所有 Mip 级别 |

### 5.3 按贴图类型的 Mipmap 策略

| 贴图类型 | 最大分辨率 | Mip 级别 | 流送策略 |
|----------|-----------|----------|----------|
| BaseColor (BC) | 2048 | 自动（11 级） | 正常流送 |
| Normal (N) | 2048 | 自动（11 级） | 正常流送 |
| ORM | 2048 | 自动（11 级） | 正常流送 |
| Emissive (E) | 1024 | 自动（10 级） | 正常流送 |
| Lightmap | 按场景 | 自动 | VT 流送 |

### 5.4 显存预算分配

| 类别 | 预算 | 说明 |
|------|------|------|
| 纹理流送池 | 1024 MB | 所有流送纹理的总预算 |
| 静态网格体 | 256 MB | 所有 LOD 级别的网格数据 |
| Lumen 缓存 | 512 MB | Surface Cache + 光追缓冲 |
| 帧缓冲 + 后处理 | 256 MB | G-Buffer、深度、后处理 |
| **总计** | **~2048 MB** | GTX 1060 6GB 的安全预算 |

---

## 6. 性能基准测试指南（GTX 1060）

### 6.1 测试环境要求

| 项目 | 最低要求 |
|------|----------|
| GPU | NVIDIA GTX 1060 6GB |
| CPU | Intel i5-8400 / AMD Ryzen 5 2600 |
| RAM | 16 GB |
| 分辨率 | 1920 × 1080 |
| 画质档位 | Medium（中等） |
| 引擎版本 | UE5 5.4+ |

### 6.2 性能指标目标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| FPS | ≥ 30 | 最低帧率 |
| Frame Time | ≤ 33.3ms | 单帧耗时 |
| GPU Time | ≤ 25ms | GPU 渲染耗时 |
| Draw Calls | ≤ 2000 | 绘制调用数 |
| Triangle Count | ≤ 2,000,000 | 场景总三角面 |
| Texture Memory | ≤ 1024 MB | 纹理显存占用 |
| Total VRAM | ≤ 4096 MB | 总显存占用 |

### 6.3 性能分析命令

在 UE5 编辑器控制台中使用以下命令进行性能分析：

```
# 基础性能统计
stat unit              — 显示 Frame/Game/Draw/GPU 时间
stat fps               — 显示帧率
stat unitgraph         — 图形化显示帧时间

# GPU 性能
stat gpu               — GPU 各阶段耗时
stat gpuparticles      — GPU 粒子统计
ProfileGPU             — 详细 GPU 性能报告

# 渲染统计
stat scenerendering    — 场景渲染统计
stat rhi               — RHI 层统计（Draw Calls 等）
stat d3d12rhi          — D3D12 RHI 统计

# 内存统计
stat memory            — 总内存统计
stat streaming         — 纹理流送统计
stat streamingdetails  — 纹理流送详情
stat virtualtexture    — 虚拟纹理统计

# Lumen 统计
stat lumen             — Lumen GI 统计
stat lumensurface      — Lumen Surface Cache 统计

# 网格体统计
stat staticmeshcomp    — 静态网格体组件统计
stat initviews         — 可见性计算统计

# 综合分析
stat startfile         — 开始录制性能数据
stat stopfile          — 停止录制（生成 .ue4stats 文件）
```

### 6.4 性能分析检查清单

#### 第一步：基础帧率检查
- [ ] 运行 `stat unit`，确认 Frame Time ≤ 33.3ms
- [ ] 确认 GPU Time 是否为瓶颈（GPU Time > Game Time）
- [ ] 确认 Draw Thread 是否为瓶颈

#### 第二步：渲染负载检查
- [ ] 运行 `stat scenerendering`，检查 Draw Calls 数量
- [ ] 运行 `stat rhi`，确认 Triangles Drawn ≤ 200 万
- [ ] 检查是否有不必要的透明物体（透明排序开销）

#### 第三步：纹理与内存检查
- [ ] 运行 `stat streaming`，确认纹理流送池未溢出
- [ ] 运行 `stat memory`，确认总显存占用 ≤ 4GB
- [ ] 检查是否有未压缩或过大的贴图

#### 第四步：Lumen 性能检查
- [ ] 运行 `stat lumen`，检查 Lumen 各阶段耗时
- [ ] 如果 Lumen 耗时过高，降低 `Lumen Scene Lighting Quality`
- [ ] 考虑在低配模式下关闭 Lumen，使用 Screen Space GI

#### 第五步：LOD 有效性检查
- [ ] 使用 `Show > Visualize > LOD Coloring` 查看 LOD 分布
- [ ] 确认远处物体已切换到 LOD1
- [ ] 确认 LOD 切换无明显跳变（popping）

---

## 7. 画质档位配置（Scalability Settings）

### 7.1 四档画质定义

#### Low（低画质）— 目标：GTX 1050 / 集成显卡

| 设置项 | 值 |
|--------|-----|
| Screen Percentage | 67% |
| View Distance | Medium |
| Anti-Aliasing | FXAA |
| Post Process | Low |
| Shadows | Low |
| Global Illumination | Screen Space GI |
| Reflections | Screen Space |
| Textures | Medium |
| Effects | Low |
| Foliage | Low |

#### Medium（中画质）— 目标：GTX 1060

| 设置项 | 值 |
|--------|-----|
| Screen Percentage | 85% |
| View Distance | High |
| Anti-Aliasing | TSR (Medium) |
| Post Process | Medium |
| Shadows | Medium (VSM) |
| Global Illumination | Lumen (Quality 0.5) |
| Reflections | Lumen (Quality 0.5) |
| Textures | High |
| Effects | Medium |
| Foliage | Medium |

#### High（高画质）— 目标：RTX 2060 / RX 5700

| 设置项 | 值 |
|--------|-----|
| Screen Percentage | 100% |
| View Distance | Epic |
| Anti-Aliasing | TSR (High) |
| Post Process | High |
| Shadows | High (VSM) |
| Global Illumination | Lumen (Quality 1.0) |
| Reflections | Lumen (Quality 1.0) |
| Textures | Epic |
| Effects | High |
| Foliage | High |

#### Epic（极致画质）— 目标：RTX 3070+

| 设置项 | 值 |
|--------|-----|
| Screen Percentage | 100% |
| View Distance | Epic |
| Anti-Aliasing | TSR (Epic) |
| Post Process | Epic |
| Shadows | Epic (VSM + Ray Traced) |
| Global Illumination | Lumen (Quality 1.5, HW RT) |
| Reflections | Lumen (Quality 1.0, HW RT) |
| Textures | Epic |
| Effects | Epic |
| Foliage | Epic |

### 7.2 画质档位切换

通过控制台命令切换：

```
sg.ResolutionQuality 0-3      — 分辨率缩放
sg.ViewDistanceQuality 0-3     — 视距
sg.AntiAliasingQuality 0-3     — 抗锯齿
sg.PostProcessQuality 0-3      — 后处理
sg.ShadowQuality 0-3           — 阴影
sg.GlobalIlluminationQuality 0-3 — 全局光照
sg.ReflectionQuality 0-3       — 反射
sg.TextureQuality 0-3          — 纹理
sg.EffectsQuality 0-3          — 特效
sg.FoliageQuality 0-3          — 植被
```

---

## 8. 推荐控制台变量（Console Variables）

### 8.1 性能调优 CVars

```ini
# Lumen 性能调优
r.Lumen.DiffuseIndirect.Allow=1           ; 启用 Lumen 漫反射
r.Lumen.Reflections.Allow=1               ; 启用 Lumen 反射
r.Lumen.TraceMeshSDFs.Allow=1             ; 启用 Mesh SDF 追踪
r.Lumen.ScreenProbeGather.ScreenSpaceTracingOcclusionMode=1

# 阴影优化
r.Shadow.Virtual.Enable=1                 ; 启用 Virtual Shadow Maps
r.Shadow.Virtual.MaxPhysicalPages=2048    ; VSM 物理页数上限
r.Shadow.Virtual.ResolutionLodBiasLocal=0.5 ; 局部光源 VSM 分辨率偏移

# 纹理流送
r.Streaming.PoolSize=1024                 ; 纹理流送池（MB）
r.Streaming.MaxTempMemoryAllowed=128      ; 临时内存上限
r.Streaming.HLODStrategy=0               ; HLOD 流送策略

# TSR（Temporal Super Resolution）
r.TSR.Quality=1                           ; TSR 质量（0=Low, 1=Medium, 2=High, 3=Epic）
r.TSR.ShadingRejection.Flickering=1       ; 减少闪烁

# 渲染优化
r.DefaultFeature.AutoExposure=1           ; 自动曝光
r.DefaultFeature.MotionBlur=0             ; 关闭运动模糊（提升清晰度）
r.DefaultFeature.Bloom=1                  ; 泛光
r.DefaultFeature.AmbientOcclusion=1       ; 环境光遮蔽

# 遮挡剔除
r.HZBOcclusion=1                          ; 启用 HZB 遮挡剔除
r.AllowOcclusionQueries=1                 ; 启用遮挡查询
```

### 8.2 调试用 CVars

```ini
# 可视化调试
r.VisualizeBuffer=Overview                ; 可视化 G-Buffer
ShowFlag.VisualizeBuffer=1
ShowFlag.LODColoring=1                    ; LOD 着色可视化
ShowFlag.WireFrame=1                      ; 线框模式

# 性能限制测试
t.MaxFPS=30                               ; 锁定 30fps 测试
t.MaxFPS=60                               ; 锁定 60fps 测试
t.MaxFPS=0                                ; 解锁帧率

# Lumen 调试
r.Lumen.Visualize=1                       ; 可视化 Lumen 追踪
r.Lumen.DiffuseIndirect.Visualize=1       ; 可视化漫反射间接光
```

---

## 9. 优化检查清单（发布前）

### 9.1 资产优化
- [ ] 所有主要家具模型已生成 LOD（至少 2 级）
- [ ] LOD 切换无明显跳变
- [ ] 无冗余或未使用的资产
- [ ] 贴图分辨率符合规范（主要家具 2048，小道具 1024，远景 512）
- [ ] 所有贴图已启用 Mipmap 和纹理流送

### 9.2 渲染优化
- [ ] 场景总三角面 ≤ 200 万
- [ ] Draw Calls ≤ 2000
- [ ] 无不必要的透明材质
- [ ] 静态物体已标记为 Static
- [ ] 合理使用 Instanced Static Mesh（重复物体）

### 9.3 灯光优化
- [ ] Lumen 参数已按画质档位配置
- [ ] 无不必要的动态阴影投射
- [ ] 局部光源 Attenuation Radius 合理
- [ ] 低画质档位已回退到 Screen Space GI

### 9.4 内存优化
- [ ] 纹理流送池大小合理（GTX 1060 建议 1024MB）
- [ ] 总显存占用 ≤ 4GB
- [ ] 无泄漏的 Render Target 或临时缓冲区

### 9.5 性能验证
- [ ] GTX 1060 @ 1080p Medium 档位 ≥ 30fps
- [ ] RTX 2060 @ 1080p High 档位 ≥ 60fps
- [ ] 无明显卡顿或帧率波动
- [ ] `stat unit` 各项指标正常

---

## 10. 文件引用

| 文件 | 说明 |
|------|------|
| `ue5/docs/naming-conventions.md` | 资产命名规范 |
| `ue5/docs/material-system.md` | 材质系统设计 |
| `ue5/docs/lighting-system.md` | 灯光系统配置 |
| `ue5/docs/asset-inventory.md` | 完整资产清单 |
