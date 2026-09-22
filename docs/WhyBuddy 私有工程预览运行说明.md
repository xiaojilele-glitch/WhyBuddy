# WhyBuddy 私有工程预览运行说明

更新：2026-09-13。适用本次内部工程模式；生产开关仍关闭。完整阶段状态见 [整体重构方案](<WhyBuddy 工程运行与浏览器验证整体重构方案.md#24-2026-09-13-完整产品联调与运行边界修复>)。

工程由现有 Python 控制循环和持久 runtime worker 管理，在私有 E2B 沙盒中启动。沙盒主动通过 WSS 连接独立预览网关；浏览器使用自己的短时授权访问网关，网关通过已登记的隧道转发 HTTP、SSE 和 WebSocket。生成应用自己的前端、路由和状态在 iframe 内运行。

## 实际接入点

| 代码 | 职责 |
|---|---|
| `slide-rule-python/services/project_preview_access.py` | SQL 中保存凭据 hash；一次性票据兑换、角色分离、归属、批准、版本、租约和撤销 |
| `slide-rule-python/routes/project_preview.py` | 所有者读取预览快照、申请票据和撤销；网关独立认证与复查接口 |
| `slide-rule-python/services/project_preview_runtime.py` | 真实 runtime worker 持有租约时安装、登记、探测、轮换和停止 tunnel agent |
| `slide-rule-python/services/e2b_workspace_provider.py` | 将 agent 放在生成工程服务目录之外，通过 stdin 写配置并启动受管 PID |
| `server/project-preview/service.ts` | 独立网关进程；票据兑换后 303 清除 URL，以 HttpOnly Cookie 访问，管理状态端点独立验权 |
| `server/project-preview/relay.ts` | 经过授权的 HTTP/WS 转发、旧连接替换、实时复查、撤销、头和 Cookie 过滤 |
| `server/project-preview/tunnel-stream.ts` | 字节背压、双向 FIN、关闭与错误处理 |
| `client/src/pages/sliderule/project-runtime/` | 共同 React 预览；Studio 与 AppsWorkbench 按工程类型挂载；只读刷新不启动或续租 |

## 配置与启动

先运行 `pnpm run build:project-preview`，生成 `dist/project-preview/gateway.cjs`、`agent.cjs` 和 `ws-LICENSE.txt`。Python 默认读取这个 agent 产物；构建缺失时状态接口仍可读，预览不可用。

Python 环境继续使用已有持久数据库、E2B 和内部工程开关，另加：

```dotenv
SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED=1
WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE=https://{runtimeId}.preview.example.com
WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY=<单独生成的随机值，至少32个可打印非空白字符>
```

每个 runtime 必须占一个完整的主机名前缀。将该预览域名的 DNS/TLS 指向独立网关，保留原始 Host，支持 HTTP Upgrade、长响应和 WSS。主站认证 Cookie 必须限定主站；应用所在来源与主站分离。这里的 example.com 是部署占位，本轮没有配置生产域名。

Vite 开发服务和前端构建也必须收到同一个公开的 `WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE`。配置从对应 mode 的 `.env` 读取，进程环境优先；它只为 CSP 增加 `frame-src https://*.preview.example.com`，其他资源权限保持原值。未配置时只允许本站 iframe；部署后更换预览域名需要重新构建前端。网关 key 不传给前端构建。CSP 的通配符只能限制来源后缀，精确的 runtime、账号和源码版本仍由 Python 与网关校验，因此生产使用专用预览域名。

复制根目录 `.env.preview.example` 为已忽略的 `.env.preview`，填写相同的独立网关 key，以及 Python 的 `/api/sliderule/internal/project-preview` 地址。远端 authority 必须用 HTTPS；同机可使用 `http://127.0.0.1:9700`。然后运行：

```powershell
pnpm run build:project-preview
pnpm run dev:project-preview
```

网关默认监听 3002，TLS 由独立入口终结。它只需要 authority 地址和自己的 key。应用沙盒只收到绑定 runtime、generation、角色及期限的 tunnel token；E2B 管理/流量凭据、LLM key、主库凭据不进入 agent 配置。

`http://{runtimeId}.localhost:3002` 只适合本机传输测试。E2B 无法通过这个本机地址访问开发机网关；真实云预览必须有沙盒可达的 HTTPS/WSS 地址。仅填写本地 `.env` 不会建立这些 DNS、TLS 和路由。

## 正常使用与失效行为

1. 在已批准的工程会话中启动真实 runtime，worker 完成安装、版本健康检查后安装 tunnel agent。
2. Studio 或应用中心读取同一项目状态；点击「打开预览」才申请一次性票据。
3. 票据兑换期限与浏览器访问期限分开：前者默认 60 秒，后者默认从出票起最多 300 秒，并受 runtime 期限约束。兑换不会重置授权时钟；刷新状态不会自动换票。
4. 票据被网关兑换后跳转到干净的 `/`；Cookie 使用 HttpOnly，HTTPS 下附带 Secure、SameSite=None、Partitioned。页面 JavaScript 不能读取授权 Cookie。
5. 项目、运行或版本变化时前端卸载旧 iframe；过期后通过明确点击重新申请。网关每次请求重新鉴权，并周期复查已有长连接，拒绝撤销、旧代次或 authority 不可用的访问。

账号被停用、删除或撤销内部工程资格后，已经发放的浏览器/隧道凭据同样失效，运行 worker 按原清理流程停止远端工程。普通租约心跳造成的授权快照竞争最多完整重读并重验三次；明确拒绝和未知 SQL 写入结果不重试。

预览读取和点击页面不自动延长 runtime 空闲或总预算。现有显式活动接口及 worker 策略负责续租；运行到期后页面可能仍保留已加载 DOM，后续请求被拒，工作台轮询显示实际状态。停止控制回合、停止应用与撤销浏览器访问仍是不同操作。

Vite 仅额外允许服务端推导的该 runtime 预览主机名。运行中模型修改已接到持租约 worker：`project_patch` 返回持久子操作，由原运行者保存不可变 revision、同步文件并检查实际版本。同步前撤销旧授权和隧道，同步后重新登记；工作台撤下旧 iframe，用户明确打开新版本。当前会话跟随服务端 ready 版本，指定历史版本不会自动替换。票据同时携带并检查 project/operation/runtime/revision。

活跃同步支持源码、静态素材和测试文件，依赖与启动配置需要停止后修改并重新启动。文件同步失败保留持久源码，运行显示失败；不能把新版本 HTTP 就绪当成浏览器或业务验收通过。完整恢复与错误合同见重构方案第 23 节。

## 复用来源与许可

固定源码版本均见 [来源索引](<WhyBuddy 工程重构参考源码索引.md>) 和 [快照锁文件](reference-sources.lock.json)。

| 来源 | 本次采用 | 实际复用方式 |
|---|---|---|
| frp `d20a23299600`，`server/control.go` | ControlID、旧控制连接退出后不得清除新记录、工作连接消费边界 | 按行为改写为 TS，再绑定 WhyBuddy SQL generation；未嵌入 Go 服务 |
| chisel `3c00f04ca154`，`client/client_connect.go`、`share/cio/pipe.go` | 主动连出、有限退避、双向独立 FIN | 按行为改写为 `ws` 与 Node stream；未引入 SSH 层 |
| OpenSandbox `60bca638497d`，`components/ingress/pkg/proxy/proxy.go` | 先授权再路由、转发前剥离内部凭据头 | HTTP 与 WS 两侧分别落实；保留 WhyBuddy 权威归属与端口范围 |
| `ws` | WebSocket 协议实现、真实升级和流量传输 | 直接复用仓库已有 npm 依赖；bundle 同目录保留原 MIT LICENSE |
| grok-build | 执行与展示分离、资源所有者、操作恢复及人工授权合同 | 延续已有 Python 主循环与 runtime worker，不增加第二套 Agent 循环 |

前三项是源码合同的改写，没有复制完整项目或声称逐字移植。WhyBuddy 的 SQL 一次性票据、批准校验、跨进程租约、E2B 生命周期及 React 接入由本仓实现。参考源码的测试与许可证说明不能替代本仓实际验收。

## 可复跑验证与尚未覆盖范围

```powershell
pnpm run build:project-preview
pnpm run test:project-preview
pnpm run project:contracts:check
pnpm run test:scripts
pnpm run arch:check
pnpm run smoke:project-preview-tunnel
pnpm run smoke:project-source-sync
pnpm run smoke:project-product
```

预览 tunnel 烟测需要 E2B 配置、本机 Chrome、网络与云运行额度，按轮次将脱敏报告和截图写入 `artifacts/project-preview-tunnel-smoke/`，结束后销毁两个测试沙盒并查询确认。`SLIDERULE_CHROMIUM_PATH` 可指定浏览器路径。其网关/agent/Vite 是实际代码，云 authority 使用测试身份注册表；持久 Python 授权另由真实 SQL 与 HTTP 入口测试覆盖。源码同步烟测使用单 E2B、真实模型工具适配器、SQL worker 和 Vite HTTP/HMR，报告在 `artifacts/project-source-sync/`，同样销毁并查询确认；批准和工具选择是固定夹具，不计为模型自主或浏览器业务验收。

新增的 `smoke:project-product` 使用两个独立 E2B：可信服务实例运行真实 Python app/lifespan、隔离 SQLite 和正式 Node 网关；应用实例由正式 worker 创建并保持私有。Chrome 加载完整 Vite 工作台，账号登录、API、票据和网关回调均走实际服务，不替换响应。账号、已批准计划和源码编辑意图是夹具；初始 runtimeId 仅为匹配临时 E2B TLS 主机名而注入一次，其后沿持久状态运行。测试结束销毁两个实例并查询确认，不复制本地会话库或 `.env`。报告与截图写入 `artifacts/project-product/`；失败记录保留。模型自主选择另由 `smoke:project-model --scenario live-edit` 验证，两组结果不拼成一次自主业务验收。

本次不等于生产预览已部署。独立浏览器检查的接入与范围见下节；真实业务数据库、生产 DNS/TLS 与资源配置仍须验收。应用中心历史版本恢复、复刻、导出和生产发布也各自保留阶段验收。

## 独立浏览器页面检查（P4 首批）

工程已经 ready 后，Studio 与应用中心的共同预览面板提供「检查页面」。它提交 `runtime.verify` 子操作，由原 Python 运行所有者串行处理；检查期间源码补丁排队。另一台独立 E2B 运行可信 Playwright 执行器，通过一次性私有预览票据访问应用，验证前后都核对实际源码和 revision。生成工程不能修改验证脚本或写入 SQL 结果。

首个套件 `react-vite-counter@1` 有七项实际断言：标题可见、初始计数 0、两次点击分别为 1 和 2、刷新按模板重置为 0、没有页面/控制台错误、没有失败的页面资源请求。保存前后两张 PNG、断言和源码版本。这里检查的是固定模板行为；`deliveryEligible` 始终为 false，不解锁业务交付或公开发布。

Python 环境增加：

```dotenv
WHYBUDDY_PROJECT_BROWSER_TEMPLATE=<本团队构建的可信模板ID>
WHYBUDDY_PROJECT_BROWSER_TIMEOUT_SECONDS=120
```

模板需包含 `@playwright/test@1.61.1` 和匹配的 Chromium。仓库的 `server/project-verification/build-template.py` 使用固定 Playwright 官方镜像，只上传明确的 package、lockfile 和 runner 三个文件，不需要本机 Docker。构建是显式云操作；事先在进程环境设置 E2B_API_KEY，然后从仓库根目录运行：

```powershell
& slide-rule-python/.venv/Scripts/python.exe server/project-verification/build-template.py --name whybuddy-browser-pw1611 --timeout-seconds 900 --report artifacts/browser-template-build.json
```

日常检查不会重新构建模板或临时安装浏览器。缺模板/key/执行器文件时如实 blocked，普通状态轮询不会创建沙盒。模板是可复用镜像，每次验证实例都独立创建并清理；Python 镜像已显式包含 runner 文件，管理 key 不进入生成工程或验证 job。

当前检查能力沿用内部工程模式，生产工程入口继续关闭。验证记录保存在独立 SQL 表，PNG 按 hash 独立存储，单张最多 2 MiB、每项目最多 16 MiB；有限配额满后明确拒绝。尚未提供证据清理策略和 UI 图片查看器，图片通过需要当前归属与账号权限的接口读取。worker 未启用或初始化失败时历史检查 API 返回不可用；不假装有后台检查者。

源码、规格或当前批准变化后，原始结果保留，当前投影为 stale。刷新只恢复记录；停止检查只取消该子任务；父运行取消或账号撤权会停止并清理对应资源。验证中断时先回收再记录 blocked，不自动重放可能已执行的点击。正式不可变构建验收实例、业务 API/数据库/RBAC 套件和脱敏 trace/HAR 仍在后续阶段。

可复跑命令：

```powershell
pnpm run test:project-browser
pnpm run smoke:project-browser --browser-template <可信模板ID>
pnpm run smoke:project-verification-postgres --database-url-env WHYBUDDY_PG_VERIFY_SMOKE_URL
```

浏览器产品烟测使用实际 Python、SQL、网关、工作台和独立 E2B，依次检查通过、用正式补丁工具把计数改错、确认失败、修复后再通过；产物写入 `artifacts/project-product/`，结尾按本轮项目/操作标识清理并检查资源。账号、计划及修改意图是夹具，模型自主选择工具另行验证；缺配置时返回 blocked。PostgreSQL 命令只读取显式指定的独立测试库，验证取消和租约竞争下不能提交过期通过结果。
