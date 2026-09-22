# 架构生成与业务主链路修复记录

日期：2026-09-11。

WhyBuddy 源版本：`527cc265b65403fae43ebad09ac2961af3f901a0`。
对照工作区：`../grok-build`，SOURCE_REV 为 `a549186d9d39311f2d3ee4208db62af8c65aa476`。

本次包括两阶段：A 修复会话权限、问卷提交与刷新、架构生成和检查；B 完成通用问卷、完整计划、明确批准后执行的主链路迁移。以下记录实现与验收结果，功能提交及推送状态以当前分支的 Git 历史为准；未部署。

## 阶段 A：权限与架构修复

### 会话权限

当前产品入口 `control-turn-stream` 与保留的 `drive-full-stream`、`drive-full`、`drive-turn`、`drive-marathon`、`execute-capability` 都在执行前按服务端会话判定权限。请求体伪造的 ownerId 不能取代持久化归属；无权和不存在使用同一拒绝语义。

复查进一步发现首次创建的竞争窗口：首个用户已经启动后台流，归属还没落盘，第二个用户用相同 ID 会挂到同一运行。现在创建会话先原子认领，再启动。文件后端沿用单进程文件锁，数据库使用插入式 CAS；抢输时返回胜者，路由再次授权。读写失败、损坏记录和无法读回的竞争结果均拒绝启动。

运行记录绑定创建时的 owner_id。工厂重新读取、控制面开始消费流、旧运行查询、持久化合并和缓存进度比较都检查归属，防止删除后重建同名会话时读取旧事件或合入旧用户数据。普通更新仍使用现有保存和版本保护逻辑。

主要代码：

- `slide-rule-python/routes/sliderule_full.py`
- `slide-rule-python/services/drive_full_factory.py`
- `slide-rule-python/services/rehearsal_control.py`
- `slide-rule-python/services/run_registry.py`
- `slide-rule-python/services/persistence.py`
- `slide-rule-python/services/slide_rule_session.py`

新增回归：`test_drive_routes_ownership.py`、`test_session_claim_ownership.py`、`test_session_claim_persistence.py`。现有夹具中测正常会话更新但遗漏 owner 的快照补齐归属，保留其原来的业务断言。

### 问卷提交和刷新

用户在上一轮尚未释放运行锁时提交，答案会作为结构化回执进入队列；保留 reqId、题目 ID、选择和手写补充，等运行锁释放后发送。回执优先解决当前提问，再处理普通排队消息。取消队列条目同时移除对应答案，重复点击不会重复提交。

刷新恢复完整 questions，多题、多选、预览和其他输入不会退化成第一题的旧选项。同步更新的会话状态引用避免后续普通消息被误当成上一份问卷的答案。

浏览器验收发现的手机阻塞也已修复：工具栏允许换行，发送按钮不再被设计选择器盖住；手机问卷按视口定位并限制高度，长题可滚动，右侧舞台不再截获问卷按钮。

主要代码：`useSlideRuleSession.ts`、`ComposerDock.tsx`、`SlideRule.tsx`。
新增回归：`client/src/pages/sliderule/__tests__/questionnaire-session.test.tsx`。

### 架构生成和检查

| 原审查问题                       | 修复结果                                                     |
| -------------------------------- | ------------------------------------------------------------ |
| Python 一句多模块 import 漏边    | 逐个 alias 建边，计入普通包初始化依赖                        |
| DFS 只取部分环，新增成环边可漏检 | 两侧使用完整 SCC 成环边集合，基线同时检查增加和已消除债务    |
| `.ts` 全按 TSX 解析              | 按扩展名选择解析模式，解析诊断使扫描失败                     |
| Python 17 个模块未归组           | 补齐现有合理归属，所有模块及 services 层级必须唯一完整覆盖   |
| Python 解析失败继续产图          | 严格拒绝语法错误和无效 UTF-8，不输出缺边的部分图             |
| CLI 检查少于测试                 | 共用完整校验入口，包含文档同步、归属、声明、反向约束和硬规则 |
| Python CI 缺 Node 项目依赖       | Python job 安装 Node、pnpm 和锁定的根依赖，支持全仓图检查    |
| Windows 换行造成误报             | 同步比较仅规范化 CRLF/LF，保留其他内容检查                   |
| handoff 名字出现被当成调用       | 检查自身函数体内实际 ast.Call，排除仅返回名称等形态          |
| freeze 正则误改其他键            | 按 baseline 区块内完整键替换，并解析验证其他配置未改变       |

另外将 `client-lib -> client-pages-sliderule` 的既有硬禁令纳入共享 TS 校验，不能靠修改普通债务基线放行。脚本套件中另一个组件使用清单比较的 CRLF 误报也一并规范化。

没有通过 freeze 接受新增循环。对同一源版本重新扫描，TS 仍为 1,926 模块、5,968 依赖边；旧 DFS 样本遗漏的 83 条模块成环边和 23 条组件成环边现在进入既有债务集合。对应迁移证据保存在 `architecture.ts.json` 的 `cyclicEdgeBaselineMigration`。

阶段 A 结束时，Python 为 303 模块、978 依赖边、890 条内部 import 语句，其中 476 条在函数体内。修正扫描后的源版本为 977 边；新增一条是工厂权限检查对既有身份组件的依赖，属于已有允许方向。未豁免模块成环边和组件成环边仍为零。B 阶段删除旧链路后的最终统计见下文。

因此 TS 图中红色虚线更多，表示原来漏报的既有成环边被准确显示，并不表示本轮新增了这些循环，也不表示已完成拆环。

## 生成结果

通过 `pnpm run arch:emit` 重新生成：

- [WhyBuddy 全仓架构图（自动生成）.md](WhyBuddy%20全仓架构图（自动生成）.md)
- [WhyBuddy TS 架构图（自动生成）.md](WhyBuddy%20TS%20架构图（自动生成）.md)
- [SlideRule V6.2 架构图（自动生成）.md](SlideRule%20V6.2%20架构图（自动生成）.md)
- [grok-build 架构图（自动生成）.md](grok-build%20架构图（自动生成）.md)

图来自代码扫描和清单，没有手改依赖线。grok-build 对照仍为 97 crates、348 依赖边、零循环。

这些是静态依赖图及已声明跨语言入口，不是穷尽 HTTP、SSE、动态分发的运行时调用图。业务审查单独追踪了前端提交、Python 控制面、工厂交接、后台流、生成器、持久化及前端消费路径。

## 阶段 A 验证快照

以下是不同范围的执行批次，不应相加当作全仓测试总数。

| 检查                                                 | 结果                                           |
| ---------------------------------------------------- | ---------------------------------------------- |
| 最终权限、会话、持久化、控制面及问卷相关 Python 组合 | 524 passed                                     |
| Python 架构、跨语言入口及扫描器回归                  | 114 passed                                     |
| `pnpm run test:scripts`                              | 52 passed                                      |
| 问卷业务相关前端批次                                 | 142 passed                                     |
| 最终手机布局相关前端批次                             | 67 passed                                      |
| `pnpm run arch:check`                                | 通过                                           |
| Chrome 实际渲染四份生成文档                          | 11 个 Mermaid 块全部通过                       |
| 浏览器问卷恢复、忙时提交                             | 1440x1000、390x844、320x568，共 6 场景通过     |
| 320x568 长问卷滚动、选择、提交                       | 2 场景通过                                     |
| `git diff --check`                                   | 通过                                           |
| 最终独立权限复查                                     | 未发现阻断交付回归；两份认领回归文件 33 passed |

回归验证包含修复前失败或临时撤销保护后失败。覆盖原子认领、数据库插入冲突、运行历史可见性、控制面重新读取、晚到保存、问卷运行锁/答案传输/恢复、手机布局、扫描漏边、SCC、归属、解析失败、CLI 一致性及 freeze。变异在独立进程或临时输入中执行，未保留被撤销的保护。

浏览器使用真实产品 UI，账号、会话与 SSE 响应受控；权限回归使用真实路由、工厂、注册表和持久化，昂贵驱动器替换为有界测试实现。另有真实本地 SQLite CAS 测试。未执行真实远端数据库竞争或付费 LLM 的完整生成验收。

阶段 A 的全仓检查不是全绿：TypeScript 以源版本覆盖 compiler host 做实证对照，当时源版本与修改版均有 23 条诊断，新增 0、消失 0。`pnpm run lint` 在 9 个未修改文件上报格式问题；本轮修改的 CI 文件单独通过格式检查。未扩大范围处理这些既有问题，未触发远端 CI。

## 阶段 B：问卷、计划与批准

正常流程为通用问卷澄清需求、`write_plan` 保存完整计划、空参数 `exit_plan_mode` 请求审批，用户明确批准后才允许生成。审批有三个出口：批准并执行、提交修改意见、退出计划。修改后需要重新批准，退出不启动工厂。问卷取消和跳过只结束访谈，不授予执行权限。

计划正文、版本和审批请求 ID 由服务端保存。进入计划、修改计划、请求审批和批准均先确认持久化成功，再更新共享状态；保存失败不能在内存里留下可执行的批准。客户端 PUT 不能伪造批准，旧范围卡、已有 SPEC 或已有页面也不能充当批准。控制面、强制工具、实际工厂以及保留的旧执行入口都检查授权，工厂启动前再次核对会话归属和批准版本。生成器实际收到的是完整已批准正文。

前端新增 `PlanApprovalPanel.tsx`，显示完整 Markdown 计划。刷新恢复原请求及正文；忙时提交排队；重复点击只发一次；过期回执不批准新计划。审批期间在输入框发送内容会作为修改反馈，包括 `/精修` 等文本，不能绕过审批触发强制执行。提交网络失败后重新读取服务端状态：尚未处理的审批重新打开；服务端已批准但响应丢失时不重复请求。

删除 ScopeCard、专用 AssumptionStrip，以及产品类型、设备、设计系统三个选择器和失去调用者的前端组件。运行中 SPEC 产生需要用户决定的假设时，先保存并结束本次工厂调用，再交回通用问卷；答案按题目 ID 写回，六题不会被普通访谈四题上限截断。旧 `spec_assumption` 事件和假设专用长等待已删除，用户手动暂停仍保留。

主要新增回归为 `test_control_plan_approval.py`、`test_plan_approval_persistence_boundary.py`、`test_plan_storage_atomic.py`、`test_plan_entry_commands.py`、`test_spec_decisions_questionnaire.py`、`questionnaire-session.test.tsx`、`plan-approval-panel.test.tsx`、`plan-approval-stream.test.ts`。旧执行测试显式准备服务端已批准计划，默认会话夹具不自动授权。

真实话题和刷新恢复脚本也迁移到通用问卷与计划审批，并检查实际批准回执和刷新前后内容。修复了相关设计文档检查在 Windows 上的路径及 CRLF 误报。

### 最终架构统计

| 范围       | 模块      | 依赖边 | 检查结果                                                                  |
| ---------- | --------- | ------ | ------------------------------------------------------------------------- |
| Python     | 303       | 976    | 未声明依赖、未豁免成环边、越层依赖均为 0；函数体 import 基线 476 降至 474 |
| TS         | 1,913     | 5,929  | 包级循环为 0；模块成环边 265、组间成环边 68 均为已记录的既有债务          |
| grok-build | 97 crates | 348    | 循环为 0，对照版本未变                                                    |

四份权威架构图已在 B 阶段完成后重新生成。图中依赖来自扫描器，未手工调整线条，也未增加豁免放行本轮变化。

### 最终验证结果

| 检查                           | 结果                                                                  |
| ------------------------------ | --------------------------------------------------------------------- |
| Python 完整测试目录            | 6,702 passed、18 skipped、5 xfailed，零失败，298.89 秒                |
| SlideRule 页面及计划流前端套件 | 1,453 passed、1 个已复现的既有失败                                    |
| 问卷与计划真实 hook 回归       | 21 passed，包含网络失败后恢复及批准成功但响应丢失                     |
| `pnpm run build`               | 通过，Vite 前端及 Node 服务端均完成打包；保留大块体积警告             |
| `pnpm run test:scripts`        | 52 passed                                                             |
| `pnpm run arch:check`          | 通过，Python 与 TS 声明、基线、依赖和生成文档一致                     |
| 四份架构图的 Chrome 渲染       | 11 个 Mermaid 块全部通过                                              |
| 计划审批浏览器验收             | 18 场景通过：三种视口、刷新与流内审批、批准与修改及退出；页面错误为 0 |
| TypeScript 源版本对照          | 原始 HEAD 23 条诊断，当前 18 条；新增 0、消失 5                       |
| 本地服务检查                   | Python 健康、Vite 代理健康、工作台页面均为 200                        |

前端唯一失败是 `SlideRule.unified-surface.test.tsx` 的 `reload restores` 回答展示断言，已在原始 HEAD `527cc265` 的独立工作区复现。全仓 `lint` 仍有前述 9 个未修改文件的格式问题。因此不能把本次结果称为全仓全绿。

最后一轮回归前，修复了记忆测试在 FastAPI app 被前序测试重载后，把登录覆盖装到错误实例的问题；将四条旧假设暂停断言迁移为当前手动暂停、SPEC 返回控制面以及串行和并行页面事件补发的保护。针对性测试先复现失败，再验证通过。关键批准边界、持久化失败、前端回执和事件接线均做过失败或变异验证，未留下变异代码。

浏览器使用实际产品组件与页面，账号、会话及 SSE 接口受控；真实路由、持久化和工厂边界另由 Python 测试覆盖。未执行付费 LLM 的完整生成验收，也未执行真实远端数据库并发验收。迁移后的真实话题及刷新恢复脚本已可用于后续这两条产品路径的验收。

最终测试证据位于 `%TEMP%`：`whybuddy-b-python-verified.log`、`whybuddy-b-client-final.json`、`whybuddy-questionnaire-typecheck.json`、`whybuddy-b-build-final.log`；计划审批截图和报告位于 `whybuddy-plan-browser/`。各批次数字反映不同范围，不应相加作为测试总数。

## 本机查看

最终修改后的 Python 和 Vite 已重新启动，工作台为：

`http://localhost:3000/agent-loop/sliderule`

直接 Python 健康检查、Vite 代理健康检查及工作台页面均返回 200。启动的是 `dev:sliderule` 精简栈，Node 和 Lobster 未由本轮启动。

本次浏览器报告、截图及渲染 PNG/SVG 保存在 `%TEMP%` 下的 `whybuddy-questionnaire-browser`、`whybuddy-questionnaire-browser-long`、`whybuddy-full-architecture-2026-09-11.*` 和 `whybuddy-ts-architecture-2026-09-11.*`。临时浏览器测试 Vite 已停止，工作台服务保留运行。

B 阶段最终本地服务启动日志为 `%TEMP%/whybuddy-b-dev-sliderule.log` 和 `%TEMP%/whybuddy-b-dev-sliderule.err.log`。所有测试命令均已结束，只有工作台开发服务保留运行。
