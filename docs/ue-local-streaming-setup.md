# UE5 本地 Pixel Streaming 开发环境搭建指南

本文档介绍如何在本地开发机上配置并运行 UE5 Pixel Streaming，将 UE5 渲染画面通过 WebRTC 推送到浏览器。

---

## 目录

- [前置条件](#前置条件)
- [架构概览](#架构概览)
- [环境搭建步骤](#环境搭建步骤)
- [配置参考](#配置参考)
- [启动与验证](#启动与验证)
- [常见问题排查](#常见问题排查)

---

## 前置条件

### 硬件要求

| 项目 | 最低要求 | 推荐配置 |
|------|---------|---------|
| GPU | NVIDIA GTX 1060 / AMD RX 580 | NVIDIA RTX 3060 及以上 |
| 显存 | 4 GB | 8 GB+ |
| 内存 | 16 GB | 32 GB |
| CPU | 4 核 | 8 核+ |

### 软件要求

| 软件 | 版本 | 说明 |
|------|------|------|
| Unreal Engine 5 | 5.3 或 5.4 | 需启用 Pixel Streaming 插件 |
| Node.js | 18+ | 推荐 20 LTS |
| pnpm | 10+ | 包管理器 |
| Windows | 10/11 | 当前仅支持 Windows |

### UE5 Pixel Streaming 插件

1. 打开 UE5 编辑器，进入 **Edit → Plugins**。
2. 搜索 **Pixel Streaming**。
3. 勾选启用，重启编辑器。
4. 确认插件状态为 **Enabled**。

> 如果使用源码编译版 UE5，需要确保 `PixelStreaming` 和 `PixelStreamingPlayer` 模块已包含在构建目标中。

---

## 架构概览

```
┌──────────────────────────────────────────────────────────┐
│                      浏览器端                             │
│   VideoStreamPlayer  ←──  WebRTC  ←──  Pixel Stream      │
├──────────────────────────────────────────────────────────┤
│                   Node.js 服务端                          │
│                                                          │
│   ┌──────────────┐       ┌───────────────────┐           │
│   │  信令代理      │       │  UE 进程管理器     │           │
│   │  (WebSocket)  │       │  (child_process)  │           │
│   └──────┬───────┘       └────────┬──────────┘           │
│          │                        │                      │
│          ▼                        ▼                      │
│   ┌──────────────┐       ┌───────────────────┐           │
│   │  健康检查      │       │  配置管理           │           │
│   │  (heartbeat)  │       │  (.env / json)    │           │
│   └──────────────┘       └───────────────────┘           │
├──────────────────────────────────────────────────────────┤
│                   UE5 渲染进程                             │
│   Pixel Streaming Plugin  +  场景关卡                     │
└──────────────────────────────────────────────────────────┘
```

**数据流说明：**

1. Node.js 服务端通过 `child_process` 启动 UE5 编辑器进程。
2. UE5 启动后加载指定关卡，启用 Pixel Streaming 插件。
3. 信令代理（WebSocket）桥接浏览器与 UE5 的 WebRTC 握手。
4. 浏览器通过 WebRTC 接收 UE5 渲染画面。
5. 健康检查接口定时轮询 UE5 进程状态与性能指标。

---

## 环境搭建步骤

### 1. 克隆仓库并安装依赖

```bash
git clone <repo-url> whybuddy
cd whybuddy
pnpm install
```

### 2. 创建环境配置文件

```bash
cp .env.example .env
```

### 3. 配置 UE5 相关环境变量

编辑 `.env` 文件，找到 `UE5 Local Streaming Runtime` 部分，取消注释并填入实际路径：

```dotenv
# ── UE5 Local Streaming Runtime ────────────────────────────────
UE_EDITOR_PATH=C:/Program Files/Epic Games/UE_5.4/Engine/Binaries/Win64/UnrealEditor.exe
UE_PROJECT_PATH=C:/Projects/MyProject/MyProject.uproject
UE_MAP_NAME=/Game/Maps/MainLevel
```

> **路径格式**：Windows 路径中使用正斜杠 `/` 或双反斜杠 `\\` 均可。

### 4. 确认 UE5 项目已启用 Pixel Streaming

在 UE5 项目的 `.uproject` 文件中确认包含：

```json
{
  "Plugins": [
    {
      "Name": "PixelStreaming",
      "Enabled": true
    }
  ]
}
```

### 5. 启动服务

**方式一：使用 CMD 脚本**

```cmd
scripts\start-ue-streaming.bat
```

**方式二：使用 PowerShell 脚本**

```powershell
.\scripts\start-ue-streaming.ps1
```

**方式三：直接使用 pnpm**

```bash
pnpm run dev:server
```

> 使用启动脚本的优势在于它会自动加载 `.env`、验证必填变量并打印配置摘要。

---

## 配置参考

### 必填变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `UE_EDITOR_PATH` | UE5 编辑器可执行文件的绝对路径 | `C:/Program Files/Epic Games/UE_5.4/Engine/Binaries/Win64/UnrealEditor.exe` |
| `UE_PROJECT_PATH` | UE5 项目文件 (.uproject) 的绝对路径 | `C:/Projects/MyProject/MyProject.uproject` |
| `UE_MAP_NAME` | 启动时加载的关卡/地图名称 | `/Game/Maps/MainLevel` |

### 可选变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `UE_RESOLUTION_WIDTH` | `1920` | 渲染输出宽度（像素） |
| `UE_RESOLUTION_HEIGHT` | `1080` | 渲染输出高度（像素） |
| `UE_PIXEL_STREAMING_PORT` | `8888` | Pixel Streaming 信令端口 |
| `UE_EXTRA_ARGS` | — | 附加 UE5 命令行参数，逗号分隔 |
| `UE_STARTUP_TIMEOUT_MS` | `30000` | UE5 启动超时时间（毫秒） |

### 常用 UE_EXTRA_ARGS 示例

| 参数 | 说明 |
|------|------|
| `-Windowed` | 窗口模式运行 |
| `-ForceRes` | 强制使用指定分辨率 |
| `-RenderOffScreen` | 无头渲染（不显示窗口） |
| `-AudioMixer` | 启用音频混合器 |
| `-AllowPixelStreamingCommands` | 允许通过 Pixel Streaming 发送控制命令 |
| `-PixelStreamingURL=ws://localhost:8888` | 指定信令服务器地址 |

---

## 启动与验证

### 启动流程

1. 运行启动脚本，脚本会：
   - 加载 `.env` 中的环境变量
   - 验证必填的 UE5 配置
   - 打印当前配置摘要
   - 启动 Node.js 开发服务器
2. Node.js 服务端启动后，UE 进程管理器会自动拉起 UE5 编辑器。
3. UE5 加载指定关卡并启用 Pixel Streaming。
4. 信令代理开始监听 WebSocket 连接。

### 验证步骤

**1. 检查 UE5 进程状态**

```bash
curl http://localhost:3001/api/ue/health
```

预期返回：

```json
{
  "status": "running",
  "fps": 60,
  "gpuUsage": 45,
  "vramUsage": 2048,
  "connectedClients": 0,
  "uptime": 12345
}
```

**2. 浏览器连接测试**

打开浏览器访问 `http://localhost:3001`，应能看到 UE5 渲染画面通过 WebRTC 推送到页面。

**3. 调试模式**

在浏览器控制台或通过 API 启用调试 HUD，查看 FPS、延迟、分辨率等实时指标。

---

## 常见问题排查

### UE5 进程启动失败

**症状**：健康检查返回 `status: "stopped"` 或 `status: "crashed"`。

**排查步骤**：

1. 确认 `UE_EDITOR_PATH` 指向正确的 `UnrealEditor.exe`。
2. 确认 `UE_PROJECT_PATH` 指向有效的 `.uproject` 文件。
3. 确认 `UE_MAP_NAME` 对应的关卡存在于项目中。
4. 检查 Node.js 控制台输出的 UE5 stderr 日志。
5. 尝试手动启动 UE5 编辑器，确认项目能正常打开。

### Pixel Streaming 连接不上

**症状**：浏览器无法建立 WebRTC 连接。

**排查步骤**：

1. 确认 `UE_PIXEL_STREAMING_PORT` 端口未被占用。
2. 确认 UE5 项目已启用 Pixel Streaming 插件。
3. 检查防火墙是否阻止了 WebSocket 或 UDP 端口。
4. 尝试使用 `127.0.0.1` 而非 `localhost` 访问。

### 画面延迟过高

**症状**：浏览器中画面延迟超过 100ms。

**排查步骤**：

1. 确认使用的是本地回环地址（`127.0.0.1`），而非局域网地址。
2. 降低渲染分辨率：设置 `UE_RESOLUTION_WIDTH=1280`、`UE_RESOLUTION_HEIGHT=720`。
3. 检查 GPU 占用率，确认未超过 90%。
4. 关闭其他占用 GPU 的应用程序。

### 启动超时

**症状**：UE5 进程在超时时间内未进入 `running` 状态。

**排查步骤**：

1. 增大 `UE_STARTUP_TIMEOUT_MS`（例如设为 `60000`）。
2. 首次启动 UE5 项目时需要编译 Shader，耗时较长属于正常现象。
3. 确认磁盘 I/O 未成为瓶颈（SSD 推荐）。

### 进程崩溃后无法重启

**症状**：UE5 崩溃后，重新启动仍然失败。

**排查步骤**：

1. 检查是否有残留的 UE5 进程：`tasklist | findstr UnrealEditor`。
2. 手动终止残留进程：`taskkill /F /IM UnrealEditor.exe`。
3. 检查 UE5 的 Crash Report 日志（通常在项目的 `Saved/Crashes` 目录下）。
4. 重新运行启动脚本。
