# 灯光系统配置指南

## 概述

本文档定义 WhyBuddy UE5 场景的完整灯光系统，包括主光源、局部补光、灯光预设与 Lumen GI 配置。灯光设计以 Three.js OfficeRoom 为参考蓝本，在 UE5 中使用 Lumen 全局光照实现高品质实时光影。

**房间尺寸参考**（来自 `RoomShellData.h`）：
- 地板：18m × 14m（1800cm × 1400cm）
- 墙高：3.0m（300cm）
- 天花板位置：Z = 300cm

**坐标系**（UE5 Z-up，单位 cm）：
- UE5_X = ThreeJS_X × 100
- UE5_Y = ThreeJS_Z × -100
- UE5_Z = ThreeJS_Y × 100

---

## 1. 主光源 — Directional Light（模拟日光）

### 设计意图

模拟从窗户/天窗射入的自然日光，作为场景的主要照明来源。由于房间前方（+Y 方向，Three.js -Z 方向）为开放区域，日光从前上方斜射入室内。

### 参数配置

| 参数 | 日间值 | 说明 |
|------|--------|------|
| Rotation (Pitch) | -45° | 从上方 45° 角射入 |
| Rotation (Yaw) | -30° | 略偏左前方，模拟上午日光 |
| Intensity (Lux) | 8.0 lux | UE5 Directional Light 默认单位 |
| Light Color | #FFF5E6 (6200K) | 偏暖白日光 |
| Source Angle | 1.0° | 柔和阴影边缘 |
| Cast Shadows | true | 启用动态阴影 |
| Atmosphere Sun Light | true | 与 Sky Atmosphere 联动 |
| Use Temperature | true | 启用色温控制 |
| Temperature (K) | 6200 | 日光色温 |

### 配套组件

- **Sky Light**：Intensity = 1.5，Cubemap 或 Real Time Capture，提供环境漫反射补光
- **Sky Atmosphere**（可选）：若需要室外天空可见效果
- **Exponential Height Fog**（可选）：Fog Density = 0.002，增加空间层次感

---

## 2. 局部补光

### 2.1 天花板 Rect Light（模拟办公室顶灯）

建议在天花板下方布置 **6 盏 Rect Light**，模拟嵌入式办公顶灯。Rect Light 能产生柔和均匀的面光源效果，非常适合模拟荧光灯/LED 面板灯。

| 编号 | 位置 (UE5 cm) | 覆盖区域 | 尺寸 (cm) |
|------|---------------|----------|-----------|
| CL-1 | (-400, 250, 290) | 左侧工位区 | 120 × 60 |
| CL-2 | (400, 250, 290) | 右侧工位区 | 120 × 60 |
| CL-3 | (-400, -100, 290) | 左侧中部 | 120 × 60 |
| CL-4 | (400, -100, 290) | 右侧中部 | 120 × 60 |
| CL-5 | (0, 350, 290) | 会议区上方 | 120 × 60 |
| CL-6 | (0, -350, 290) | 休息区上方 | 120 × 60 |

**通用参数：**

| 参数 | 值 | 说明 |
|------|-----|------|
| Intensity | 800 cd | 适中亮度 |
| Light Color | #FFF8F0 (4800K) | 中性暖白 |
| Source Width | 120 cm | 灯具宽度 |
| Source Height | 60 cm | 灯具高度 |
| Attenuation Radius | 600 cm | 衰减半径 |
| Barn Door Angle | 60° | 控制光锥角度 |
| Cast Shadows | true | 产生柔和阴影 |
| Rotation (Pitch) | -90° | 朝下照射 |

### 2.2 落地灯 Point Light

来源：Three.js FloorLamp 点光源（已在 `LoungeDecorData.h` 中定义）。

| 参数 | 值 | 来源 |
|------|-----|------|
| Position | (-615, -65, 185) cm | Three.js (-6.15, 1.85, 0.65) |
| Intensity | 2000 cd | Three.js 0.42 → UE5 换算 |
| Light Color | #FFE2B8 (2800K) | 暖黄色台灯光 |
| Attenuation Radius | 460 cm | Three.js distance 4.6m |
| Source Radius | 10 cm | 模拟灯泡大小 |
| Cast Shadows | true | 产生局部阴影 |

> 注意：此光源参数已在 `LoungeDecorData::FloorLamp` 命名空间中定义，灯光蓝图应直接引用。

### 2.3 壁灯 Point Light

来源：Three.js WallLamp 点光源（已在 `LoungeDecorData.h` 中定义）。

| 参数 | 值 | 来源 |
|------|-----|------|
| Position | (0, 440, 122) cm | Three.js (0, 1.22, -4.4) |
| Intensity | 800 cd | Three.js 0.18 → UE5 换算 |
| Light Color | #FFDDB0 (2900K) | 暖黄色壁灯光 |
| Attenuation Radius | 300 cm | Three.js distance 3.0m |
| Source Radius | 5 cm | 较小灯泡 |
| Cast Shadows | false | 壁灯通常不需要阴影 |

### 2.4 桌面台灯 Point Light（可选补光）

为工位区增加桌面台灯补光，增强工作区域照明层次。

| 编号 | 位置 (UE5 cm) | 说明 |
|------|---------------|------|
| DL-1 | (-350, 200, 100) | 左前工位台灯 |
| DL-2 | (350, 200, 100) | 右前工位台灯 |
| DL-3 | (-350, 350, 100) | 左后工位台灯 |
| DL-4 | (350, 350, 100) | 右后工位台灯 |

**通用参数：**

| 参数 | 值 |
|------|-----|
| Intensity | 500 cd |
| Light Color | #FFE8CC (3200K) |
| Attenuation Radius | 200 cm |
| Source Radius | 5 cm |
| Cast Shadows | false |

---

## 3. 灯光预设

### 3.1 日间预设（Day）

模拟正常工作日白天的办公室照明。

| 光源 | Intensity | Color Temp | 特殊设置 |
|------|-----------|------------|----------|
| Directional Light | 8.0 lux | 6200K | Pitch -45°, Yaw -30° |
| Sky Light | 1.5 | — | Real Time Capture |
| Rect Light (×6) | 800 cd | 4800K | 全部开启 |
| Floor Lamp | 2000 cd | 2800K | 开启 |
| Wall Lamp | 800 cd | 2900K | 开启 |
| Desk Lamps (×4) | 500 cd | 3200K | 开启 |

**Post Process Volume：**

| 参数 | 值 |
|------|-----|
| Exposure Compensation | 0.0 |
| Bloom Intensity | 0.3 |
| Vignette Intensity | 0.1 |
| Color Grading LUT | 无 |
| White Balance Temp | 6200K |

### 3.2 夜间预设（Night）

模拟夜间加班或值班场景，关闭日光，依赖室内灯具。

| 光源 | Intensity | Color Temp | 特殊设置 |
|------|-----------|------------|----------|
| Directional Light | 0.0 lux | — | 关闭 |
| Sky Light | 0.3 | — | 低强度月光 |
| Rect Light (×6) | 600 cd | 3800K | 全部开启，偏暖 |
| Floor Lamp | 2500 cd | 2700K | 增强，主要光源 |
| Wall Lamp | 1200 cd | 2700K | 增强 |
| Desk Lamps (×4) | 800 cd | 3000K | 增强 |

**Post Process Volume：**

| 参数 | 值 |
|------|-----|
| Exposure Compensation | -1.0 |
| Bloom Intensity | 0.6 |
| Vignette Intensity | 0.3 |
| Color Grading — Shadows | 偏蓝 (0.85, 0.9, 1.0) |
| White Balance Temp | 3500K |

### 3.3 会议预设（Meeting）

模拟会议室场景，会议区域重点照明，其他区域适当降低。

| 光源 | Intensity | Color Temp | 特殊设置 |
|------|-----------|------------|----------|
| Directional Light | 4.0 lux | 5500K | 降低强度 |
| Sky Light | 1.0 | — | 适中 |
| Rect Light CL-5 | 1200 cd | 5000K | 会议区加强 |
| Rect Light 其他 | 400 cd | 4500K | 降低 |
| Floor Lamp | 1000 cd | 3000K | 降低 |
| Wall Lamp | 600 cd | 3000K | 适中 |
| Desk Lamps | 200 cd | 3200K | 降低 |

**Post Process Volume：**

| 参数 | 值 |
|------|-----|
| Exposure Compensation | 0.0 |
| Bloom Intensity | 0.2 |
| Vignette Intensity | 0.05 |
| White Balance Temp | 5200K |

### 3.4 演示预设（Presentation）

模拟投影演示场景，整体偏暗，投影区域突出。

| 光源 | Intensity | Color Temp | 特殊设置 |
|------|-----------|------------|----------|
| Directional Light | 1.0 lux | 5000K | 大幅降低 |
| Sky Light | 0.5 | — | 低 |
| Rect Light CL-5 | 200 cd | 4000K | 会议区微光 |
| Rect Light 其他 | 100 cd | 4000K | 极低 |
| Floor Lamp | 500 cd | 2700K | 低 |
| Wall Lamp | 300 cd | 2700K | 低 |
| Desk Lamps | 0 cd | — | 关闭 |

**Post Process Volume：**

| 参数 | 值 |
|------|-----|
| Exposure Compensation | -1.5 |
| Bloom Intensity | 0.8 |
| Vignette Intensity | 0.4 |
| Color Grading — Shadows | 偏蓝 (0.8, 0.85, 1.0) |
| White Balance Temp | 4500K |

---

## 4. Lumen GI 配置指南

### 4.1 项目设置

在 `Project Settings > Rendering` 中启用：

| 设置项 | 值 | 说明 |
|--------|-----|------|
| Global Illumination Method | Lumen | 启用 Lumen GI |
| Reflection Method | Lumen | 启用 Lumen 反射 |
| Shadow Map Method | Virtual Shadow Maps | 配合 Lumen 使用 |
| Generate Mesh Distance Fields | true | Lumen 依赖 |
| Software Ray Tracing | true | 默认软件光追 |
| Hardware Ray Tracing | 按 GPU 能力 | RTX 显卡可开启 |

### 4.2 Lumen 场景设置

在 `Post Process Volume` 中配置 Lumen 参数：

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| Lumen Scene Lighting Quality | 1.0 (Medium) | 平衡质量与性能 |
| Lumen Scene Detail | 1.0 | 场景细节级别 |
| Lumen Scene View Distance | 20000 cm | 200m 视距 |
| Final Gather Quality | 1.0 | 最终聚合质量 |
| Final Gather Lighting Update Speed | 0.5 | 光照更新速度 |
| Lumen Max Trace Distance | 20000 cm | 最大追踪距离 |

### 4.3 Lumen 反射设置

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| Lumen Reflection Quality | 1.0 | 反射质量 |
| Ray Lighting Mode | Surface Cache | 使用表面缓存 |
| Max Roughness to Trace | 0.4 | 粗糙度阈值 |

### 4.4 性能优化建议

针对 GTX 1060 最低配置目标（30fps）：

| 优化项 | 低配值 | 高配值 |
|--------|--------|--------|
| Lumen Scene Lighting Quality | 0.5 | 1.5 |
| Final Gather Quality | 0.5 | 1.5 |
| Lumen Reflection Quality | 0.5 | 1.0 |
| Software Ray Tracing | true | true |
| Hardware Ray Tracing | false | true (RTX) |
| Screen Percentage | 75% | 100% |
| TSR Quality | Medium | Epic |

---

## 5. Post Process Volume 通用设置

在场景中放置一个 **Unbound Post Process Volume**（覆盖全场景）：

### 基础设置

| 参数 | 值 |
|------|-----|
| Priority | 0 |
| Infinite Extent (Unbound) | true |
| Blend Radius | 0 |

### 自动曝光

| 参数 | 值 |
|------|-----|
| Metering Mode | Auto Exposure Histogram |
| Min EV100 | 3.0 |
| Max EV100 | 12.0 |
| Speed Up | 2.0 |
| Speed Down | 1.0 |

### 色调映射

| 参数 | 值 |
|------|-----|
| Tone Curve Amount | 1.0 |
| Shoulder | 0.26 |
| Toe | 0.55 |

---

## 6. 色温参考指南

| 色温 (K) | 光源类型 | 视觉感受 | 适用场景 |
|----------|----------|----------|----------|
| 2700K | 白炽灯/蜡烛 | 暖黄色，温馨 | 落地灯、壁灯、夜间 |
| 3000K | 暖白 LED | 暖白色，舒适 | 台灯、休息区 |
| 3500K | 中性暖白 | 自然暖白 | 夜间顶灯 |
| 4000K | 中性白 | 中性，清晰 | 演示模式顶灯 |
| 4800K | 冷暖过渡 | 自然白 | 日间顶灯 |
| 5500K | 正午日光 | 纯白 | 会议模式日光 |
| 6200K | 阴天日光 | 偏冷白 | 日间主光源 |
| 6500K | 标准日光 | 冷白色 | 最冷白参考 |

### 色温与 UE5 颜色对照

| 色温 | 近似 Hex | Linear RGB |
|------|----------|------------|
| 2700K | #FFB46B | (1.0, 0.706, 0.420) |
| 2800K | #FFB870 | (1.0, 0.722, 0.439) |
| 2900K | #FFBC76 | (1.0, 0.737, 0.463) |
| 3200K | #FFC88A | (1.0, 0.784, 0.541) |
| 3800K | #FFD9A8 | (1.0, 0.851, 0.659) |
| 4800K | #FFF0D4 | (1.0, 0.941, 0.831) |
| 5000K | #FFF2DA | (1.0, 0.949, 0.855) |
| 5500K | #FFF5E6 | (1.0, 0.961, 0.902) |
| 6200K | #FFF8F0 | (1.0, 0.973, 0.941) |
| 6500K | #FFFAF5 | (1.0, 0.980, 0.961) |

---

## 7. 蓝图控制接口

灯光预设通过 `BP_LightingPreset` Actor 蓝图进行控制。

### 主要方法

```
ApplyPreset(PresetName: ELightingPresetType)
  → 切换到指定预设，平滑过渡所有灯光参数

SetCustomIntensity(Intensity: float)
  → 全局亮度缩放 (0.0 - 2.0)

SetCustomColorTemp(ColorTemp: float)
  → 全局色温覆盖 (2700K - 6500K)

GetCurrentPreset() → ELightingPresetType
  → 获取当前激活的预设名称
```

### 预设枚举

```
ELightingPresetType:
  Day           — 日间办公
  Night         — 夜间模式
  Meeting       — 会议模式
  Presentation  — 演示模式
```

### 指令协议集成

灯光预设可通过 WebSocket 指令协议远程控制：

```json
{
  "method": "scene.setLighting",
  "params": {
    "preset": "day",
    "intensity": 1.0,
    "colorTemp": 5500
  }
}
```

---

## 8. 文件引用

| 文件 | 说明 |
|------|------|
| `LoungeDecorData.h` | 落地灯、壁灯的 Point Light 参数定义 |
| `LightingPresetData.h` | 灯光预设数据结构与参数常量 |
| `BP_LightingPreset.h` | 灯光预设蓝图 Actor 头文件 |
| `RoomShellData.h` | 房间尺寸参考 |
