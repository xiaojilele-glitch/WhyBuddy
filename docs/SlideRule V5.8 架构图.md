%% ⚠ 非权威 / 历史实验室笔记。禁止再打新 ⚑。
%% 权威图只留自动生成的：SlideRule V6.2 / WhyBuddy TS / WhyBuddy 全仓 / grok-build。
%% 面团 AI（原 SlideRule）V5.8 架构图（推演引擎规格 · 继承 V5.7 全图 + ✪ 08-03 升版）
%% ✪ 2026-08-03 升版：V5.7 图（07-31 11:51 · 0d35b28）之后 45 个动到
%%   slide-rule-python/services 或 client/src 的提交。这一轮的性质跟前两轮都不同——
%%   前两轮是"补新结构 + 修描述"，这一轮**图的地基变了**：这套系统从一块谁都能写的
%%   公共黑板，变成了有账号、有归属、有可见性的系统。图上此前**一个身份节点都没有**。
%%   另有一批 V5.7 刚刚修正过的描述，三天里又被推翻了一次——参照板那条链路和配色
%%   那条链路各自被整段重写。逐条可溯到提交：
%% ·
%%   【新结构 1】✪A 身份与权限层 / IDENTITY（全新子图 · 图上此前整层缺失）
%%     这不是"加了个登录框"，是**主轴上多了一道贯穿式的归属线**：
%%     395766b7 邮箱注册登录 + 匿名可读/登录可写/超管三档
%%     d6726e4f 应用访问模型(级别阶梯 + 三档可见性 + Fork 继承私有)
%%     6e1514da 归属落库 + 路由挂访问守卫 · e1d2fbda 存量迁移脚本(默认 dry-run)
%%     cae5cf15 账号接口 + 前端登录态 · f5c6ec62 锁住 TestClient Cookie 复用陷阱
%%     7638dc7f 验证码邮件接真服务商(SMTP 通用 + Resend HTTP)
%%     d9c74807 → a95dcf14 独立登录/注册页(团队插画 + 主标语 + 「暂不登录」出口)
%%     430a78ba **旧 Node/MySQL 账号体系整套下掉**——替代守卫先写好再删，
%%              /api/admin 没有一秒钟是敞着的。图上若还留着那条线，现在是死节点。
%% ·
%%   【新结构 2】✪B 会话落库 / session persistence（RUNTIME 侧 · 图上此前缺失）
%%     94c8ed7e 会话持久化。此前应用中心 23 个应用点开 18 个是空白页——
%%     APPSTORE 存了模型，会话本身没存，点进去没有可恢复的现场。
%%     5598cb52 顺带调优：跳过无效写入 + 去掉回读，一次保存 264ms → 215/88ms
%% ·
%%   【描述已与代码不符，按现实修正——照着一个不存在的结构去理解系统，
%%     比不知道它存在更糟。这一轮有三条，都是 V5.7 刚写完就被推翻的】
%%     ✪1 THEME 整个节点**已经不存在** — 028ac8b0 全站一个颜色（用户裁决）。
%%          V5.7 的 ✧2 刚把它从"8 套预设兜底"修正成"色板由种子色算(MCU 的
%%          HCT/TonalPalette)"，三天后连种子色一起没了：enrich_identity_theme
%%          整段从 v5_capability_executor 移除，_theme_palette 恒返回 BRAND_SEED。
%%          ⚠ 这里省掉的不只是一个函数：那一步原本要**花一次生图（~74s）换一个
%%          色值**，而那张图从不展示给任何人。存量库里的 generatedTheme 读到即忽略，
%%          不需要迁移。菜单白、Header 白，首页那张生图不受色板约束、自由发挥。
%%     ✪2 SHEET 参照板换了第三家端点，且**全系统只生一张** — d81e2ddd。
%%          V5.7 的 ✧1 写的端点是 api.xiaoleai.team；当前是 api.gpt.ge
%%          （逐像素认 size，1280x720 / 720x1280 实测都精确返回）。
%%          ⚠ 端点相关行为那条规矩仍然成立：换一家必须整份重测，别拿旧端点的
%%          结论当常量——这条 V5.7 写过，这次正是它救了场。
%%          数量上从"每个 monitor/dashboard 页各一张、上限 4 张、外加主题一张"
%%          砍到**只有落地页那一张**。开关就是有没有配生图 key，不新增环境变量
%%          （少一个旋钮少一处「文档说关了其实没关干净」的机会）。
%%          那张图同时就是应用中心卡片显示的画面（OverviewPreviewSink）。
%%     ✪3 ✧6「monitor 页放开 page.blocks · 总览不再只有数字」**方向反了** —
%%          119b7e4f + c25601da。首页现在由 freeform 设计**独占**：有
%%          freeformOverview 的总览页，脚手架/固定榜/流全部让位（freeformOwnsPage）。
%%          ⚠ 只在后端关掉是不够的——积木仍写在 page.blocks 里，摆不进设计树就会
%%          掉到设计区**外面**照样渲染，固定组件一个没少、位置更差。渲染端必须同时收口。
%% ·
%%   【主轴形状的变化】✪C blockRef 通道整体删除，换成 rowsRef — c25601da
%%     ⚠ 这是两个不同的解法，别混为一谈：
%%       · blockRef（07-29 上线）：设计模型画不了逐行内容，所以让它**挑一个现成
%%         积木摆进版式**，渲染交给积木自己的真渲染器。代价是首页上永远有几块
%%         不是它设计的东西（实测：一排禁用态按钮、8 格流程网格、右栏直接甩
%%         seed-lending_record-10 这种种子 id）。
%%       · rowsRef（08-03 取代它）：**把逐行能力直接给设计模型**——版式它自由画，
%%         真实行数据由 rowsRef 绑（entityRef / fieldRefs / limit / order，
%%         limit 有上限，防一个 ref 把整张表拉平）。逐行内容展开发生在渲染期。
%%     所以目录里的 freeformEmbeddable 白名单**整个字段删除**（catalog v7 → v8），
%%     schema_legal 的派生常量、Pydantic 校验、prompt 文案、前端渲染四处同步消失。
%% ·
%%   【其余补收】
%%     ✪4 匿名点发送会撞出无关的 500 — 953a2bf3。后端第一句话就说了「请先登录
%%          后再推演」(401)，但驱动层 `if (!res.ok) return null` 把 401 和"服务挂了"
%%          返回同一个 null，调用方按约定**回落本地引擎重跑**，本地引擎去打 legacy
%%          的 /execute-capability，那条路在 python 后端下直接 500 thin_proxy_violation。
%%          ⚠ 纪律：**权限失败不是瞬时故障**——不该重试、不该降级、也不该回落
%%          （本地重跑同样绕不过登录）。401 抛 DriveAuthRequiredError，其余失败
%%          维持 return null 的老约定，降级路径本身是对的，不能顺手一起改掉。
%%     ✪5 五系统生成的输出上限改可配 — 89db59ea。写死 8000 在推理模型下**必然失败**：
%%          思考与正文共享同一个 max_tokens，思考先吃掉几千，剩下的写不完一份五系统
%%          模型，表现为 "empty content from LLM (stream)"，看着像网关抽风。
%%     ✪6 手机档渲染画布改 9:16 — c3a513a8。出图侧早就是 720x1280，渲染侧不是，
%%          两边对不上。横向空间本来就紧，所以是**加宽**(390x844 → 405x720)不是压扁。
%%     ✪7 缩略图 PNG → WebP — f687c2aa。首屏 6.3MB → 0.8MB（5Mbps 冷启动 10s → 1.2s）。
%%          服务端按内容嗅探 Content-Type，不认 WebP 的客户端现场转回 PNG。
%%     ✪8 推演跑起来时整站失联 — e199e447。drive_full 是同步耗时调用写成了
%%          async def，把事件循环整条堵死；改回 def 交给 Starlette 线程池。
%%     ✪9 App Store 切回 Neon 会把单 worker 堵死 — cc483404 三层原因逐层修 ·
%%          02df2020 加 APP_STORE_NEON_HTTP 显式指定走 HTTP 通道。
%%    ✪10 对外口径全面改「面团 AI」 — 4d8a15d8 + a4bdf8cb + d587474d + 6658b6b2 +
%%          4a520225。**内部标识刻意没改**：文件名、模块标识、事件族、API 路径
%%          (/api/sliderule)、环境变量 (SLIDERULE_*)、几百个 spec 目录仍写 sliderule。
%%          判断标准只有一条：**这个字符串会不会出现在用户眼前**。会 → 用 shared/brand.ts
%%          的常量；不会 → 保持原样。对外叫什么和对内叫什么是两件事，混为一谈才是真的乱。
%%    ✪11 话题语料库 — 5d00c1cd 抓 TRAE 大赛 300 帖 · 03583abb 扩到官方 2000 全量
%%          （1993 条入库 Neon + 分析，做正确基线的对照）。这条不在推演链路上，
%%          是给生成质量做评测基线用的，图上不出节点，记在这里备查。
%% ·
%%   【已知未修，图上标出来免得当成没人看见】
%%     · 首页设计版面**溢出画布**：实测设计内容底边落在 1440x810 画布的 1600px 处
%%       （溢出 790px，overflow:hidden 直接裁掉，两张图表的 y 在 876–1076 全被裁）。
%%       119b7e4f 之后降到 207px，但根子是**设计侧没有高度预算**——设计模型不知道
%%       自己在往一个 810px 高的盒子里画。rowsRef 上线后这个数需要重测。
%%     · 首页参照板质量下滑，三因叠加：①内容变少（blockRef 那批视觉描述随通道一起
%%       停了）②07-31 改两段式时，"占位写成看得见的文字·不许用灰条/色块/留空"和
%%       "信息层级必须画满"这两条常量**没进改写系统提示词**，只活在区块级参照图那边
%%       （freeform_block.py:1224）③写提示词的 LLM 换了网关。
%%       ⚠ V5.7 的 ✧4 原话："改写 LLM 漏掉哪一条，那一张图就会复发对应的老 bug。
%%       判断这笔交易划不划算，唯一的办法是出图看。" —— 这就是它预言的那次复发。
%% ✪ 符号: ✪ = 08-03 升版
%% ★ 以下为 V5.7（07-31）图，节点区含 ✪ 标注的修正；V5.7 未修订原文
%%   逐字保留于 docs/SlideRule V5.7 架构图.md（本文件为其修正超集）：
%% ---------------------------------------------------------------------------
%% SlideRule V5.7 架构图（推演引擎规格 · 继承 V5.6 全图 + ✧ 07-31 升版）
%% ✧ 2026-07-31 升版：V5.6 图（07-30 01:12）之后 47 个提交。这一轮的性质跟上一轮
%%   不同——上一轮是"补三处新结构"，这一轮**一多半是修正**：参照板那条链路在
%%   四天里被连续改了十几刀（换端点、改尺寸策略、砍区块、prompt 换形态），图上
%%   的描述已经跟代码对不上；另有两个整块的产品面（应用中心作品墙、部署蓝图）
%%   图上一个节点都没有。逐条可溯到提交：
%% ·
%%   【描述已与代码不符，按现实修正——这类比漏收更要紧，照着一个不存在的结构
%%     去理解系统，比不知道它存在更糟】
%%     ✧1 SHEET 参照板已经不是"三区" — 86ce188 拿掉「样式风格」区(整张画布只画
%%          真实版式) · a40abc0 明说设备档时不再多画一区 · 185c427 换端点并把
%%          尺寸按档位拆开(桌面 1280x720 / 手机 720x1280·各出一张·不再挤一张图)
%%          V5.6 图上"一张图并排画三块:样式画板 + 桌面 16:9 + 手机 9:16"三条全废。
%%          ⚠ 尺寸那条尤其要看清:**是否认 size 参数是端点相关行为**。当前端点
%%          (api.xiaoleai.team)逐像素认;上一家(hello.vangularcode.asia)完全不认、
%%          十个尺寸组合全回 1672x941。所以 V5.6 图上"传1792x1024实收1672x941"
%%          不是普适结论，是上一家的行为，换端点必须整份重测(d410e6d 删过时白名单)。
%%     ✧2 THEME 8 套预设不是"降级为兜底"，是**彻底不参与配色** — 0f32989 色板改由
%%          种子色算(vendor MCU 的 HCT/TonalPalette) · 32df415 预设收尾只剩种子色
%%          +派生 · bb2e9ef 派生色板调轻。_theme_palette 函数体第一行就是
%%          `del theme_id`。实测:8 个合法主题 id 派生出的主色**只有一个值**
%%          (#5b6b7c，即 FALLBACK_SEED)。"兜底"意味着还能被选中，现在选不中。
%%     ✧3 MONITOROV "一页跑三次"现在是**两次或三次** — 6fe1c13 入站判设备档:
%%          preferredDevice 明说 desktop 就不再设计手机档(省约 67s/页)。判不出来
%%          或写 unspecified 仍两档都生成——只在明确的时候才砍。
%% ·
%%   【新结构 1】✧A 应用中心作品墙 / AppsWorkbench（OUT 侧新子图 · 图上此前整块缺失）
%%     2ec7ea9 两端对齐行布局 → bc48d35 react-photo-album masonry → 04c9165 换
%%     masonic + 图下信息区 → 60c3035 跨列 + 无限流 → 34bd238 信息条压回画面上
%%     APPSTORE 入库之后没有下文:那些应用是在**哪个界面**被看见的，图上没有节点。
%% ·
%%   【新结构 2】✧B 部署蓝图 / render.yaml（EXEC 侧 · DEPLOY 之下）
%%     072b659 补齐四个漏配开关(部上去会静默少一半功能) · f106daa UVICORN_HOST
%%     必须 0.0.0.0(健康检查走 IPv4·容器 v6only 时 :: 收不到) · ff131b6 补 Neon
%%     持久化 + E2B 沙盒 + 会话密钥
%% ·
%%   【其余补收】
%%     ✧4 参照板 prompt 改两段式 — 525f603 事实清单(_build_overview_sheet_facts)
%%          + LLM 按这一个系统现写出图提示词。**拿确定性换多样性**:原来那五段
%%          常量每条都有出图证据，但它对每个应用说同一句话(实测两个完全不同业务
%%          的出图提示词逐字相同 87%)。现在改写 LLM 漏掉哪条，那张图就复发对应老 bug。
%%     ✧5 参照板可单独指向另一家服务商 — fada224 SHEET_IMAGE_* 一组独立配置
%%     ✧6 monitor 页放开 page.blocks — ffca300 总览不再只有数字
%%     ✧7 freeform JSON 先机械修复再 reask — dc01b88 深层嵌套树偶发数错括号
%%          (真机复现:{}/[] 各差1、尾巴多个孤立句号，且**不是** token 截断)。
%%          新依赖 json-repair;手搓括号计数容易拼出语法合法但结构错位的树。
%%     ✧8 lineHeight 裸数字撑爆 KPI 卡 — cd02d96 裸数字被当倍数解释
%%     ✧9 档位切换只列真有设计的档 — 7172243 没设计过的不给入口 · dde3f3d 单档时
%%          那个按钮不能收起来(注释原本写反了)
%%    ✧10 卡片墙密度压测台 — a905908 串行驱动(并行两个浏览器抢 CPU·测出来的数
%%          偏高且偏多少不可知) · b825185 分批挂载，附一条被实测推翻的判断
%%    ✧11 演示种子换真随机源 — ecfad98 pure-rand xoroshiro128+ + 语义词表
%% ✧ 符号: ✧ = 07-31 升版
%% ★ 以下为 V5.6（07-30）图，节点区含 ✧ 标注的修正；V5.6 未修订原文
%%   逐字保留于 docs/SlideRule V5.6 架构图.md（本文件为其修正超集）：
%% ---------------------------------------------------------------------------
%% SlideRule V5.6 架构图（推演引擎规格 · 继承 V5.5 全图 + ✱ 07-30 升版）
%% ✱ 2026-07-30 升版：V5.5 图（07-26）之后四天、68 个提交。这一轮的变化不是
%%   细节修补——图上多了**三处此前一个节点都没有的新结构**，另有六处旧节点
%%   的描述已经与代码不符。逐条可溯到提交：
%% ·
%%   【新结构 1】✱A 入站判定闸门 / Intake Triage（新子图 00.1，在推演之前）
%%     c668db5 四态判定+评测台 · b34c6e6 提示条 · bf6deee 输入变了撤旧提示 ·
%%     19f03d8 带应用摘要 · 30e0433 hasApp 用真有应用判定 · cdf704a 拆掉
%%     real→iteration 硬覆盖 · 0f219b6 拒绝档
%%     一轮推演约 20 分钟 + 一次完整 LLM + 最多 9 张生图，此前**任何**输入都
%%     直接进推演（"你好"照样烧）。现在入站先判六态，只提示不阻断。
%%     ⚠ 与图上原有的 INTAKE（06 消息入站单门：load SessionState/derive/prompt
%%     cache）**同名不同物**：TRIAGE 在 INTAKE 之前，判"这一轮该不该跑"；
%%     INTAKE 在 TRIAGE 之后，判"这条消息怎么接进状态机"。
%% ·
%%   【新结构 2】✱B 演示种子数据 / demo-seed（RUNTIME 新增，闭环产出的应用侧）
%%     2c44261 打开就有内容 · ecfad98 换真随机源+语义词表 · 109fcf4 钉最近两天
%%     闭环产出的应用第一次打开时每个实体都是零行，表格/图表/KPI 全线"暂无
%%     数据"。现在按字段类型与语义确定性铺一批示例行。
%% ·
%%   【新结构 3】✱C blockRef 桥（ENRICH ↔ SAFEREND 之间的新连线）
%%     f02406c
%%     此前逐行内容（排行榜/动态流）freeform 画不了（dataRef 取不到逐行记录，
%%     硬画只有表头没有行），只能被赶到设计之外单独渲染成外挂卡，首页长成
%%     "AI 设计区 + 两张外挂卡"。现在设计里可以挂 blockRef：**摆在哪、占多宽
%%     由设计者定，渲染委托给积木自己的真渲染器**。
%% ·
%%   【描述已与代码不符，按现实修正】（措辞修正不是新功能，逐条见节点内 ✱ 标注）
%%     ✱1 体验区块从占位变真渲染 — 4ac6c63 五个区块接真渲染器 · 4b55452 方案C
%%          按页面类型划分 KPI/图表归属(总览页走 page.stats/charts·业务页走
%%          MetricGrid/TrendChart·渲染层双向硬隔离) · 55422ee 绑主实体的
%%          DataTable 摘掉 · 4169c0e/4dd8d01 ActivityFeed 宽行档 variant=row
%%     ✱2 固定组件全部换 Ant Design — 0f32a57 区块换 Card/Empty/Timeline/
%%          List+Progress/Table(颜色走主题 token·不再写死十六进制) ·
%%          1972d36/d3489e2 录入层读写共用一张 valueType 表(借 pro-components
%%          valueType 机制) · e97ced8 渲染锁测试
%%     ✱3 手机档不再套 PC 组件 — 7f69b81/0dda249/8a5c3f6/fb3bab4 antd-mobile
%%          全家桶 · 746981a React 19 兼容(react-dom 不再导出 createRoot) ·
%%          7c117b9/4e8562f 按 pageKind 出骨架(dashboard/monitor/wizard/kanban/
%%          calendar) · bf187cf 中文 locale+NavBar+Calendar · 50974c0 Collapse ·
%%          c1f28af TabBar 行数徽标(走主题色·不是 antd-mobile 默认的红)
%%     ✱4 色板从"写在 prompt 里"变成机械校验 — 49544bf palette_guard：OKLCh 里
%%          判两条(色相落在色板 ±25° 内·主色用量不低于任何其他色系)，近中性色
%%          chroma<0.04 豁免；违规先带偏差重问，重试耗尽机械纠偏(只旋色相保
%%          L/C)后放行——**配色问题绝不抛错**(抛了就回落固定骨架)
%%     ✱5 KPI 卡从一层变三层 — 49544bf 大数字 + 环比 + 卡底迷你走势线(形状对标
%%          pro-components StatisticCard)；dataRef 新增 trendFieldRef/trendGrain，
%%          一个字段驱动两层；不撒谎边界：前期为 0 显"较上期 —"不编 +∞·单桶
%%          不出线·<0.5% 直说持平·口径与主数字同源·主数字算不出则整个不挂
%%     ✱6 首页版式按设备分档 + 三区参照板 — 6d69a67 手机档也渲 AI 设计的总览
%%          (固定骨架让位) · a40236d 两档各设计一版 + 一张三区板喂两档
%%          (freeformOverview={root, mobile?:{root}}，取值规则借 react-grid-layout
%%          的 layouts={{lg,md,sm}}+"本档没有就回退更大一档") · 41d8d67 技术标识
%%          不入画 · 6103b26 板子退回 1672x941 + 密度预算(降分辨率必须同步降
%%          密度·否则每个元素分到的像素不够会糊) · 21a5940 控件长相锚到
%%          antd/antd-mobile(配色明令排除品牌蓝)
%%     ✱7 结构门两处收紧 — c1f28af 实体字段 type 纳入校验(此前非法类型如 file
%%          一路无人查，前端对认不出的类型一律当 text——用户以为能传附件实际
%%          只能打字，不报错不提示测试全绿) · 61e3a74 binding 哨兵词从 "none"
%%          改祈使句(模型把 "none" 当成要填的值，QuickActionPanel 全产出
%%          entityRef:"none"，全新话题 4 条门禁不过) · c22e716 prompt 里的
%%          "with slots" 被读成键名，一轮 6 页排版全丢
%%     ✱8 App Store 存储降级从三级改四级 — 2f7b618 远端 TCP → 远端 SQL over
%%          HTTP → **本地 SQLite** → 本地 JSON。前两级是同一个远端库的两条通道
%%          (受限网络只放行 443 时自动改走 HTTP·数据不分叉)，第三级才是本地库。
%%          此前远端一挂直接掉到最弱的 JSON 兜底(整文件读写·无索引无事务)
%%     ✱9 技能库两层化 + 通道分流 — 7abacb7 128 条逐条判定能否绑成 aigc 能力 ·
%%          d2ebf0c 下架社区层(只留精选/已安装) · b34c6e6 按消费通道分流 ·
%%          ab31b28 再下架 31 条 unbound(装了不产出任何东西的不占精选位)
%%     ✱10 dev-only 巡检设施 — d0e88d8 app-shell-tour.mjs 进仓库(桌面/手机双档
%%          全页巡检·SLIDERULE_CHROMIUM_PATH 逃生口) · f9c31c4 block-gallery
%%          对照台(九个区块连空态一次铺开·可切主题·不进生产产物)
%% ✦ 以下为 V5.5（07-26）图，节点区含 ✱/07-30 标注的修正；V5.5 未修订原文
%%   逐字保留于 docs/SlideRule V5.5 架构图.md（本文件为其修正超集）：
%% ===========================================================================
%% SlideRule V5.5 架构图（推演引擎规格 · 继承 V5.4 全图 + ✦ 07-26 审查修复升版）
%% ✦ 2026-07-26 升版：对 V5.4 图（07-24）做了一轮"图码对照审查 + 九项修复 +
%%   终检对抗复核"（提交 b9a3e26 / 150c694 / aa5cc4f，决策留档 docs/adr/）。
%%   本版两类变化：其一，代码真实长出的新结构；其二，V5.4 图上与代码不符的
%%   表述按现实修正（措辞修正不是新功能，逐条见节点内 07-26 标注）：
%%   ✦1 演示域识别纪律 — 裸子串匹配误伤修复（"sla"命中 translation/island/
%%                        slack 的真实事故）：词边界+复数后缀+强弱词分级，泛词
%%                        单独不认域，认不出 fail-closed 走 LLM 生成；夹具产物
%%                        provenance 标注 builtin-domain（ADR-0002）
%%   ✦2 渲染防崩溃气囊 — AppStageErrorBoundary 兜渲染异常（诚实降级卡+
%%                        resetKeys 自动复位）· freeform 树深度/节点上限双侧
%%                        同值（micromark 纪律：超限截断降级不炸栈）
%%   ✦3 数据诚实收紧   — sum 空数据显「—」（SQL/pandas 语义，不再显 0 冒充
%%                        真值）· "数字必须挂 dataRef"生成侧真实强制（只拦
%%                        数据声明形状，不误伤 近7天/Top5 这类结构性数字）
%%   ✦4 SSOT 收编      — identity_theme_presets.json 新共享源（8 套主题+生成
%%                        主题合格契约，前后端物理同读）· 图标形状正则/legacy
%%                        别名收进 experience_block_catalog.json 双侧派生 ·
%%                        gate 槽位从账本派生 · parity 哨兵双侧锁死（ADR-0003）
%%   ✦5 体验层成本预算 — 参考图/截图自检每次 enrich 限额（env 可调·按尝试
%%                        计费·超限退纯文字有日志）· SLIDERULE_E2B_TEMPLATE
%%                        预烤沙盒模板免现装 playwright
%%   ✦6 演示域夹具预增强 — golden-file 再生成脚本离线跑主题增强、重新过门后
%%                        冻结（四域生成主题各按预设色相锚点差异化），运行时
%%                        仍零 LLM；ENRICH 子图补画 APPSTORE 入库节点（原缺失）
%% ★ 以下为 V5.4（07-24）图，节点区含 ✦/07-26 标注的修正；V5.4 未修订原文
%%   逐字保留于 docs/SlideRule V5.4 架构图.md（本文件为其修正超集）：
%% ---------------------------------------------------------------------------
%% SlideRule V5.4 架构图（推演引擎规格 · 继承 V5.3 全图 + ★ 07-24 体验层升版）
%% ★ 2026-07-24 升版：V5.3 图（07-17）之后一周，结构门下游长出一整层「体验层
%%   生成 / Experience Enrichment」——此前图上从结构门直接跳到 app 主舞台，中间
%%   这层（主题+区块+设备壳）完全缺失。它跑在结构门通过之后、闭环装配之前，
%%   全程 fail-open（任一步失败静默降级，固定骨架/8 预设兜底，绝不拦闭环）：
%%   ★1 体验区块系统   — 476e480 目录骨架 · a0c5b43 WorkflowTimeline · 4abf5bd
%%                        FreeformInsight（experience_block_catalog 安全原语白名单
%%                        四方单一真相源 + block-registry 前端安全渲染器：只
%%                        React.createElement，绝不 dangerouslySetInnerHTML）
%%   ★2 身份主题生成   — 4361569 生图驱动身份主题 token（8 套预设降级为兜底）·
%%                        ad0abd3 图表配色接主题 · f08f2ea 白底侧栏禁用态可见性
%%   ★3 FreeformInsight 内容生成 — 4abf5bd Pydantic 深校验+reask 生产化 · 7fab05e
%%                        视觉参照 · cdf868a 图表候选枚举(Metabase X-Ray) · 3d297cd
%%                        自校验闭环(生成→截图→比参考图→改) · 981752a chart→真
%%                        ECharts · 03d20de dataRef 现算真值(数字不能编) · fd1dd66
%%                        放开图标白名单(任意 Ant Design 图标名·动态解析)
%%   ★4 首页也交 FreeformInsight — c86c238 monitor/首页交给 FreeformInsight 排版
%%                        (不再固定骨架) · 641c325 内容数量随领域浮动(松开上游模板)
%%   ★5 设备壳+视觉刻度 — 手机原生壳 · 92325c8 design-token 间距/圆角/阴影(接 antd
%%                        Design Token) · grid-compact 压实(搬自 react-grid-layout 核心)
%%                        · 7f0eb24 page.layout 5 槽位 · fd86913 designRecipe
%% ▲ 以下为 V5.3（07-17）原文，逐字保留：
%% ---------------------------------------------------------------------------
%% SlideRule V5.3 架构图（推演引擎规格 · 继承 V5.2 全图 + ■ 增量 + ▲ 07-17 升版）
%% 2026-07-16 结构审查：V5.2 图（07-09 落款"零结构变化"）之后两天出现四处
%%   真结构变化 + 三处中型增量，本图升版收录。每个 ■ 都有提交与评测可溯：
%%   ■1 TOOLS 工具层     — P2a/P2b（dd5fc99 web.search · 3eb8423 code.run/E2B）
%%   ■2 证据回流环 ECTX  — E17（064d033）·A/B 签字 docs/evidence-context-ab-2026-07-16.md
%%                         （piped 2胜0负8平，默认开维持）
%%   ■3 轮内并行+屏障    — E17b（同上）·synthesis/report/appbundle 为屏障段
%%   ■4 pick 双通道 APICK — F2（044e440）·终裁 docs/content-quality-eval-2026-07-15.md
%%                         （已被 ▲1 取代：E32 转正默认开）
%%   ■5 结构化生成通道   — P3（8b0e5c6）·校验错误回喂 reask（借 Instructor 语义）
%%   ■6 直播时间线投影   — E13（b9f4500）·turnNarrations 展示投影+同轮守卫豁免
%%   ■7 IM 输出编排      — E16/E16.1（82bca0c/492c161/1fe5a56）·多流分窗+平滑泵
%% ▲ 2026-07-17 升版（E25–E37 两日增量，每条有提交/实测可溯）：
%%   ▲1 APICK 转正默认开 — E32（99acb79）·十话题+内容质量 4:0 胜出后默认 on，
%%                          60s 硬顶 fail-open（off/0/false/no 显式回规则版）
%%   ▲2 run 化断线重生   — E25·推演跑在服务端后台 run·事件日志按序号续播
%%                          （Last-Event-ID 语义）·孤儿 run 看门狗回收
%%   ▲3 缺口修复轮       — E26·mode=repair 只重跑覆盖门标红能力·非 blocked 闭环复用
%%   ▲4 五系统闭环装配层 — 新增 CLOSURE 子图（此前图上整条缺失，是 app 主舞台的数据源）：
%%                          起草(E29 精修/直供) → 确定性修复(不变式+E37 展示层) → 结构门
%%                          → E37 门裁决回喂 → 闭环证据 → app 主舞台；E35 演示域冻结夹具旁路；
%%                          E37 闭环兜底（重建异常也落 blocked 闭环，publishClosure 永不为 null）
%%   ▲5 附件提取管线     — E31·图片→视觉 LLM·PDF→E2B 沙盒提取·失败诚实只带文件名
%%   ▲6 版本史前进/回退  — E29·模型真实变化自动存档 modelVersions·回退=模型直供重闸
%% 符号: ▲ = 07-17 升版 ; ■ = V5.3 新增/修订 ; ◆ = V5.2 外环 ; ● = Ux 修订 ; 虚线 = 跨层或待补
%% 原 V5.2 图保留于 docs/SlideRule V5.2 架构图.md（本文件为其超集）

flowchart TB

subgraph V52_OUTER["V5.2 外环 ◆ (Drive + U* 表面/执行/信任) · 薄层复用内脊柱"]
  direction TB

subgraph DRIVE["00.5 驱动层 / Drive Modes（◆ 外环 · 内层零改动）"]
  direction TB
  MODE{"◆ 模式选择器 / Mode<br/>深思一轮(默认·绕过外环) · 持续推演"}:::gate
  MARATHON["◆ 马拉松编排 / MarathonDriver<br/>drive一轮 → 按stopReason分流<br/>收敛→续 · await_ready→挂起 · 终态→停"]:::core
  FRONTIER["◆ 前沿生成 / frontier.propose<br/>去重机械裁决 · 连续2空=耗尽<br/>提议+rationale进决策账"]:::core
  APOLICY["◆ 自动驾驶策略 / AutopilotPolicy<br/>显式可审计产物 · confirm代答留痕<br/>G_READY真缺口必停·零变通"]:::ledger
  SBUDGET{"◆ 会话级预算 / Session Budget<br/>开启即强制设定 · 轮间对账 · 到顶机械停<br/>与轮内BUDGET两层闸"}:::gate
  DIGEST["◆ 轮次纪要 / round.digest<br/>过G_QUALITY · 下轮种子=纪要+前沿产物<br/>明细→SUPERSEDED(≠stale)"]:::cap
end
 
subgraph SURF["00 交互面 / Surface（◆ U4 用户语言化：出问题才说话）"]
  direction TB
  CHAT["聊天框 = 操纵杆<br/>灌 goal · 提质疑 · 指定关注点<br/>◆ 运行中发送键=停止键"]:::surface
  STATUS["状态条（唯一常驻）<br/>◆ 只说人话：推演中·第N步 / 已想清楚✓<br/>还差N个关键信息 / 已停止·随时继续"]:::surface
  AUDIT["◆ 审计抽屉 / Audit Drawer<br/>gate原文·台账·封条计数·baseline·分账 (M7: policy + ledger + superseded + baseline + cost)<br/>机制信息只搬家不删除"]:::surface
  BOARD["内联临时黑板<br/>讨论 · 图 · 报告段 · 方案 · 预览<br/>● 按轮分组折叠(马拉松, via routeExpanded + superseded)"]:::surface
  IMORCH["■ IM 输出编排 / E16<br/>并行流按label分窗·平滑泵(积压/8匀速)<br/>ChainOfThought时间线·streamdown正文·收口句带真时长"]:::surface
  ATTACH["▲ 附件提取管线 / E31<br/>文本类直读注入 · 图片→视觉LLM识别<br/>PDF→E2B沙盒pypdf(超长LLM蒸馏)<br/>失败诚实：只随消息带文件名"]:::surface
  HINTBAR["✱ 入站提示条 / IntakeHintBar<br/>action=hint 才占视线·引导话术+可点改写按钮(点了回填输入框)<br/>发送键始终可用·提示条自己写明「这只是建议·直接发送仍会照常推演」<br/>输入一变立刻撤下旧提示(requestId 单调递增·慢响应盖不掉新判定)"]:::surface
end
 
subgraph TRIAGE["00.1 入站判定闸门 / Intake Triage（✱ 07-30 新增子图 · 在推演之前 · fail-open · 只提示不阻断）"]
  direction TB
  TJ0["✱ 第0层 确定性预判 / precheck<br/>零成本零延迟·只挡闭眼都知道的(空输入·纯标点·纯问候语·<3有效字)<br/>纪律:宁可漏也不能误伤——真需求落这里被拦就没有第二次机会<br/>阈值曾是4字，评测台抓到它把「你是谁」判成 vague"]:::gate
  TJCAP["✱ 能力面 / _capability_block（判「做不做得了」的参照物）<br/>能表达的那一半**现算自 five_system_legal.json**(字段类型/页面形态/图表类型)<br/>不手抄:账本加一种形态而这里忘了跟，会继续拒绝已经做得到的东西且不报错<br/>做不了的五类(游戏与实时互动/硬件设备/端侧原生/图形内容创作/实时信号与算法)<br/>从250条真实参赛标题聚类·**不在账本里**(账本记合法枚举·不记产品边界)"]:::ledger
  TJRULE["✱ 第1层 规则表 / _RULES（Parlant 式 condition + scope + priority）<br/>每条带适用域·每轮只把相关的拼进 prompt(规则增长时干扰面不扩大)<br/>meta 90 · off_topic 80 · new_unrelated_need 75 · real/iteration 70<br/>· **out_of_scope 60** · vague 40<br/>拒绝档刻意压在 real 之下:TriageSQL 数据说超纲最好判(F1 0.90)、真需求最难<br/>(0.53)——风险在误伤不在漏判；规则正文内写四条硬负样本教它别看关键词"]:::gate
  TJLLM["✱ 第2层 LLM 判定 / judge_turn<br/>六判词:real·iteration·vague·off_topic·meta·**out_of_scope**<br/>vague 与 out_of_scope 分开(照 TriageSQL:「说不清」与「说清了但表达不了」<br/>是两类)——对超纲说「再多说两句」是骗人，补细节也变不出游戏引擎<br/>out_of_scope 的话术三要求:直说做不了·点明做不了的是哪部分·给出周边真<br/>做得了的那个系统(rewrite 填完整说法·点一下改过去)"]:::cap
  TJACT{"✱ 判决→动作 / _resolve_action（唯一决定要不要打扰用户的地方）<br/>real/iteration → proceed · 其余 conf≥0.6 → hint · <0.6 → proceed(判不准别打扰)<br/>**第一版永不返回阻断动作**(blocking 开关留给误判率收敛之后)<br/>拒绝档共用同一个地板:调低会误伤「带技术领域词的真需求」，那是最贵的错误"}:::gate
  TJEVAL["✱ 评测台 / eval_intake_judge（升级阻断的唯一依据）<br/>104 条用例(+40 超纲按五类分组·+10 硬负样本专量误伤)·--workers 并发<br/>三档错误分开算(🔴误拦真需求=事故 · 🟠漏判超纲=交付做不出的东西 · 🟡未提示=浪费)<br/>拒绝档另按 clinc/oos-eval 口径出召回/精确(总准确率会被样本配比稀释)<br/>实测 0/40→40/40 召回·误拦恒 0·×3 稳定 120/120"]:::trust
  TJDEV["✧ 设备档判定 / _DEVICE_RUBRIC（07-31 新增·与入站判定共用同一份判据）<br/>此前 preferredDevice 生成契约**只声明合法域·没给任何判据**·模型无从选择<br/>就一路倒向 desktop(扫过真实数据:9个应用全是 desktop·不是它们真都是桌面应用)<br/>于是「两档都生成设计」实际是在为一个没人做过的判断买单(每页多花约67s)<br/>补了姿态判据之后这个字段才有意义·下游 MONITOROV 据此决定砍不砍手机档"]:::gate
end
 
subgraph CORE["01 控制平面 / Control Plane（V5.1 脊柱 · 零改动）"]
  direction TB
  INTAKE["入站消息 / Message Intake（单门）<br/>load SessionState · derive 先行<br/>STATE 稳定前缀 prompt cache<br/>分类为控制信号（续跑·不重启会话）"]:::core
  BUDGET{"预算闸 / Budget Gate（轮内）<br/>maxTurns · maxRuns/turn · maxTokens · maxRepeat<br/>预算=auditable artifact"}:::gate
  ORCH["推演调度核 / Orchestrator<br/>pickNextCapabilities(goal, state, gaps, votes)<br/>路由便宜模型/规则优先 · 歧义才升级"]:::core
  DLEDGER["调度决策账 / Decision Ledger<br/>saw · chose · skipped+reason · rationale<br/>◆ + 前沿提议(马拉松)"]:::ledger
  CONTRACT["覆盖率合约 / CoverageContract<br/>authored · 版本化 · 冻结基线"]:::ledger
  GCOV{"覆盖率闸 / Coverage Gate<br/>blocking gap 全 resolved/waived<br/>合约能力全有成功 run · 二元机械"}:::gate
  STATE[("常驻推演状态 / Reasoning State（唯一 authority）<br/>graph · artifacts · evidence · risks · decisions<br/>capabilityRuns · gates · dependencyGraph<br/>● + qualityBaseline声明 · ◆ + supersededIds")]:::state
  GOAL["目标 / 结论状态（ORCH 只读 · 写入仅经覆盖率闸）<br/>clear · needs_refinement · not_recommended"]:::core
  AWAIT["待续 / Awaiting（环上歇脚点）<br/>收敛 · 等人 · 超轮内预算<br/>◆ + 用户停止 · 等人补缺(马拉松) · 会话预算顶 · 前沿耗尽"]:::await
  ECTX["■ 证据上下文管道 / evidence_context<br/>信任门准入(只喂过门的)·优先级装箱(priompt语义)<br/>预算截止·省略留痕 · A/B 签字 2胜0负8平"]:::ledger
  PARBATCH["■ 轮内并行批 / batch parallel<br/>独立能力并行执行·屏障分段<br/>synthesis/report/appbundle=屏障(等前段commit)"]:::core
  APICK["▲ agentic pick / LLM提案+门验收<br/>词表封闭·重复守卫·台账source=llm<br/>E32 转正默认开(评测4:0)·60s硬顶fail-open<br/>停机权仍归规则·修复轮不参与"]:::core
end
 
subgraph ROLES["02 角色与协作 / Roles（V5.1 原样）"]
  direction TB
  RL["多角色 / Roles<br/>产品·架构·安全·合规·工程·挑刺·接地·综合·UI"]:::role
  D_GATE{"决策门 / Decision Gate<br/>简单 or 复杂?"}:::gate
  D_SA["单 Agent / Single-Agent"]:::role
  D_BO["头脑风暴 / Brainstorm<br/>讨论·投票·分工·审计"]:::role
  D_SYN["综合器 / Synthesizer<br/>方案·信心分·分歧意见"]:::role
  FLOWB{"流边界守卫 / Flow Boundary<br/>剥离 critique · rebuttal · debate console"}:::gate
  D_DEG["降级兜底 / Degradation → 单 Agent"]:::fallback
  PAIR["调度单元 = (capability, role) 对"]:::role
end
 
subgraph POOL["03 能力池 / Capability Pool（平权 · V5.1 原样 · 执行落 08 层）"]
  direction TB
  BUS{{"能力调度总线 / Dispatch Bus<br/>调用 ⇄ 回灌"}}:::bus
  C_PARSE["意图理解 / intent.parse"]:::cap
  C_EVID["证据检索 / evidence.search"]:::cap
  C_REPO["仓库深度解析 / repo.inspect"]:::cap
  C_REPO_FALL["仓库降级 / Fallback"]:::fallback
  C_GAP["澄清·缺失 / gap.ask"]:::cap
  C_QEXP["扩展·假设 / question.expand"]:::cap
  G_READY{"就绪度闸 / Readiness<br/>需人答=停泊点"}:::gate
  C_RTGEN["路线生成 / route.generate"]:::cap
  C_RTCMP["路线对比 / route.compare"]:::cap
  G_CONFIRM{"轻量确认闸 / Confirm<br/>需人答=停泊点 · ◆ 马拉松下由APOLICY代答留痕"}:::gate
  C_PROMPT["提示词构造 / prompt.build<br/>● 经08层PROMPTS双端同源"]:::cap
  C_REDACT["脱敏 / redaction"]:::cap
  C_LLM["LLM JSON 生成 / callJson<br/>● 实际执行经08层EXECABS"]:::cap
  G_SCHEMA{"Schema 校验闸"}:::gate
  C_SNORM["归一化 / 稳定 ID 重映射"]:::cap
  G_INV{"不变量守卫闸"}:::gate
  C_SFALL["确定性兜底"]:::fallback
  C_TREE["结构拆解 / structure.decompose<br/>● + 旧管线推导回填(K5)"]:::cap
  C_DOC["文档生成 / document.draft"]:::cap
  C_ACC["验收 / acceptance"]:::cap
  C_PREV["效果预演 / scenario.preview"]:::cap
  C_VISGEN["视觉生成"]:::cap
  C_VISREND["视觉渲染 / Mermaid 确定性"]:::cap
  C_TOOL["工具 / mcp.call · skill.invoke"]:::cap
  C_RISK["反驳与风险 / risk.analyze · counter.argue"]:::cap
  C_SYN["综合收敛 / synthesis.merge"]:::cap
  C_REP["报告生成 / report.write"]:::cap
  C_PACK["指令包 / prompt.pack"]:::cap
  C_MATRIX["可追溯矩阵 / traceability"]:::cap
  C_HAND["交付包 / handoff"]:::cap
end
 
subgraph TRUST["04 信任层 / Trust Layer（● U1 修订：commit-time 验真+验厚 · ship-time 验收）"]
  direction TB
  T_GATE{"提交闸 / Commit Gate（commit-time）<br/>schema·invariant·confirm·precondition·ground·commit<br/>● + quality（验厚） · 二元·机械"}:::gate
  QCONTRACT["● 输出契约 / OutputContract<br/>headings·childBlocks·EARS中英·embedded·minChars<br/>单一真相：喂prompt + 喂质量闸"]:::ledger
  BASELINE["● 质量基线 / QualityBaseline<br/>production / pilot-template<br/>结果级声明·禁嗅探·封条注明"]:::ledger
  T_PROV["provenance（commit-time）<br/>● + browser-llm:label:model"]:::trust
  T_AUDIT["出图审计 / check_previews_real"]:::trust
  T_TEST["测试 / Tests（ship-time·验收）"]:::trust
  T_MERGE{"合并门 / Merge Gate（ship-time）"}:::gate
  T_LEDGER["校验台账 / Checks Ledger（问责中枢）<br/>脚本·决策·边界·成本<br/>● + quality verdict+baseline<br/>◆ + 中断行 · policy代答 · 前沿提议 · key分账"]:::ledger
end
 
subgraph EXEC["08 执行层 / Executor Topology（● U2 新增子图）"]
  direction TB
  EXECABS["● 执行器抽象 / CapabilityExecutor<br/>Default模板 · PilotReal · Server-LLM · browser-llm<br/>结果自声明 qualityBaseline"]:::core
  PROMPTS["● 双端同源 prompt / capability-prompts<br/>anchor+CTX供给+契约注入+report 9段BASE<br/>server与browser消费同一函数"]:::ledger
  CTX["● 分级上下文供给 / capability-context<br/>收敛全文6000/24000 · 分析800 · 轻220<br/>截断显式标注"]:::ledger
  KEYPOOL["● key池调度 / ByokDispatcher<br/>租约·least-busy·429冷却·401禁用<br/>raceMode默认false(成本诚实)<br/>◆ 待补:FIFO排队 · per-key计费"]:::core
  DEPLOY{"部署形态 / Deployment<br/>Pages纯浏览器BYOK / 自托管server"}:::gate
  BLUEPRINT["✧ 部署蓝图 / render.yaml（07-31 新增·一键部署的单一真相源）<br/>漏配不会报错·只会**静默少一半功能**:补齐四个开关后才有完整链路<br/>UVICORN_HOST 必须 0.0.0.0——**不能用镜像默认的 ::**。健康检查走 IPv4·<br/>容器 v6only=1 时 :: 收不到 IPv4 连接;当时日志是铁证:端口探测从 ::1 打进来<br/>通了·中间15分钟一条 /health 都没有·最后 Timed Out·而服务其实一直是好的<br/>Neon 持久化 + E2B 沙盒 + 会话密钥随蓝图下发(内部 API 靠共享密钥挡)<br/>服务间走公网地址而不是私网:Render 跨服务是 IPv4·:: 绑定 v6only 时收不到"]:::core
  KEYISO["● key零信任边界<br/>仅localStorage+闭包 · 不进STATE/台账/导出<br/>序列化隔离测试锁定"]:::trust
  SREASK["■ 结构化生成通道 / structured_llm_json<br/>校验错误回喂 reask(借Instructor语义)<br/>强制流式免CF-524 · SLIDERULE_STRUCTURED_LLM"]:::core
end
 

subgraph TOOLS["08.5 工具层 / MCP Tool Registry（■ V5.3 新增 · 信任纪律随身）"]
  direction TB
  MCPREG["■ 工具注册表 / mcp_tools<br/>MCP 对齐描述符 name·inputSchema·readOnly<br/>纪律：执行类必须声明沙盒(测试锁定)"]:::core
  WSEARCH["■ 真证据源 / web.search（只读）<br/>供应商链 Tavily→Serper→Wikipedia免key<br/>查询蒸馏·失败回落本地RAG(retrieval如实标注)"]:::cap
  CODERUN["■ 沙盒执行 / code.run（readOnly=false）<br/>E2B 一次性沙盒·宿主零执行·用完即毁<br/>fail-closed：无 key 工具不可用"]:::cap
end
 
subgraph CLOSURE["09 五系统闭环装配层 / Five-System Closure（▲ 07-17 新增子图 · app 主舞台的数据源）"]
  direction TB
  LEGAL["✱ 五系统合法域账本 / five_system_legal.json（✱07-30补画·此前图上一直缺失）<br/>补画理由:它已经有**四个**派生消费方，是这张图里存在感最强的隐形节点——<br/>合法域此前记在四处(结构门常量·修复器本地拷贝·生成契约手写枚举串·客户端渲染器<br/>手抄版)靠人肉对齐，E37 的根因就是漏账的代价。收成单一真相源后:<br/>结构门 import · 修复器经门 re-export 自动跟随 · 生成契约由 enum_str() 渲染<br/>· 客户端构建期直读同一 JSON(vitest parity 测试锁死)<br/>✱07-30 起第五个消费方:入站判定的能力面(TJCAP)<br/>加枚举=只改 JSON;哪一方没消费到,parity 测试当场红<br/>(思想同阿里低代码引擎《物料协议》:一份物料描述·编辑器/渲染器/校验器共同消费)"]:::ledger
  GEN5["▲ 五系统起草 / v5_llm_generate<br/>schema契约+已装技能硬注入+业界参考软引用<br/>E29 精修上下文(增量改)·模型直供(回退)两通道<br/>✱07-30:prompt 里的哨兵词/占位字面量长得像值就会被当成值——binding=none 让<br/>模型给 QuickActionPanel 全填了 entityRef:「none」(4条门禁不过);「with slots」被读成<br/>键名让一轮 6 页排版全丢。两处都改成祈使句"]:::cap
  DREPAIR["▲ 确定性修复 / v5_model_repair（零LLM·留痕）<br/>不变式refs近邻改写(唯一命中)·修不好整条剔除<br/>E37 展示层charts/stats同款处方(枚举违规剔除·非法format清除)<br/>骨架六系统不修——仍由门硬拦"]:::core
  MGATE{"▲ 结构门 / v5_model_gate<br/>跨系统引用全解析·枚举合法域·页面范式绑定<br/>二元机械·任何悬空=拦<br/>✱07-30补两处漏:①**实体字段 type 纳入校验**——此前 FIELD_TYPES 只在技能<br/>binding 那儿用过·实体字段的 type 一路无人查(所谓「封闭合法域」只是 prompt 里<br/>的一句约定)。代价不是「写错没人说」而是**静默降级**:前端对认不出的类型一律<br/>return text，一个 file 字段会安安静静变成普通文本框——用户以为能传附件实际<br/>只能打字·不报错不提示测试全绿。②沿用该段口径「出现即校验·缺省不罚」"}:::gate
  REASK5["▲ 门裁决回喂 / gate-feedback retry (E37)<br/>findings原文喂回·有界重生成一次<br/>错哪改哪·两版都拦仍fail-closed"]:::fallback
  DOMFIX["▲ 内置演示域夹具 / builtin_domain_models (E35)<br/>采购·请假·工单·入职四域冻结过门模型·运行时零LLM<br/>★07-26:识别改词边界+强弱词分级(泛词单独不认·认不出走LLM生成·ADR-0002)<br/>产物provenance标注builtin-domain·夹具离线预增强生成主题(golden-file再生成)"]:::state
  CLOSEV["▲ 闭环证据 / appbundle.runtimeClosure<br/>六段 perSkillEvidence·closureHash/stableDigest指纹<br/>modelSection纯载荷(不进指纹/信任判定)"]:::ledger
  GREL{"▲ Goal relevance / closure_relevance<br/>直接检查最终六系统 modelSection 的受控显示字段<br/>RBAC派生角色权限·monitor/dashboard派生数据看板<br/>不再只看实体名/页面名"}:::gate
  TERMINAL{"▲ 确定性终止边 / trusted_closure_decision<br/>当前turn+goalDigest模型可复用·closure非blocked·证据6/6 → END<br/>输入变化→继续·repair→仅修复<br/>命中后只跑coverage/delivery机械检查·禁止LLM planning/agentic picker"}:::gate
  FAILSAFE["▲ 闭环兜底 / fail-closed failsafe (E37)<br/>重建异常→确定性blocked闭环(CLOSURE_REBUILD_FAILED带因)<br/>空指令回落goal收口·publishClosure永不为null"]:::fallback
  APPSTAGE["▲ app 主舞台 / App Stage<br/>closed 6/6 → 右栏长出可操作应用<br/>切角色·录数据·走流程·桌面/手机/代码三视图"]:::done
end

subgraph ENRICH["10 体验层生成 / Experience Enrichment（★ 07-24 新增子图 · 过门后·装配前·全程 fail-open）"]
  direction TB
  THEME["✪ 08-03 **本节点已整体移除**（保留在图上是为了让读到 V5.7 的人知道它去哪了）<br/>全站一个颜色(用户裁决)·enrich_identity_theme 整段从 v5_capability_executor 删除<br/>_theme_palette 恒返回 BRAND_SEED·存量库里的 generatedTheme 读到即忽略·不需迁移<br/>⚠ 省掉的不只是一个函数:那一步要**花一次生图(~74s)换一个色值**·而那张图从不展示给任何人<br/>───────── 以下为 V5.7 原文 ─────────<br/>★ 身份主题生成 / enrich_identity_theme<br/>生图参照→视觉LLM取色(条件:生图key+图片parts声明·缺则纯文本取色)<br/>写回 appIdentity.generatedTheme·合格契约两端同源(identity_theme_presets.json)<br/>✧07-31修正:8套预设**不是降级为兜底·是彻底不参与配色**——色板改由种子色<br/>算出来(vendor MCU 的 HCT/TonalPalette)·_theme_palette 函数体第一行 del theme_id<br/>实测:8个合法主题id派生出的主色**只有一个值**(#5b6b7c 即 FALLBACK_SEED)<br/>appIdentity.theme 仍是 Gate 校验的合法分类值·但不再对应任何色板<br/>颜色真正的来源只剩两个:LLM 选的种子色·或 FALLBACK_SEED"]:::cap
  FREEFORM["★ FreeformInsight 内容生成 / enrich_freeform_blocks<br/>Pydantic深校验+reask(07-26:+数字必须挂dataRef·树深度/节点上限)<br/>视觉参照自校验闭环(条件:生图+E2B key+公网地址·缺则纯文字生成)<br/>chart节点→真ECharts·dataRef现算真值(数字不能编·查不到显—)<br/>07-26成本预算:参考图/截图自检每次enrich限额(env可调·超限退纯文字有日志)<br/>✧07-31:JSON 非法时**先机械修复再 reask**(json-repair)——深层嵌套树偶发数错<br/>括号层数(真机复现:{}/[] 各差1·尾巴多个孤立句号·且**不是** token 截断·<br/>那份输出结尾收得完整)·手搓括号计数容易拼出语法合法但结构错位的树<br/>✧07-31:lineHeight 裸数字曾被当倍数解释·撑爆 KPI 卡高度"]:::cap<br/>✪08-03 **rowsRef 取代 blockRef**:逐行能力直接给设计模型——版式它自由画·真实行数据由 rowsRef 绑(entityRef / fieldRefs / limit / order·limit 有上限防止一个 ref 把整表拉平)<br/>展开发生在**渲染期**·不是生成期(生成时树里只有一份"一行长什么样"的模板)<br/>⚠ 与 blockRef 是两个解法不是一个:前者让它**挑现成积木摆进版式**(代价:首页永远有几块不是它设计的·实测出现过禁用态按钮/8 格流程网格/右栏直接甩 seed-lending_record-10 这种种子 id)·后者让它**自己画**
  MONITOROV["★ 首页设计 / enrich_monitor_page_overviews<br/>monitor/首页交给FreeformInsight排版·不再永远固定骨架<br/>内容数量随领域浮动<br/>✱07-30修正:排行/动态流**不再被赶到设计之外当外挂卡**——改由设计者用<br/>blockRef 摆进自己的版式(见✱C桥)·摆哪占多宽它定·渲染仍交积木真渲染器<br/>✱07-30:一页跑参照板→桌面设计→手机设计·每页一张板<br/>✧07-31修正:是**两次或三次**——preferredDevice 明说 desktop 就不再设计手机档<br/>(省约67s/页)·判不出来或 unspecified 仍两档都生成(只在明确的时候才砍)<br/>✧07-31:monitor 页放开 page.blocks·总览不再只有数字<br/>✪08-03**方向反转**:首页由 freeform 设计**独占**——有 freeformOverview 的总览页·<br/>脚手架/固定榜/流全部让位(freeformOwnsPage)·page.blocks 在这类页面不再渲染<br/>⚠ 只在后端关是不够的:摆不进设计树的积木会掉到设计区**外面**照样画·渲染端必须同时收口<br/>✪08-03 生图**全系统只给落地页一张**(开关=有没有配生图 key·不新增环境变量)·<br/>所以这里不再是"一页跑两次或三次"·参照板这一步整个应用只走一次"]:::cap
  MONITORDEFER["★ 08-05关键路径收口<br/>同步只设计landingPageRef（缺失时首个合格总览页）<br/>其他dashboard保留stats/charts标准骨架并标记deferred<br/>已有freeformOverview幂等复用·按需打开时再增强"]:::cap
  VISBUDGET{"★ 视觉准入预算 / SLIDERULE_RUN_BUDGET_SECONDS<br/>默认540s·为10分钟目标预留60s落库/闭环缓冲<br/>阶段启动前按长尾保守值检查剩余时间<br/>不足→deferred_budget+skippedReason=deadline<br/>仅视觉fail-open·业务模型/RBAC/workflow不降级"}:::gate
  BLOCKCAT["★ 体验区块目录 / experience_block_catalog<br/>单一真相源(同一JSON跨语言直读):类型·槽位·binding·标签·样式·图标正则/别名<br/>07-26修正:约束链=Gate浅校验(designBrief)+生成时Pydantic深校验+前端再校验<br/>(Gate不看freeform内容树·有意分工见代码注释)"]:::ledger<br/>✪08-03 **freeformEmbeddable 字段整个删除**(catalog v7 → v8)——那是给 blockRef 挑积木用的白名单·rowsRef 上来之后它存在的唯一理由没了<br/>schema_legal 派生常量 / Pydantic 校验 / prompt 文案 / 前端渲染·四处同步消失(改目录一处的老规矩)
  SAFEREND["★ 前端安全渲染器 / block-registry（纵深防御第二道）<br/>只React.createElement·绝不dangerouslySetInnerHTML/eval<br/>图标按名动态解析任意antd(hasOwnProperty挡原型链)·dataRef现算·白名单再校验<br/>07-26:+渲染预算(深度/节点上限截断降级)·AppStageErrorBoundary兜渲染异常<br/>✱07-30:五个占位区块**接真渲染器**并放开生成(MetricGrid/TrendChart/RankedList/<br/>ActivityFeed/DataTable)·全部换 antd 现成组件(Card/Empty/Timeline/List+Progress/<br/>Table)·颜色走**主题token**不再写死十六进制(此前琥珀色应用里动态流圆点是靛蓝)<br/>表头出中文显示名·枚举列出标签(不再是 lot_code / frozen)<br/>ActivityFeed 宽行档 variant=row+detailFieldRefs(列宽靠 colgroup 对齐)"]:::trust<br/>✪08-03 加 rowsRef 展开:渲染期按 entityRef 取真实行·每行套设计模型给的那份模板(仍然只走 createElement 白名单·安全边界一点没放宽)
  OWNER["✱ KPI/图表归属划分（方案 C · 渲染层双向硬隔离）<br/>总览页(monitor/dashboard)走 page.stats/page.charts·由 ENRICH 重新设计版式<br/>业务页走 MetricGrid/TrendChart 积木<br/>同一个指标不会被画两遍·绑页面主实体的 DataTable 区块直接摘掉<br/>(那一页本来就自带一张带中文列名/彩色状态标签/排序筛选/行内操作的表)<br/>✱KPI 卡三层:大数字 + 环比 + 卡底迷你走势线(对标 pro-components StatisticCard)<br/>dataRef 加 trendFieldRef+trendGrain·一个字段驱动两层(本来就靠同一份时间分桶)<br/>不撒谎边界:前期0→「较上期 —」不编+∞ · 单桶不出线 · &lt;0.5%直说持平<br/>· 回传 series.grain 而非入参(桶太多自动变粗后配「较前一日」就是错文案)<br/>· 主数字算不出(显—)时整个不挂(用图形给不存在的数字背书更糟)"]:::cap
  APPSTORE["★ App Store 入库 / app_store.save_app（07-26补画·此前图上缺失）<br/>过门+增强完的设计模型持久化·fail-open·dedup_key去重·组建库地基<br/>✱07-30修正:降级从三级改**四级**——远端TCP → 远端SQL over HTTP →<br/>**本地SQLite** → 本地JSON。前两级是同一个远端库的两条通道(受限网络只放行<br/>443 时自动改走HTTP·数据不分叉)·第三级才是本地库<br/>此前远端一挂直接掉到最弱的JSON(整文件读写·无索引无事务·崩在写一半留半个文件)<br/>没配远端连接串时也走SQLite——没有远端不代表就该退到最弱那档"]:::ledger<br/>✪08-03 入库时**带上归属**:owner_id 来自推演路由塞进 contextvar 的当前用户·拿不到就落无主(语义见 ✪A OWNERSHIP)·**不能为了拿归属而让闭环失败**
  DEVSHELL["★ 设备壳+视觉刻度 / device shell & design tokens<br/>桌面/手机按preferredDevice切换·平板范式代码保留已下架(ADR-0001)<br/>design-token间距/圆角接antd(阴影档定义未消费)·grid-compact压实(react-grid-layout核心·MIT)<br/>layout 5槽位·designRecipe<br/>✱07-30:手机档整层换 antd-mobile(不再套PC组件)·按pageKind出骨架<br/>(dashboard/monitor/wizard/kanban/calendar)·中文locale·NavBar/Calendar/Collapse<br/>·TabBar行数徽标走主题色(默认红是「未读/紧急」的意思·这里表达的是「本页12行数据」)"]:::core<br/>✪08-03 手机档渲染画布改 **9:16**(405x720)·与出图画布同比——出图侧早就是 720x1280·渲染侧不是<br/>横向空间本来就紧·所以是**加宽**不是压扁(390x844 → 405x720)
  PALGUARD["✱ 色板合规机械校验 / palette_guard（接在 reask 环里）<br/>色板约束原本只写在 prompt 里·真跑下来模型一字不差地干它被警告过的事<br/>(橘色应用主色一次没出现·蓝占六成·还自己发明色板外的绿)<br/>两条规则都在 OKLCh 里判(HSL 色相感知不均匀·转换走 coloraide 不手搓矩阵)<br/>R1 色相落在色板某色相 ±25° 内(只比色相不比ΔE·prompt 允许深浅变体)<br/>R2 主色系用量不低于任何其他单一色相族·近中性色 chroma&lt;0.04 豁免<br/>违规先带具体偏差重问·重试耗尽机械纠偏(**只旋色相保 L/C**·明暗是设计意图)<br/>**只纠 R1·配色问题绝不抛错**(抛了调用方就回落固定骨架·那正是这条链路在治的病)"]:::trust
  SHEET["✧ 首页参照板 / _build_overview_sheet_prompt（设计 LLM 照着它排版）<br/>✧07-31修正:**不再是三区**——「样式风格」区已拿掉(整张画布只画真实版式)·<br/>明说设备档时也不再多画另一档(白画一块后面根本不用·还挤占真正要用那档的画布)<br/>✧07-31修正:两档**各出一张**·尺寸按档位拆开(桌面1280x720/手机720x1280)<br/>⚠ 认不认 size 参数是**端点相关行为**:当前端点(api.xiaoleai.team)逐像素认·<br/>上一家完全不认(十个尺寸组合全回1672x941·形状只由提示词决定)——换端点必须<br/>拿 scripts/overview_sheet_probe.py 整份重测·别拿旧端点测出的白名单当常量<br/>✧07-31:prompt 改**两段式**——事实清单(画布/档位/内容范围/色板/真实字段·<br/>一条做法都不给) + LLM 按这一个系统现写出图提示词(版式/占位写法它定)<br/>拿确定性换多样性:原来那五段常量对每个应用说同一句话(两个完全不同业务的<br/>提示词逐字相同87%)·代价是改写 LLM 漏掉哪条·那张图就复发对应老 bug<br/>降分辨率必须**同步降密度**——不是像素总数不够·是每个元素分到的像素不够<br/>画面里不许出现 JSON/字段id/blockRef 等技术标识(brief 是照抄进 prompt 的)<br/>⚠ 图上的数字与条目数是**占位假象**:实测参照板画了9个快捷操作·而模型里<br/>actions 只有2条;画了6步流程·而 workflow 只有5个节点。它是版式参照不是数据源<br/>✪08-03 端点换第三家:api.gpt.ge(逐像素认 size·1280x720 / 720x1280 实测精确返回)<br/>⚠「换端点必须整份重测」这条 V5.7 写过·这次正是它救了场——别拿旧端点的结论当常量<br/>✪08-03 blockRef 那批**视觉描述随通道一起停了**:参照板不该承诺真实渲染兑现不了的东西·<br/>代价是画面内容从 9 块降到 5 块(3 KPI + 2 图表)·实测明显变稀<br/>⚠ 07-31 改两段式时·「占位写成看得见的文字·不许用灰条/色块/留空」和「信息层级必须画满」<br/>两条常量**没进改写系统提示词**·只活在区块级参照图那边(freeform_block.py:1224)——<br/>V5.7 ✧4 预言的"改写 LLM 漏掉哪条就复发哪个老 bug"已经兑现(实测灰条复发)"]:::cap
  OVDEV["✱ 首页版式按设备分档 / freeformOverview = &#123;root, mobile?:&#123;root&#125;&#125;<br/>此前只有 PC 首页是 AI 规划的·手机首页仍是固定骨架把组件堆在最上方<br/>现在两档**各设计一版**(不是把桌面版式用 CSS 挤窄)·手机档固定骨架自动让位<br/>取值规则借 react-grid-layout 的 layouts=&#123;&#123;lg,md,sm&#125;&#125; +「本档没有就回退更大一档」<br/>实测:桌面出两排三列横排·手机一个三列横排都没有·通篇单列<br/>✧07-31:档位切换器**只列真有设计的档**·没设计过的不给入口(点进去是空的<br/>比没有入口更糟)·单档时那个按钮不能收起来(原注释写反了)"]:::cap
end

subgraph REENTRY["05 失效与重入 / Invalidation & Re-entry（单一回炉 · ◆ +superseded）"]
  direction TB
  INTERV["控制信号 / UserIntervention<br/>challenge·revise·clarify·expand…<br/>target: Artifact/Node/Section/Decision"]:::reentry
  RV{"评审 / Review<br/>● RV pass 绑定 reportId"}:::gate
  ESC["失败·中止·转人工 / Escalate"]:::fallback
  ITER["用户修改再推演 / Iterate"]:::reentry
  DEP["依赖图 / Dependency Graph"]:::reentry
  INVAL["失效引擎 / Invalidation"]:::reentry
  STALE["失效索引 / Stale Index<br/>信任失效·级联重算"]:::reentry
  SUPERSEDED["◆ 替代索引 / Superseded Index<br/>被纪要替代·信任不变·不级联<br/>语义独立于stale"]:::reentry
  RECOMP["重算 + 重新调度 / Recompute"]:::reentry
end
 
subgraph RUNTIME["06 运行时 / Runtime（P3 红利 · ● 投影层成果）"]
  direction TB
  JOB["任务仓·产物 / Job·Artifact Store"]:::runtime
  EVT["事件总线 / Event Bus"]:::runtime
  SOCK["实时推送 / Socket Relay"]:::runtime
  STORE["实时状态仓 / Realtime Store"]:::runtime
  DERIVE["状态派生 / 投影计算器<br/>只读 STATE/JOB · 永不回写"]:::runtime
  DENSITY["● 详略密度 / 简洁·完整溯源<br/>阶段子节点可溯源·证据子节点"]:::runtime
  TERMINAL["● 终端交付投影 / Terminal+TrustSeal<br/>虚拟节点·不入STATE.graph"]:::runtime
  ROW["节点行 / Node Row"]:::runtime
  REPLAY["回放 / Replay"]:::runtime
  NARR["■ 直播时间线投影 / turnNarrations<br/>轮末随PUT持久化·3轮×300步封顶<br/>展示投影：同轮守卫豁免清单成员"]:::runtime
  RUNREG["▲ 后台 run 注册表 / run_registry (E25)<br/>推演与连接解耦·无人观看也跑完落库<br/>事件日志按 seq 续播(Last-Event-ID)<br/>同会话活跃 run 附着防重复·孤儿看门狗回收<br/>慢阶段SSE携带pageId/device/current/total/elapsedMs<br/>活动阶段每15s progress_heartbeat·no-store·禁代理缓冲"]:::runtime
  SEED["✱ 演示种子数据 / demo-seed（闭环产出的应用打开就有内容）<br/>此前每个实体零行·表格图表KPI全线「暂无数据」·空壳<br/>随机源 pure-rand xoroshiro128+ / uniformInt 拒绝采样(避免取模偏置)·FNV-1a<br/>同一个模型每次打开看到的示例完全一致(确定性·不是每次刷新变一批)<br/>取值按**字段语义**走词表:人名/机构/编号/产地各有出法·认不出才退「字段名+序号」<br/>钉最近两天(否则 KPI 环比四成机会全是「—」·走势线也画不出)"]:::runtime
  SEEDB["✱ 种子数据的三条边界（不许跟真实数据混淆）<br/>①每个实体只在**首次遇见**时铺一次(后续删空也不会自己长回来)<br/>②每行都带标记·界面上始终挂「示例数据 N」徽标<br/>③用户写入第一条真实数据时·该表种子**整批清掉**<br/>行数硬夹 0..500(曾因调用方把时间戳当 count 传，Array.from 1.78e12 直接 OOM)"]:::trust
end
 
subgraph IDENTITY["11 身份与权限 / Identity & Access（✪ 08-03 新增子图 · 贯穿式 · fail-closed）"]
  direction TB
  ACCOUNT["✪ 账号 / identity_store（邮箱 + 验证码 + 密码）<br/>注册要过邮箱验证码·**一个邮箱同一时刻只保留一个有效码**(put_code 主键是 email·<br/>重发天然作废旧码)——并发注册同一邮箱时后来者会顶掉先来者的码，这是对的<br/>JWT HS256·密钥 SLIDERULE_AUTH_SECRET·Cookie sliderule_token(HttpOnly·SameSite=lax)<br/>✪ Node 侧**不本地验签**：superuser/is_active 不在 token 里·改成调 /account/me 求证<br/>(server/auth/sliderule-identity.ts)·三态返回 anonymous/authenticated/unavailable"]:::trust
  TIERS{"✪ 三档权限阶梯 / access tiers<br/>匿名 = 只能看(浏览应用中心无需登录)<br/>登录 = 能推演·能复刻·能改自己的<br/>超管 = 能管所有人(/account/admin/users)<br/>⚠ 401 与 503 语义必须分开:前者是权限(fail-closed·绝不降级)·<br/>后者是服务(可降级)——混同就是 ✪4 那个 500 的来源"}:::gate
  OWNERSHIP["✪ 应用归属与可见性 / app_access<br/>owner_id 落 generated_app·谁推演出来的归谁·拿不到就落**无主**<br/>无主的存量应用:谁都可读·除超管外谁都不可写(不能为了拿归属让闭环失败)<br/>三档可见性 private / link / public·Fork **继承私有**(复刻别人的东西默认不公开)<br/>✪ 后端三档已通·前端还没有切换入口(已知缺口·见文末待办)"]:::ledger
  MIGRATE["✪ 存量迁移 / migration script（默认 dry-run）<br/>归属与可见性是后加的字段·库里已有的记录必须有个说法<br/>默认只打印不写·要写得显式加参数——这类脚本的默认值本身就是一道闸"]:::ledger
  MAILER["✪ 验证码投递 / mailer（SMTP 通用 + Resend HTTP 两条路）<br/>EMAIL_DELIVERY_MODE=console 时只打印(本地/CI 不发真信)<br/>⚠ 发信地址用**根域名**·不是 send. 子域(踩过一次·见 docs/env 两条提交)"]:::cap
  AUTHPAGE["✪ 独立登录/注册页 / MianTuanAuthPage<br/>左侧团队插画 + 主标语·右侧表单带字段标签<br/>**留了「暂不登录」出口**——浏览本来就不需要账号·把门槛立在真正需要的那一步"]:::surface
  LEGACYOUT["✪ 旧 Node/MySQL 账号体系已整套下掉 / 430a78ba<br/>⚠ 拆除顺序是重点:**替代守卫先写好再删**·/api/admin 没有一秒钟是敞着的<br/>死代码留着比删掉更危险——它会误导读代码的人·也可能哪天被误接回去"]:::fallback
end

subgraph OUT["07 输出 / Output"]
  direction TB
  APPWALL["✧ 应用中心作品墙 / AppsWorkbench（07-31 新增·此前图上整块缺失）<br/>APPSTORE 入库之后没有下文:那些应用在**哪个界面**被看见·图上一个节点都没有<br/>版式是瀑布流(masonic)·但**跨列定位器是自建的**:masonic 的 useMasonry 把每格<br/>宽度写死成全局列宽·跨列卡表达不出来;它的 useResizeObserver 又靠模块私有的<br/>elementsCache 映射 element→index·那个模块不在包的导出列表里<br/>落位规则照搬 Pinterest gestalt 的 multiColumnLayout(pinterest.com 线上同款)<br/>⚠ 择列目标**故意偏离 gestalt**:他们只按窗口空白最小择·照搬会退化——跨列卡<br/>把两列设成完全相等·「最平窗口」从此永远是这一对·实测10张全堆 left=0<br/>改成先比落位后的 top·并列再比空白(真实高度分布上每档都不劣·密集档墙高矮20%)<br/>为什么非要跨列:卡片高度=列宽/设备宽高比·三档里桌面占89%·不跨列整面墙<br/>高度是**同一个数**(实测12张里11张恰好都是234px)·换任何瀑布流库都一样<br/>跨列资格来自真实信息不是随机:只有桌面档(横向内容)·按页面数降序取前1/4"]:::runtime<br/>✪08-03 墙上能看到什么现在**受归属与可见性约束**(见 ✪A)：匿名只读·无主存量应用谁都不可写·复刻默认私有<br/>✪08-03 缩略图 PNG → WebP·首屏 6.3MB → 0.8MB(5Mbps 冷启动 10s → 1.2s)·服务端按内容嗅探 Content-Type·不认 WebP 的客户端现场转回 PNG
  REPORT["可行性 / 推演报告（主输出物）<br/>9段·证据可点·● 厚度有契约下限"]:::report
  READER["● 报告阅读器 / ReportReader<br/>分段·证据回跳·md导出(STATE零写)"]:::report
  DONE["交付完成 / Shipped"]:::done
end
 
%% ===== ◆ 驱动外环（仅持续推演模式生效）=====
%% 薄外环复用说明 (应用审查 Issue 4): MARATHON/FRONTIER/DIGEST 是薄编排 (reuses driveReasoningSession + append-only to ledgers/STATE/supersededArtifactIds)
%% CORE/INTAKE/ORCH/BUDGET/GCOV 等内层 V5.1 脊柱零改动；外环仅通过 stopReason 分流 + 追加 ledger/STATE 字段
%% 见 marathon-driver + useSlideRuleSession 条件调用 + post-drive digest/propose
CHAT -.选模式.-> MODE
MODE -.深思一轮·直通.-> INTAKE
MODE -.持续推演.-> MARATHON
MARATHON -.驱动一轮.-> INTAKE
AWAIT -.收敛·一轮完成.-> MARATHON
MARATHON -.蒸馏.-> DIGEST
DIGEST -.明细标替代.-> SUPERSEDED
DIGEST -.纪要=下轮种子.-> FRONTIER
FRONTIER -.新前沿·合成种子(auto-seeded标注).-> MARATHON
FRONTIER -.提议落账.-> DLEDGER
MARATHON -.轮间对账.-> SBUDGET
SBUDGET -.到顶·机械停.-> AWAIT
APOLICY -.confirm代答·留痕.-> G_CONFIRM
APOLICY -.代答记录.-> T_LEDGER
G_READY -.真缺口·马拉松挂起等人.-> AWAIT
 
%% ===== 入站：单门再入（V5.1 原样）=====
CHAT -.新消息 / ◆停止信号.-> INTAKE
BOARD -.针对节点/段落.-> INTAKE
STATE -.先 load + derive.-> INTAKE
INTAKE --> INTERV
INTERV -.若 challenge/revise.-> DEP
ORCH -.刷新.-> STATUS
ORCH -.只读.-> GOAL
STATE -.渲染.-> BOARD
ROW -.驱动黑板.-> BOARD
STATUS -.较真入口.-> AUDIT
T_LEDGER -.机制原文·只搬不删.-> AUDIT
 
%% ===== 预算闸 + 覆盖率闸（V5.1 原样）=====
INTERV -->|续跑·先过预算| BUDGET
BUDGET -->|放行| ORCH
BUDGET -.超限·停泊 partial.-> AWAIT
BUDGET -.转人工.-> ESC
BUDGET -.成本遥测.-> T_LEDGER
ORCH -.落账.-> DLEDGER
DLEDGER -.汇入.-> T_LEDGER
CONTRACT -.判据.-> GCOV
ORCH -->|想写结论/停泊| GCOV
GCOV -->|达标·准许写入| GOAL
GCOV -->|达标·准许停泊| AWAIT
GCOV -.缺能力·强制排程.-> BUDGET
CONTRACT -.够了就停.-> BUDGET
STATE --- AWAIT
AWAIT -.新消息续.-> INTAKE
 
%% ===== 控制平面 ⇄ 能力池（V5.1 原样，节选）=====
ORCH <-->|调用/回灌| BUS
BUS --- C_PARSE
BUS --- C_EVID
BUS --- C_GAP
BUS --- C_RTGEN
BUS --- C_PROMPT
BUS --- C_DOC
BUS --- C_RISK
BUS --- C_SYN
BUS --- C_REP
BUS --- C_PACK
 
%% ===== 角色 + 流边界（V5.1 原样）=====
RL --> D_GATE
D_GATE -.简单.-> D_SA
D_GATE -.复杂.-> D_BO
D_BO --> D_SYN
D_GATE -.失败超时.-> D_DEG
D_DEG -.兜底.-> D_SA
ORCH -.选 capability×role.-> PAIR
D_SA -.视角.-> PAIR
D_SYN --> FLOWB
FLOWB -.净化后视角.-> PAIR
FLOWB -.断言进台账.-> T_LEDGER
D_BO -.回灌·经守卫.-> FLOWB
PAIR -.接入.-> BUS
 
%% ===== 池内链（V5.1 原样，节选）=====
C_EVID --- C_REPO
C_REPO -.降级.-> C_REPO_FALL
C_GAP --> C_QEXP
C_QEXP --> G_READY
G_READY -.未就绪·回补.-> C_GAP
G_READY -.等用户·停泊.-> AWAIT
C_RTGEN --> C_RTCMP
C_RTCMP --> G_CONFIRM
G_CONFIRM -.退回调整.-> C_RTCMP
G_CONFIRM -.等用户确认·停泊.-> AWAIT
C_PROMPT --> C_REDACT
C_REDACT --> C_LLM
C_LLM --> G_SCHEMA
G_SCHEMA -.过.-> C_SNORM
G_SCHEMA -.败.-> C_SFALL
C_SNORM --> G_INV
G_INV -.过.-> C_TREE
G_INV -.败.-> C_SFALL
C_SFALL --> C_TREE
C_TREE --> C_DOC
C_DOC --> C_ACC
C_TREE -.确定性渲染.-> C_VISREND
C_DOC -.生图提示词.-> C_VISGEN
C_ACC --> C_PACK
C_TREE -.汇总.-> C_MATRIX
 
%% ===== ● U2 执行层接线 =====
C_LLM -.执行委托.-> EXECABS
PROMPTS -.同一prompt.-> EXECABS
CTX -.分级供给.-> PROMPTS
QCONTRACT -.契约注入.-> PROMPTS
EXECABS -.browser端取租约.-> KEYPOOL
DEPLOY -.Pages.-> KEYPOOL
DEPLOY -.自托管.-> EXECABS
KEYPOOL -.◆ 分账 (aggregate costLedger + 待补 per-key).-> T_LEDGER
KEYISO -.边界锁.-> KEYPOOL
EXECABS -.结果+baseline声明.-> BUS
%% 失败回退 (应用审查 Issue 3): browser-llm / KEYPOOL 异常 (CORS/429/401/timeout) → 触发内层降级到 PilotReal / Default (代码已实现 try/catch + onStep fail)
KEYPOOL -.失败回退 (browser-llm 异常 → PilotReal).-> EXECABS
 
%% ===== ● U1 信任层接线（修订）=====
BUS ==>|产物送审| T_GATE
QCONTRACT -.验厚判据.-> T_GATE
BASELINE -.显式基线.-> T_GATE
T_GATE ==>|过| T_PROV
T_PROV ==> T_LEDGER
T_GATE -.未过·打回(quality同路).-> BUS
C_VISGEN -.出图必审.-> T_AUDIT
T_AUDIT -.进台账.-> T_LEDGER
T_AUDIT -.假图打回.-> C_VISGEN
C_HAND --> T_TEST
T_TEST --> T_MERGE
T_MERGE -->|过| DONE
T_MERGE -.不过·回炉.-> INTERV
 
%% ===== 失效重入（V5.1 原样 + superseded）=====
RV -.回炉·归一控制信号.-> INTERV
ITER --> INTERV
DEP --> INVAL
INVAL --> STALE
STALE --> RECOMP
RECOMP -.重排程·经预算.-> BUDGET
DIGEST -.写入.-> SUPERSEDED
 
%% ===== 运行时投影（P3 红利）=====
STATE --> JOB
JOB --> EVT
EVT --> SOCK
SOCK --> STORE
STATE -.只读.-> DERIVE
DERIVE --> ROW
DERIVE --> DENSITY
DERIVE --> TERMINAL
DENSITY -.投影.-> BOARD
TERMINAL -.投影.-> BOARD
STORE --> REPLAY
 

%% ===== ■ V5.3 接线 =====
%% 工具层：证据能力真搜索优先，失败诚实回落；产物 provenance 全走信任层
MCPREG --- WSEARCH
MCPREG --- CODERUN
C_EVID -.■ 真搜索优先.-> WSEARCH
WSEARCH -.■ 全链失败/停用·回落本地RAG(标注keyword).-> C_EVID
WSEARCH -.■ retrieval=web:* 标注.-> T_PROV
CODERUN -.■ provenance=sandbox:e2b.-> T_PROV
C_TOOL -.■ 经注册表调用.-> MCPREG
%% 证据回流环（架构级新边）：STATE 产物受控回流进能力 prompt
STATE -.■ 已过门产物(gated_pass/audited·非stale).-> ECTX
ECTX -.■ UPSTREAM_EVIDENCE 注入.-> PROMPTS
%% 轮内并行 + 屏障
ORCH -.■ 选中批.-> PARBATCH
PARBATCH <-.■ 并行执行·屏障段串行.-> BUS
%% pick 双通道（实验位）
ORCH -.■ SLIDERULE_AGENTIC_PICK=on.-> APICK
APICK -.■ 提案·词表验收后替换.-> DLEDGER
%% 结构化生成通道
C_LLM -.■ 生成失败·错误回喂.-> SREASK
SREASK -.■ 修复后回.-> G_SCHEMA
%% 直播时间线投影 + IM 编排
STATE --> NARR
NARR -.■ 刷新完整回放.-> BOARD
SOCK -.■ llm_delta 按label分流.-> IMORCH
IMORCH -.■ 渲染.-> BOARD

%% ===== ▲ 07-17 升版接线 =====
%% run 化断线重生（E25）：驱动跑在后台 run，连接只是订阅者
INTAKE -.▲ 驱动进后台run.-> RUNREG
RUNREG -.▲ 断连续播·seq起点.-> SOCK
%% 缺口修复轮（E26）：修什么以覆盖门说了算，agentic pick 不参与
AWAIT -.▲ 补齐缺口按钮·mode=repair.-> INTAKE
GCOV -.▲ 标红能力=修复轮选材.-> ORCH
%% 附件提取（E31）：上传即解析，发送时注入推演指令
CHAT -.▲ 上传附件.-> ATTACH
ATTACH -.▲ PDF走一次性沙盒.-> CODERUN
ATTACH -.▲ 提取文本注入指令.-> INTAKE
%% 五系统闭环装配：首次生成后先走确定性终止边；只有输入变化或 repair 才重入。
AWAIT -.▲ 循环落定·闭环重建必跑.-> GEN5
ECTX -.▲ 同一上下文纪律.-> GEN5
GEN5 --> DREPAIR
DREPAIR --> MGATE
MGATE -.▲ 拦截·裁决喂回.-> REASK5
REASK5 -.▲ 重生成.-> GEN5
MGATE ==>|▲ 过门| CLOSEV
DOMFIX -.▲ 确定性域旁路(零LLM).-> CLOSEV
GEN5 -.▲ 形状层回喂(缺段).-> SREASK
CLOSEV -.▲ 证据+指纹入账.-> T_LEDGER
CLOSEV --> GREL
GREL --> TERMINAL
TERMINAL ==>|▲ 当前模型可复用·非blocked·6/6 → END| APPSTAGE
TERMINAL -.▲ 输入变化才回规划.-> ORCH
CLOSEV -.▲ blocked·人话blocker+补齐缺口.-> AWAIT
FAILSAFE -.▲ 重建异常兜底.-> CLOSEV
%% 版本史（E29）：模型变化自动存档，回退=直供重闸
CLOSEV -.▲ 模型变化存档modelVersions.-> STATE
STATE -.▲ ◀▶回退·模型直供.-> GEN5

%% ===== ★ 07-24 体验层升版接线 =====
%% 过门后·装配前：结构门通过的模型先过三段增强（主题→区块→首页），再进闭环装配。
%% 全程 fail-open：每段各自 try/except，任一步失败静默降级（固定骨架/8 预设兜底），绝不拦闭环。
MGATE -.★ 过门后·先增强再装配.-> THEME
THEME ==>|★ 主题先行·区块读generatedTheme| FREEFORM
FREEFORM ==>|★ 再逐块逐页设计| MONITOROV
VISBUDGET --> MONITOROV
MONITOROV --> MONITORDEFER
MONITOROV -.★ 增强完的模型入闭环装配.-> CLOSEV
MONITOROV -.★ 07-26补画:过门+增强模型入库(fail-open·存不进不拦发布).-> APPSTORE
THEME -.★ 任一步失败·静默降级(固定骨架/8预设·不拦闭环)·fail-open保险丝在executor调用方.-> CLOSEV
%% 体验区块目录=四方单一真相源：既约束生成，又驱动渲染（改一处四方同步）
BLOCKCAT -.★ 安全原语约束生成.-> FREEFORM
BLOCKCAT -.★ 同源白名单驱动渲染.-> SAFEREND
%% 增强用到的下游能力：生图参照（视觉生成）+ 候选真渲染截图自校验（E2B 一次性沙盒）
THEME -.★ 生图参照.-> C_VISGEN
FREEFORM -.★ 生图参照.-> C_VISGEN
FREEFORM -.★ 候选真渲染截图·比参考图.-> CODERUN
%% app 主舞台消费增强产物：安全渲染器把区块/首页/主题装进设备壳后接管右栏
SAFEREND -.★ 运行时安全渲染区块/首页.-> APPSTAGE
DEVSHELL -.★ 设备壳套壳+刻度对齐.-> APPSTAGE
 
%% ===== ✱ 07-30 升版接线 =====
%% ✱A 入站判定闸门：在**所有**推演之前。注意跟 INTAKE 的分工——
%%    TRIAGE 判"这一轮该不该跑"（贵：20分钟+一次完整LLM+最多9张生图）；
%%    INTAKE 判"这条消息怎么接进状态机"。TRIAGE 不通过也照样能进 INTAKE，
%%    因为第一版**只提示不阻断**：判决只驱动提示条，发送键始终可用。
CHAT -.✱ 停打字500ms后判一次(不抢跑·太短的不判).-> TJ0
TJ0 -.✱ 没命中·交给LLM层.-> TJRULE
TJ0 ==>|✱ 命中·零成本直出判定| TJACT
TJCAP -.✱ 能力面进 prompt(判「做不做得了」的参照物).-> TJLLM
TJRULE -.✱ 按会话状态挑规则·只拼相关的.-> TJLLM
TJLLM --> TJACT
TJACT -.✱ hint·出提示条+改写按钮.-> HINTBAR
TJACT ==>|✱ proceed·什么都不显示| CHAT
HINTBAR -.✱ 点改写·回填输入框(重判后多半变 real·提示条自己消失).-> CHAT
CHAT -.✱ 用户仍可直接发送(闸门不拦).-> INTAKE
TJLLM -.✱ 判定本身出任何问题一律放行(fail-open·闸门坏了不能变成产品坏了).-> INTAKE
%% 能力面的"能表达那一半"跟结构门读同一本账 —— 这是防漂移的关键
LEGAL -.✱ 同一账本派生能力面(第五个消费方·不手抄).-> TJCAP
LEGAL -.✱ 结构门/修复器/生成契约/客户端四方同源(parity 锁死).-> MGATE
LEGAL -.✱ 枚举段由 enum_str() 渲染进契约.-> GEN5
%% 评测台是升级成硬拦的唯一依据（误拦真需求必须为 0）
TJACT -.✱ 判决样本.-> TJEVAL
TJEVAL -.✱ 误拦为0才考虑开 blocking 开关.-> TJACT

%% ✱B 演示种子数据：闭环产出的应用侧，跟推演链路无关（纯前端运行时）
APPSTAGE -.✱ 首次遇见该实体·铺一批示例行.-> SEED
SEED -.✱ 三条边界约束它不跟真实数据混淆.-> SEEDB
SEEDB -.✱ 用户写入第一条真实数据·该表种子整批清掉.-> APPSTAGE
SEED -.✱ 表格/图表/KPI 有数可算(否则全线「暂无数据」).-> SAFEREND

%% ✱C blockRef 桥：freeform 设计 ↔ 区块注册表
%%    此前逐行内容画不了就被赶到设计之外当外挂卡，首页=AI设计区+两张外挂卡，
%%    主次和留白都由不得设计者。现在设计里挂 blockRef：位置和宽度归设计者，
%%    渲染归积木自己的真渲染器（ExperienceBlockBoundary）。
FREEFORM -.✱C 版式里挂 blockRef(binding 照抄·摆哪占多宽由它定).-> SAFEREND
BLOCKCAT -.✱C 可嵌积木清单进 prompt.-> FREEFORM
OWNER -.✱ 按页面类型分归属·渲染层双向硬隔离(同一指标不画两遍).-> SAFEREND

%% ✱4 色板机械校验接在 reask 环里，不是新起一段
FREEFORM -.✱ 候选色板送检.-> PALGUARD
PALGUARD -.✱ 违规·带具体偏差重问.-> FREEFORM
PALGUARD ==>|✱ 重试耗尽·机械纠偏后放行（绝不抛错）| MONITOROV
THEME -.✱ 色板判据来自身份主题.-> PALGUARD

%% ✱6 首页两档设计：先出一张参照板定调，两档照同一张图设计
MONITOROV -.✱ 每页先出一张三区参照板.-> SHEET
SHEET -.✱ 生图.-> C_VISGEN
SHEET ==>|✱ 同一张板喂两档（保证同色同调）| OVDEV
OVDEV -.✱ 桌面档 root + 手机档 mobile·root 一起写回.-> MONITOROV
OVDEV -.✱ 手机档有自己的版式·固定骨架让位.-> DEVSHELL


%% ===== ✪ 08-03 身份与权限（贯穿式：入口一道、写操作一道、看见什么一道）=====
AUTHPAGE ==> ACCOUNT
ACCOUNT ==> TIERS
MAILER -.验证码.-> ACCOUNT
LEGACYOUT -.被 ACCOUNT 整套取代.-> ACCOUNT
%% 入口闸：匿名可以看，但推演/复刻这类写操作必须先过 TIERS
CHAT -.✪ 发送前过权限闸.-> TIERS
TIERS -."✪ 401 = 权限失败·fail-closed<br/>不重试·不降级·不回落本地引擎<br/>(本地重跑同样绕不过登录)·把后端那句人话原样带回".-> BOARD
%% 归属：闭环落库时把 owner_id 一起写进去
TIERS ==> OWNERSHIP
OWNERSHIP ==> APPSTORE
MIGRATE -.给存量记录补归属/可见性.-> OWNERSHIP
%% 看见什么：墙上的可见范围由归属和可见性决定
OWNERSHIP ==> APPWALL

%% ===== 输出 =====
C_REP ==> REPORT
REPORT --> READER
READER -.证据回跳.-> BOARD
C_HAND ==> DONE

end
%% 结束 V52_OUTER (V5.2 外环容器：DRIVE + SURF + EXEC/TRUST U* 部分)

%% ===== 改进后的图例 (应用审查 Issue 1 + 6) =====
%% V5.2 外环 (◆) 容器包裹了 DRIVE/Marathon + SURF(U4) + EXEC(U2 browser-llm/KEYPOOL) + TRUST(U1 quality) 部分
%% 内层 CORE/POOL/REENTRY/RUNTIME/OUT 为 V5.1 脊柱 (零改动)
%% 符号: ✪ = 08-03 升版 ; ✧ = 07-31 升版 ; ✱ = 07-30 升版 ; ✦ = 07-26 审查修复升版 ; ★ = 07-24 体验层升版 ; ▲ = 07-17 升版 ; ■ = V5.3 新增/修订 ; ◆ = V5.2 新增/外环 ; ● = Ux 修订 ; 虚线 = 跨层或待补
%% ✱ 07-30 产品主轴的变化（三处新结构改了主轴的形状，不只是加节点）：
%%   ① 主轴**多了一个前置闸门**：SURF 一句话 → TRIAGE 入站判定（六态·能力面来自
%%      合法域账本）→ 只提示不阻断 → 才进 CORE。此前任何输入都直接烧 20 分钟。
%%      ⚠ TRIAGE ≠ INTAKE：前者判「这一轮该不该跑」，后者判「这条消息怎么接进
%%      状态机」，两者同名不同物，读图时别合并。
%%   ② ENRICH 的首页那一段**从一次变三次**：参照板 → 桌面设计 → 手机设计。
%%      两档版式出自同一张三区参照板（同色同调），freeformOverview 带 mobile 分支。
%%      逐行内容不再被赶出设计当外挂卡——改由设计者用 blockRef 摆进自己的版式。
%%   ③ APPSTAGE 之后**多了一层种子数据**：闭环产出的应用打开即有内容可看，
%%      三条边界保证它不跟真实数据混淆（首次一次·带标记·真数据一到整批清）。
%%      这一层纯前端运行时，跟推演链路无关，是「拿到的东西能不能看」那一环。
%%   另有一条一直缺的节点这次补上：LEGAL（five_system_legal.json）——它已经有
%%   五个派生消费方（结构门/修复器/生成契约/客户端渲染器/入站能力面），是这张
%%   图里存在感最强的隐形节点，此前只在 ✦4「SSOT 收编」的文字里提过，没有节点。
%% ★ 升版后的产品主轴（07-26 修正：主轴有一条演示域旁路，不是所有路径都过体验层）：
%%   新颖意图：SURF 一句话/附件 → CORE 推演循环(APICK 默认开·ECTX 装箱)
%%   → CLOSURE 五系统起草→确定性修复→结构门→回喂
%%   → ENRICH 体验层生成(过门后·装配前·fail-open：身份主题→FreeformInsight区块→首页设计→App Store入库)
%%   → CLOSURE 闭环装配(证据 6/6) → APPSTAGE 应用接管右栏(安全渲染器×设备壳)
%%   演示域意图(采购/请假/工单/入职·词边界+强弱词识别·ADR-0002)：走 DOMFIX 冻结夹具旁路，
%%   零 LLM 直达闭环——运行时跳过 ENRICH 整层与 App Store 入库；夹具的生成主题由离线
%%   再生成脚本(scripts/enrich_builtin_domain_models.py)预增强后冻结进 JSON（golden-file 套路）。
%%   两条纪律并存：闭环装配 fail-closed(任一环失败→blocked 闭环+人话 blocker，publishClosure 永不为 null)；
%%   体验层增强 fail-open(任一步失败→固定骨架/8 预设兜底，绝不拦闭环发布；
%%   保险丝实现在 v5_capability_executor 调用方的 try/except，不是 ENRICH 节点自身属性)
%% 建议: Mermaid 渲染时使用 "View as code" 或折叠外容器以减少交叉边 spaghetti；或拆分为 "核心脊柱" + "V5.2 delta" 两个图

%% ✪ 08-03 产品主轴的变化（这一轮改的是地基，不只是加节点）：
%%   ① 主轴**多了一条贯穿式的归属线**，它不在某一层里，而是横穿三处：
%%      入口（写操作前过权限闸）→ 落库（闭环时写 owner_id）→ 展示（墙上看得见什么）。
%%      读图时别把 IDENTITY 当成"又一个子图"，它是一条线不是一个块。
%%   ② ENRICH 的首页那一段**从三次回到一次**：V5.7 时代是 参照板 → 桌面设计 → 手机设计，
%%      每个 monitor/dashboard 页各一张板、上限 4 张、外加主题图一张。现在整个应用
%%      只生**落地页那一张**，主题那张随 THEME 节点一起消失。
%%   ③ 首页从"AI 设计区 + 几块固定积木"变成**AI 独占**：blockRef 通道删除，
%%      逐行能力由 rowsRef 直接给设计模型。渲染端 freeformOwnsPage 同步收口。
%% ✪ 08-03 已知缺口（写在图上，免得当成没人看见）：
%%   · 可见性三档后端已通，**前端没有切换入口**——用户改不了自己应用的可见性。
%%   · 无主的存量应用没有"认领"流程（migration 只补了字段，没有把它们交还给人）。
%%   · 首页设计版面溢出画布：790px → 119b7e4f 后 207px，根子是设计侧没有高度预算，
%%     rowsRef 上线后需重测。
%%   · 首页参照板质量下滑（三因，见文件头 ✪ 已知未修）。
%%   · 线上跑的仍是 08-03 09:35 之前的版本，本轮改动尚未部署。
%% ▲ 08-05 收敛与性能修正（真实餐饮巡检轮 18m14s 后落地）：
%%   ① 可信 runtimeClosure 命中当前 turn+goalDigest 后走 TERMINAL 确定性 END；不再让
%%      planning/agentic picker 决定是否重复同一闭环。输入变化或明确 repair 才重入。
%%   ② goal relevance 直接读最终六系统 modelSection；runtimePhase=done 的必要条件包含
%%      publishClosure.blocked=false，blocked 闭环只能 awaiting/repair，两个状态不再打架。
%%   ③ 同步视觉只做落地页；额外 dashboard 标记 deferred，退出主交付链路。540 秒视觉
%%      准入预算不足时保留标准骨架并 fail-open，业务模型、RBAC、workflow 不降级。
%%   ④ SSE 慢阶段带 pageId/device/current/total/elapsedMs，并每 15 秒发活动阶段心跳。

classDef surface fill:#dbeafe,stroke:#3b82f6,color:#1e3a5f
classDef core fill:#e0e7ff,stroke:#6366f1,color:#312e81
classDef cap fill:#ede9fe,stroke:#8b5cf6,color:#4c1d95
classDef gate fill:#fef3c7,stroke:#f59e0b,color:#78350f
classDef trust fill:#cffafe,stroke:#06b6d4,color:#164e63
classDef ledger fill:#ccfbf1,stroke:#14b8a6,color:#134e4a
classDef reentry fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
classDef fallback fill:#ffedd5,stroke:#f97316,color:#7c2d12
classDef report fill:#dcfce7,stroke:#22c55e,color:#14532d
classDef done fill:#bbf7d0,stroke:#16a34a,color:#14532d
classDef state fill:#f1f5f9,stroke:#64748b,color:#0f172a
classDef role fill:#fae8ff,stroke:#d946ef,color:#701a75
classDef bus fill:#fef9c3,stroke:#eab308,color:#713f12
classDef await fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e,stroke-dasharray: 5 5
classDef runtime fill:#f5f5f4,stroke:#78716c,color:#292524
