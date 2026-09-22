"""第 3 步：SPEC 的每一页 → HTML（直出，不经图）。

## 这一步在链路里的位置

    1 澄清+缺口+证据    ✅ 现成能力
    2 起草 SPEC         ✅ services/spec_tree.py
    3 **本文件**：spec 的每一页 → HTML
    4 HTML → 实体/字段/关联/页面结构
    5 (第4步产物 + SPEC) → 权限/工作流/不变式
    6 汇合 → 五系统模型 → 结构闸 → 设计

## 为什么不经图（2026-08-13 定）

原方案在这里插了两跳：按页写出图提示词 → 并发生图 → 图转 HTML。
实测把它砍了。**这个结论出现过两次，第一次不算数**，差别写在
docs/SlideRule V6.0 架构图.md 的 ⚑3：第一次 V 路的出图提示词是让一个 LLM
改写出来的（本仓记录过那种改写会掉东西），分辨率也只有 1536x1024，图转 HTML
更是随手写的一句，判据还是我自己造的数——那是拿一条被削弱的路去比。

第二次把 V 路修到它最好的状态（spec 确定性模板填空、2560x1440、图转 HTML 抄
screenshot-to-code 原版且带 detail:high），判据换成**渲染出来用眼睛看**
（渲染器本身也修过一轮，见 experiments/visual-first/render_pages.cjs）。
同条件下无图仍然更好，用户裁决：「很明显，是无图的生成的效果好」。

省下的是每轮约 120s 出图 + N 倍的图钱。

## 为什么这里**不**打 data-* 接线孔

08-12 写过一份 HTML 载体（backup/2026-08-12-before-revert 的
services/overview_html.py），带 data-fact / data-field / data-chart / data-rows
四种洞，运行时按 schema 填。那份是**下游版**：它的 `build_overview_facts(page,
datamodel)` 和 `_validate_rows` 都要拿 datamodel 去校验洞指向的实体字段存不存在。

第 3 步在上游，**datamodel 还不存在**——它要到第 4 步才从这份 HTML 反推出来。
这里写 `data-field="resident.name"` 是在引用一个还没被发明的 id，校验不了，
而校验不了的绑定就是下一个 DANGLING（这个形状仓里踩过：旧模板库那些指向
组件夹具的绑定，丢进真实话题必被结构闸拦下）。

所以分工是：**第 3 步只出版式，洞留到第 6 步模型出来之后再打。**

## 口径抄 screenshot-to-code 的 create/text.py，不自己另发明

抄的是 `Generate UI for {…}` + 栈 + design_system 块 + 三条 Instructions。
今天的教训正是「自己随手写一套」会让整轮对照失去意义——那条纪律写在
experiments/visual-first/runner.py:220：用成熟工具跑，被测的那条路才是在它
最好的状态下被测。这里同理：这一步现在是主链路，更不该用手写版。
"""

from __future__ import annotations

import os
import re
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

SPEC_PAGE_HTML_VERSION = "spec-page-html-v1"

#: 技术栈约束。逐字抄 screenshot-to-code backend/prompts/system_prompt.py 的
#: Tailwind 段 + create/text.py 的 build_selected_stack_policy。
#: ⚠ Tailwind 走 CDN，**渲染这份 HTML 的一方必须自己解决拿不到 CDN 的情况**
#:   （见 render_pages.cjs 那段：容器里 Chromium 出不了网，不本地喂就是零 CSS，
#:   而零 CSS 的页面看起来像"模型画坏了"——今天差点拿那批废图下结论）。
_STACK = (
    "Selected stack: html_tailwind.\n"
    "Use this script to include Tailwind: "
    '<script src="https://cdn.tailwindcss.com"></script>\n'
    "Return ONLY the full HTML file content. No explanation, no markdown fences."
)

#: ## 设计系统劈成两半：**契约写死，风格可注入**（2026-08-15 晚）
#:
#: 上游 screenshot-to-code 的 `build_design_system_prompt_block(design_system: str|None)`
#: 本来就是个**槽位**——传什么注什么，不传整块消失
#: （scratchpad/oss/screenshot-to-code/backend/prompts/design_system.py）。
#: 本仓此前把一个常量焊进了这个槽位，等于把人家留的注入点堵上了。
#:
#: 劈的依据不是"重要不重要"，是**下游代码依不依赖它**：
#:
#:   契约（_STRUCTURAL_CONTRACT）——写死，永远在，LLM 碰不到
#:     <aside>/<header>/<main>   page_shell 抠壳、导航锚定、内容区让位全靠它
#:     面包屑 APG + aria-current  set_breadcrumb_current 与 .breadcrumb 判据认它
#:     Tailwind / 中文占位        validate_page_html 硬判
#:     不许出现生成方身份与外链   scan_foreign_references 硬判
#:     脚本不会执行              宿主 DOMPurify 摘 script，这是**事实**不是审美
#:
#:   风格（design_system 参数）——每个应用可以不一样，缺省给一句话
#:     版式原型、密度档位、组件词汇、配色基调、图表用几个
#:
#: ⚠ 为什么必须这么劈：让 LLM 写整块设计系统，它一句"用卡片流布局"就能把
#:   <aside> 写没——而外壳统一、导航锚定、面包屑跟页会**静默失效**（今天刚踩过
#:   两次：面包屑四页一样、侧栏压穿内容，两次都是判据全绿）。劈开之后 LLM
#:   压根没机会碰契约，也就不需要"生成完再校验有没有破坏契约"那一整套判据。
#:
#: ⚠ 2026-08-15 晚做过一次密度对照实验（同话题同模型，只改这一处）：
#:   字符 +53%、面板 +34%、右侧栏 0/3→3/3 页、图表 0/3→3/3 页。
#:   有效，但那些**全是风格**，不该焊死在代码里——所以搬到槽位里去。
_STRUCTURAL_CONTRACT = """左侧一个 <aside> 固定主导航，顶部一个 <header>（含面包屑），正文放在 <main> 里。

面包屑照 W3C ARIA APG 的写法（当前页那一节必须带 aria-current="page"）：

    <nav aria-label="Breadcrumb"><ol>
      <li><a href="#">模块名</a></li>
      <li><a href="#" aria-current="page">当前页名</a></li>
    </ol></nav>

html 与 body 必须 width:100%; height:100%。<aside>、<header>、<main> 铺满 1920×1080 视口。
侧栏有菜单文字时必须用 w-64（约 16rem，对照 shadcn Sidebar 展开态），
不要写成图标轨 w-16；品牌行（图标+产品名）用 flex items-center 垂直对齐。
Header 右侧的分段控件跟顶栏同色系（浅底深字），不要 bg-zinc-950 / bg-black。
不要用 max-w-5xl / max-w-6xl / max-w-7xl / mx-auto 把整页收成屏幕正中一张卡片，
不要给 body 写 items-center justify-center 或大 padding 把后台漂在浅色底中间。

页面里的 <script> **不会被执行**（渲染方会移除）。所以不要引图表库、不要写 JS
渲染——图表一律用内联 <svg> 的 <polyline>/<rect>/<path>/<circle> 直接画出来。

这一页的首屏是 brief 里「用途」处于**未打开浮层**的状态。
列表 / 台账页的首屏是表格或卡片，只要一个「新增」按钮；不要把新增表单、
编辑表单、Slide-over、对话框画进首屏——script 不跑，画出来的抽屉关不掉。
新建和编辑由宿主提供表单，页面里不要再画一份打不开也关不掉的表单。
不要从 Tailwind UI / Headless UI 文档抄打开态快照。

若必须预留浮层 DOM，根节点若是 ``fixed inset-0``（或 ``inset-y-0`` 侧滑面板、
它的 backdrop 兄弟），必须带 ``hidden``。不要把「点开后的样子」画成这一页的首屏。

占位数据必须写成**可读的中文文字**，
不许用灰色横条或色块代替：日期写 20XX-XX-XX，金额写 ¥ ××,×××，百分比写 ××.×%，
计数写 ×,×××，人名写「张师傅」这类。表格要有真实的中文列名。

这是**客户自己的产品**。页脚、logo、版权行、关于页里不许出现你（生成方）的名字、
品牌、域名或联系方式；除了上面指定的 Tailwind CDN、placehold.co，以及
库存图床（images.unsplash.com / images.pexels.com / upload.wikimedia.org /
staticflickr.com / rawpixel.com），不要写任何外部网址。配图用
https://placehold.co，每张 <img> 的 alt 写成这张照片的英文检索词（画面上是什么，
例如 ev charging station；不要写用户分层）。不许自己编 unsplash / pexels
photo id。产品名要从客户的业务里起，不要用你自己的名字
（不要写成面团 / 面团AI / SlideRule）。"""

#: 平板契约。2026-08-30 夜：授予已接通，编译仍是 `phone else desktop`，
#: 巡店点单五页全是 aside + w-64，舞台 1920×1080。跟 08-20 手机
#: 「壳换了、IA 没换」同构，这次是「戳对了、契约没换」。
#:
#: 壳仍用 <aside>+<header>+<main>，好让 page_shell 桌面抠壳继续工作——
#: 不要另起底栏（那是手机）。数字抄两处成熟口径，不自己发明：
#:   视口 1112×834 —— 账本 viewportCss / iPad Air 横屏 CSS 像素
#:   侧栏 w-52     —— ant-design Layout.Sider 默认 200px（ProLayout 208）
#:   触控 ≥ 44px   —— Apple HIG，跟手机契约同一条
_STRUCTURAL_CONTRACT_TABLET = """左侧一个较窄的 <aside> 主导航，顶部一个 <header>（含面包屑），正文放在 <main> 里。
这是平板横屏现场作业，不是 1920 宽的 PC 中台，也不是竖屏手机 App。

面包屑照 W3C ARIA APG 的写法（当前页那一节必须带 aria-current="page"）：

    <nav aria-label="Breadcrumb"><ol>
      <li><a href="#">模块名</a></li>
      <li><a href="#" aria-current="page">当前页名</a></li>
    </ol></nav>

html 与 body 必须 width:100%; height:100%。<aside>、<header>、<main> 铺满 1112×834 视口。
侧栏用 w-52（约 13rem，对照 ant-design Layout.Sider 默认 200px / ProLayout siderWidth 208），
不要写成桌面展开态的宽侧栏（16rem），也不要收成图标轨 w-16。
品牌行（图标+产品名）用 flex items-center 垂直对齐。
Header 右侧的分段控件跟顶栏同色系（浅底深字），不要 bg-zinc-950 / bg-black。
不要用 max-w-5xl / max-w-6xl / max-w-7xl / mx-auto 把整页收成屏幕正中一张卡片，
不要给 body 写 items-center justify-center。

正文是**主任务 + 可选旁路详情**：左列表/看板，右详情或动作，两栏即可。
表格不超过 5 列，其余字段放进详情，不要 8 列宽表铺满。
触控目标 ≥ 44px（Apple HIG）。不要手机那种底部 <nav> 标签栏。
**不要**按桌面中台的宽度排。

页面里的 <script> **不会被执行**（渲染方会移除）。所以不要引图表库、不要写 JS
渲染——图表一律用内联 <svg> 的 <polyline>/<rect>/<path>/<circle> 直接画出来。

这一页的首屏是 brief 里「用途」处于**未打开浮层**的状态。
列表 / 台账页的首屏是表格或卡片，只要一个「新增」按钮；不要把新增表单、
编辑表单、Slide-over、对话框画进首屏——script 不跑，画出来的抽屉关不掉。
新建和编辑由宿主提供表单，页面里不要再画一份打不开也关不掉的表单。

若必须预留浮层 DOM，根节点若是 ``fixed inset-0``（或 ``inset-y-0`` 侧滑面板、
它的 backdrop 兄弟），必须带 ``hidden``。

占位数据必须写成**可读的中文文字**，
不许用灰色横条或色块代替：日期写 20XX-XX-XX，金额写 ¥ ××,×××，百分比写 ××.×%，
计数写 ×,×××，人名写「张师傅」这类。表格要有真实的中文列名。

这是**客户自己的产品**。页脚、logo、版权行、关于页里不许出现你（生成方）的名字、
品牌、域名或联系方式；除了上面指定的 Tailwind CDN、placehold.co，以及
库存图床（images.unsplash.com / images.pexels.com / upload.wikimedia.org /
staticflickr.com / rawpixel.com），不要写任何外部网址。配图用
https://placehold.co，每张 <img> 的 alt 写成这张照片的英文检索词（画面上是什么，
例如 ev charging station；不要写用户分层）。不许自己编 unsplash / pexels
photo id。产品名要从客户的业务里起，不要用你自己的名字
（不要写成面团 / 面团AI / SlideRule）。"""

#: 移动端契约。壳的形状同样是**硬约束**：3.5 步抠 <header> + 页面级 <nav>
#: （底部标签栏），这里不写成 <nav>，3.5 就没得抠，移动端那套判据整个失效。
#:
#: ⚠ 2026-08-20 第四/五趟：第一版写成网站壳（fixed 底栏 + main.pb-32 +
#: sticky 顶栏再叠 pt-16），事后用 !important 对打，越补越伤。配方改抄
#: ant-design-mobile 官方 TabBar demo2.less：
#:   .app { height:100vh; display:flex; flex-direction:column }
#:   .top { flex:0 }  .body { flex:1 }  .bottom { flex:0 }
#: 文档原句：TabBar 本身不含定位，外层 flex 列才是壳。NavBar 默认也不是
#: position:fixed（nav-bar.less --height:45px，在文档流里）。
_STRUCTURAL_CONTRACT_MOBILE = """整页按 ant-design-mobile 的 App 壳来排（官方 TabBar demo2.less）：
一列 flex，不是网站那种 position:fixed 顶栏/底栏再给 main 垫 pt-16 / pb-32。

html 与 body：width:100%; height:100%; overflow:hidden。
body：display:flex; flex-direction:column（Tailwind：flex flex-col h-full overflow-hidden）。

顶部 <header>：在文档流里，flex-shrink:0。不要 sticky、不要 fixed、不要再给 <main> 写 pt-16。
左侧产品名，右侧当前登录角色。高度随内容，不要再套一层手机外框。

中间 <main>：flex:1; min-height:0; overflow-y:auto。不要 pt-16，不要 pb-32。
内容区是可上下滚动的单列，本页 purpose 说的那件任务。

底部 <nav>：body 的最后一个子元素，在文档流里，flex-shrink:0。
**不要 position:fixed**（官方：TabBar 本身不含定位，外层 flex 列把底栏钉住）。
每个页面入口是一个 <a>，图标在上文字在下；文字是 2～4 个字的短名，不要带「页」
（对照 TabBar.Item title：首页 / 待办 / 消息 / 我的），加 text-[10px] whitespace-nowrap。

**不要左侧边栏（不要 <aside>）**。

视口已经是手机 CSS 像素（390×844，Playwright iPhone 14 / Chrome DevTools 同款）。
内容铺满视口。
不要再套一层手机外框，不要用 max-w-sm / max-w-md / mx-auto 把整页收成居中卡片，
不要写 w-[390px] 再居中——预览区已经有设备框，你输出的就是 App 本身。
不要把四个页面入口画成屏幕正中的一排图标：那是底部 <nav>，不是首页内容。
结构只能是 header 顶、main 铺满（列表/表单/详情）、nav 贴底。

这一页的主内容必须是本页 purpose 说的那件任务（列表 / 表单 / 详情）。
不许用「个人资料卡 + 设置入口 + 退出登录」顶替业务页。

页面里的 <script> **不会被执行**（渲染方会移除）。所以不要引图表库、不要写 JS
渲染——图表一律用内联 <svg> 的 <polyline>/<rect>/<path>/<circle> 直接画出来。

这一页的首屏是本页 purpose 说的那件任务处于**未打开浮层**的状态。
列表页首屏是列表；不要把新增/编辑表单或底部 Sheet 画进首屏。
新建和编辑由宿主提供表单。不要抄打开态快照。

若必须预留浮层 DOM，根节点若是 ``fixed inset-0``，必须带 ``hidden``。

占位数据必须写成**可读的中文文字**，
不许用灰色横条或色块代替：日期写 20XX-XX-XX，金额写 ¥ ××,×××，百分比写 ××.×%，
计数写 ×,×××，人名写「张师傅」这类。列表要有真实的中文字段名。

这是**客户自己的产品**。页脚、logo、版权行、关于页里不许出现你（生成方）的名字、
品牌、域名或联系方式；除了上面指定的 Tailwind CDN、placehold.co，以及
库存图床（images.unsplash.com / images.pexels.com / upload.wikimedia.org /
staticflickr.com / rawpixel.com），不要写任何外部网址。配图用
https://placehold.co，每张 <img> 的 alt 写成这张照片的英文检索词（画面上是什么，
例如 ev charging station；不要写用户分层）。不许自己编 unsplash / pexels
photo id。产品名要从客户的业务里起，不要用你自己的名字
（不要写成面团 / 面团AI / SlideRule）。"""

#: 缺省风格。**一句话**——它只是没人指定时的兜底，不是"推荐版式"。
#: 密度、版式原型、组件词汇这些该由上游按应用给（第 1.5 步生成 / 人工覆盖）。
#: 移动端单独一句——桌面那句「克制的企业后台」会把竖屏画回 PC。
#: 消费 / 内容壳。对照 Medium / Apple News：顶栏横栏 + 大图，没有 aside。
#: page_shell 内容路径认 <header> 里的 <nav>，写了 aside 会被剥掉。
_STRUCTURAL_CONTRACT_CONTENT = """顶部一个 <header>（产品名 + 一条横栏 <nav> + 当前身份），正文放在 <main> 里。
**不要左侧边栏（不要 <aside>）**。这是给人看和读的内容产品，不是业务后台。

html 与 body 必须 width:100%; height:100%。<header>、<main> 铺满视口。
Header 里的 <nav> 是页面入口横栏，每个入口一个 <a>，当前页带 aria-current="page"。
不要用 max-w-5xl / max-w-6xl / max-w-7xl / mx-auto 把整页收成屏幕正中一张卡片。

图是一等公民：封面/图流页第一眼必须有大幅 <img>（https://placehold.co），
图流/档案第一屏至少 4 张可见图，不要两列网格只放一张。封面/长文可以一张主图。
头像必须是正方形人像特写，不要把风景或相机裁进小框。
<main> 不要 flex justify-between 把稀疏区块撑满视口。
不要用四张等宽 KPI 统计卡顶替画面，不要宽表台账。

页面里的 <script> **不会被执行**（渲染方会移除）。所以不要引图表库、不要写 JS
渲染——图表一律用内联 <svg> 的 <polyline>/<rect>/<path>/<circle> 直接画出来。

这一页的首屏是 brief 里「用途」处于**未打开浮层**的状态。
不要把新增表单、编辑表单、Slide-over、对话框画进首屏——script 不跑，画出来的抽屉关不掉。

若必须预留浮层 DOM，根节点若是 ``fixed inset-0``（或 ``inset-y-0`` 侧滑面板、
它的 backdrop 兄弟），必须带 ``hidden``。

占位数据必须写成**可读的中文文字**，
不许用灰色横条或色块代替：日期写 20XX-XX-XX，人名写「张师傅」这类。

这是**客户自己的产品**。页脚、logo、版权行、关于页里不许出现你（生成方）的名字、
品牌、域名或联系方式；除了上面指定的 Tailwind CDN、placehold.co，以及
库存图床（images.unsplash.com / images.pexels.com / upload.wikimedia.org /
staticflickr.com / rawpixel.com），不要写任何外部网址。配图用
https://placehold.co，每张 <img> 的 alt 写成这张照片的英文检索词（画面上是什么，
例如 morning light through curtains；不要写用户分层）。不许自己编 unsplash / pexels
photo id。产品名要从客户的业务里起，不要用你自己的名字
（不要写成面团 / 面团AI / SlideRule）。"""

#: 自由类型契约。壳跟内容一样（header 横栏、不要 aside），页型不锁死。
#: 2026-08-31 团子的一天：内容原型把图流收成两列只剩一张，作者页头像
#: 裁成黑条、main justify-between 把稀疏区块撑满视口。
_STRUCTURAL_CONTRACT_FREE = """顶部一个 <header>（产品名 + 一条横栏 <nav> + 当前身份），正文放在 <main> 里。
**不要左侧边栏（不要 <aside>）**。不要为了凑后台硬加侧栏，也不要为了凑杂志硬切四页。

html 与 body 必须 width:100%; height:100%。<header>、<main> 铺满视口。
Header 里的 <nav> 是页面入口横栏，每个入口一个 <a>，当前页带 aria-current="page"。
不要用 max-w-5xl / max-w-6xl / max-w-7xl / mx-auto 把整页收成屏幕正中一张卡片。
<main> 不要 flex justify-between 把稀疏区块撑满视口。

按这一页的活儿画：封面/长文可以一张主图；图流/封面架/货架第一屏必须有至少 4 张
可见 <img>（https://placehold.co），不要两列网格只放一张。
头像必须是正方形人像特写，不要把风景或相机裁进 96px 小框。
不要用四张等宽 KPI 统计卡顶替画面，不要宽表台账除非这一页就是台账。

页面里的 <script> **不会被执行**（渲染方会移除）。所以不要引图表库、不要写 JS
渲染——图表一律用内联 <svg> 的 <polyline>/<rect>/<path>/<circle> 直接画出来。

这一页的首屏是 brief 里「用途」处于**未打开浮层**的状态。
不要把新增表单、编辑表单、Slide-over、对话框画进首屏——script 不跑，画出来的抽屉关不掉。

若必须预留浮层 DOM，根节点若是 ``fixed inset-0``（或 ``inset-y-0`` 侧滑面板、
它的 backdrop 兄弟），必须带 ``hidden``。

占位数据必须写成**可读的中文文字**，
不许用灰色横条或色块代替：日期写 20XX-XX-XX，人名写「张师傅」这类。

这是**客户自己的产品**。页脚、logo、版权行、关于页里不许出现你（生成方）的名字、
品牌、域名或联系方式；除了上面指定的 Tailwind CDN、placehold.co，以及
库存图床（images.unsplash.com / images.pexels.com / upload.wikimedia.org /
staticflickr.com / rawpixel.com），不要写任何外部网址。配图用
https://placehold.co，每张 <img> 的 alt 写成这张照片的英文检索词（画面上是什么，
例如 morning light through curtains；不要写用户分层）。不许自己编 unsplash / pexels
photo id。产品名要从客户的业务里起，不要用你自己的名字
（不要写成面团 / 面团AI / SlideRule）。"""

_DEFAULT_STYLE = "企业后台风格，浅色底。"
_DEFAULT_STYLE_CONTENT = (
    "消费端内容产品风格，浅色底，图是一等公民。大幅配图 + 短标题，不是业务后台。"
)
_DEFAULT_STYLE_FREE = (
    "自由类型：按这个产品自己的气质，浅色底。不套后台中台，也不套杂志四页。"
)
_DEFAULT_STYLE_MOBILE = "移动端 App 风格（竖屏 390×844 CSS 像素），浅色底，单列卡片流铺满视口。触控目标 ≥ 44px（Apple HIG），不要按 1080 物理像素去画 88px 大按钮。"
#: ⚠ 2026-08-30 夜真机：preferredDevice=tablet 已落盘，五页仍走桌面缺省句。
#: 桌面那句「企业后台」会把现场手持画回 1920 中台。
_DEFAULT_STYLE_TABLET = (
    "平板现场作业风格（横屏 1112×834 CSS 像素，对照 iPad Air 横屏），浅色底，"
    "主任务 + 旁路详情，触控目标 ≥ 44px（Apple HIG）。不是 PC 中台，也不要手机底栏。"
)


def build_design_system_prompt_block(
    design_system: Optional[str], *, device: str = "desktop", product_archetype: str = ""
) -> str:
    """拼出 `<design_system>` 块：**风格在前，契约在后**。

    形状沿用上游 screenshot-to-code 的同名函数（含"冲突时以设计系统为准"
    那句优先级声明），差别是本仓把契约那一半固定接在后面。

    ⚠ 契约放**最后**，并且明写"与上面冲突时以这一节为准"：
      注入进来的风格描述可能跟契约打架（比如要求"极简单栏、去掉侧边导航"），
      而契约输了的代价不是难看，是 page_shell 抠不到壳、整套外壳判据静默失效。
    """
    from .archetype_legal import is_content_app, is_free_app

    content = is_content_app(product_archetype)
    free = is_free_app(product_archetype)
    style = (design_system or "").strip() or (
        _DEFAULT_STYLE_MOBILE
        if device == "phone"
        else _DEFAULT_STYLE_CONTENT
        if content
        else _DEFAULT_STYLE_FREE
        if free
        else _DEFAULT_STYLE_TABLET
        if device == "tablet"
        else _DEFAULT_STYLE
    )
    # ⚠ 不许写成 `phone else desktop`：tablet 会静默领走 1920 + w-64。
    # ⚠ 内容/自由原型优先于平板 aside 契约：选了 open chrome 就不能再要侧栏。
    if device == "phone":
        contract = _STRUCTURAL_CONTRACT_MOBILE
        if content:
            contract += "\n图是一等公民：列表/封面用大图卡片，不要指标卡顶替画面。\n"
        elif free:
            contract += (
                "\n按这一页的活儿画：图流至少 4 张可见图，表单就一个主表单。"
                "不要为了凑后台硬加指标卡。\n"
            )
    elif content:
        contract = _STRUCTURAL_CONTRACT_CONTENT
    elif free:
        contract = _STRUCTURAL_CONTRACT_FREE
    elif device == "tablet":
        contract = _STRUCTURAL_CONTRACT_TABLET
    else:
        contract = _STRUCTURAL_CONTRACT
    return f"""## Design system

If the design system conflicts with other instructions, prioritize the design system.

<design_system>
{style}

## 以下几条是硬约束，与上面的风格描述冲突时以这一节为准

{contract}
</design_system>"""


class SpecPageHtmlError(RuntimeError):
    """这一步失败就如实失败，不回落占位。

    理由跟 spec_tree 那次同源：一份看起来像那么回事的假产物比没有更糟——
    它会让下游以为上游是厚的，而且**没有任何一处会发现它是假的**。
    """


def assumption_prompt_block(spec: Dict[str, Any]) -> str:
    """伴随式确认过的决定，喂给画页 / 定风格。空则空串。

    2026-09-03 真机（萌芽成长树）：家长模式 / 20:00 进了 spec.assumptions，
    画页 brief 没读，四页 HTML 里这两个词都是 0。确认过的分叉必须进提示词，
    不然卡白选。
    """
    rows = spec.get("assumptions") if isinstance(spec, dict) else None
    if not isinstance(rows, list) or not rows:
        return ""
    lines: List[str] = [
        "已确认的产品决定（必须做成看得见的界面：输入框、按钮、开关、列表；",
        "禁止只写在 HTML 注释、角标或空状态说明里）：",
    ]
    for row in rows:
        if not isinstance(row, dict):
            continue
        topic = str(row.get("topic") or "").strip()
        decision = str(row.get("decision") or "").strip()
        if topic and decision:
            lines.append(f"- {topic}：{decision}")
        elif decision:
            lines.append(f"- {decision}")
        elif topic:
            lines.append(f"- {topic}")
    return "\n".join(lines) if len(lines) > 2 else ""


def build_page_brief(
    page: Dict[str, Any], spec: Dict[str, Any], *, product: str = ""
) -> str:
    """把 spec 的一页摊成自然语言，喂给出 HTML 的那一步。

    只用 spec 里**这一页真的覆盖到**的需求节点（coversNodes），不把整棵树倒进去：
    倒整棵树会让每一页都长得一样，而 spec 的页面清单本来就是按职责切好的。

    ## 照仓里那份**真出过好效果**的模板补齐（2026-08-15 晚）

    参照 experiments/visual-first/img_hop2.py 的 `image_prompt_from_spec`——
    它逐字对着 materials/previews/provenance-crm-4pages.json，那是"唯一真出过
    好效果的样本"。它的六段里，本函数原来缺两段：

      ① **产品一句话**。img_hop2 的注释直接点了名：「旧那份的 page_brief 没有
         ——模型不知道这是个什么产品」。而本函数**就是那个旧那份**。
         少了它，模型只知道"这一页叫库存台账管理页"，不知道它属于一个什么东西。

      ④ **设计要点（notes）**。原来写的是 `acceptance or notes`——**有验收条件
         就把设计要点丢掉**。而参照模板是两段都要：acceptance 进"要能体现"，
         notes 进"设计要点"。notes 恰好是唯一一处**逐页不同的版式提示**
         （"列表页提供关键词搜索与效期区间筛选"这类），丢掉它等于把 spec 里
         仅有的排布信息扔了。

    ⚠ 量过才改：改之前两个完全不同业务（药店库存 / 律所工时）的最终提示词
      **逐字相同 95.7%**，整份 1642 字里随业务变的只有 69 字。而 2026-07-31
      记在 freeform_block.py 的那次同款测量是 87%，当时就判成病了。
    """
    by_id = {str(n.get("id")): n for n in (spec.get("nodes") or [])}
    lines: List[str] = []
    if (product or "").strip():
        lines.append(f"产品：{product.strip()}")
    if str(spec.get("appName") or "").strip():
        lines.append(f"产品名：{str(spec['appName']).strip()}")
    lines += [
        f"页面：{page.get('name', '')}",
        f"使用者：{page.get('audience', '')}",
        f"用途：{page.get('purpose', '')}",
        "这一页要承载的需求：",
    ]
    notes: List[str] = []
    for ref in page.get("coversNodes") or []:
        node = by_id.get(str(ref))
        if not node:
            continue
        lines.append(f"- {node.get('title', '')}：{node.get('acceptance') or ''}")
        if str(node.get("notes") or "").strip():
            notes.append(str(node["notes"]).strip())
    if notes:
        # ⚠ 单独成段，不塞回需求那一行：它说的是**怎么排**，跟"要满足什么"
        #   不是一类信息，混在一起模型会当成验收条件的补充说明读过去。
        lines.append("设计要点：" + "；".join(notes))
    decided = assumption_prompt_block(spec)
    if decided:
        lines.append(decided)
    return "\n".join(lines)


def build_page_html_prompt(
    brief: str,
    *,
    device: str = "desktop",
    design_system: Optional[str] = None,
    product_archetype: str = "",
) -> str:
    """create/text.py 的 USER_PROMPT，逐字对齐（image policy 取 disabled 那一支）。

    device（2026-08-14 晚加）：`"phone"` 时换移动端契约（竖屏 390×844 CSS
    像素、顶栏 + 底部标签栏、无侧栏）。
    2026-08-30 夜：`"tablet"` 换平板契约（1112×834、窄侧栏 w-52），
    不再落到桌面 1920×1080。词表沿用账本接通档，不另发明。

    design_system（2026-08-15 晚加）：这个应用的**风格**描述，一路可以从
    调用方传进来（生成 / 人工覆盖都走这个口）。不传就用缺省那一句话。
    结构契约不受它影响——见 build_design_system_prompt_block。
    """
    design = build_design_system_prompt_block(
        design_system, device=device, product_archetype=product_archetype
    )
    return f"""Generate UI for {brief}.
{_STACK}
{design}

# Instructions

- Follow the <design_system> visual tone. Do not invent a generic admin skin.
- Follow UX best practices.
- If the brief contains 已确认的产品决定, those decisions must appear as real UI (inputs, buttons, toggles, lists) using the decision's own words. Do not hide them in HTML comments or a tiny badge.
- The first screen is the page **at rest**. A list/ledger page shows the table or cards and a single "新增" button — not an open create/edit drawer or dialog. Do not copy Tailwind UI Slide-over "open" snapshots. Create/edit forms are provided by the host; page scripts will not run, so an open drawer cannot be closed.
- Pick one surface for the whole app (light OR dark). Do not mix a light page with bg-slate-900 / bg-black cards, and do not paint the top header and the sidebar two different darks.
- Resource timelines / occupancy grids: header ticks and body cells share the same column count. Tailwind Play only ships grid-cols-1..12 — prefer 12 or fewer, or the same N on both sides. Empty slots stay in document flow; do not stretch one row with flex-1 to fake a full board. Now-lines and other overlays are siblings of the repeating row, never the first child of the row list.
- Breadcrumb first item is the product name from the brief. Never write 通用后台, Admin, 控制台, or Dashboard as the root.
- Image generation is disabled for this request. Do not call generate_images. \
Do not invent unsplash or pexels photo IDs. \
Use placeholder URLs (https://placehold.co). Put a specific English photo search query in each img alt (what the picture shows, not the user segment, not generic phrases like AI Workflow Video)."""


def _strip_fences(text: str) -> str:
    out = re.sub(r"^```(?:html)?\s*", "", (text or "").strip())
    out = re.sub(r"\s*```$", "", out)
    low = out.lower()
    idx = low.find("<!doctype")
    if idx < 0:
        idx = low.find("<html")
    return out[idx:] if idx > 0 else out


#: 提示词里**明确要求或允许**的外部主机。
#:   · cdn.tailwindcss.com —— 栈约束点名要引的
#:   · placehold.co        —— 抄 screenshot-to-code 的 image policy 里写的占位图
#:   · fonts.google*       —— 「用现代专业字体」这条的常见实现；渲染器本来就 abort 它，
#:                            放进白名单纯粹是别让它变成噪音告警
#:   · 库存图床            —— 画页后按 alt 直挂搜到的 URL（stock_images.fill）。
#:                            闸仍放行，否则换图后的成品会被当成未授权外链。
from .stock_images import STOCK_IMAGE_HOSTS

_ALLOWED_HOSTS: Tuple[str, ...] = (
    "cdn.tailwindcss.com",
    "placehold.co",
    "fonts.googleapis.com",
    "fonts.gstatic.com",
) + STOCK_IMAGE_HOSTS

#: 模型供应商自己的身份。这几个词出现在**客户的交付物**里永远是错的。
#: ⚠ 真机原文（2026-08-15，连锁药房那趟 p3 页脚）：
#:     © 2024 欧亿智能库存效期管理系统 | 全局同步延迟 < 1s | 唯一官方: https://www.rcouyi.com
#:   同一天还见过它拿这个名字当产品名：欧亿智造系统 / 欧亿口腔 / 欧亿医疗连锁。
#:   根源是中转站往请求里注入的人设（跟 agentic-pick 那次寒暄同源），
#:   只是这次泄漏到了产出里。
_VENDOR_IDENTITY = ("欧亿", "ouyi", "rcouyi")

#: 图标/组件库的公共 CDN。**不是品牌泄漏**，是依赖选择。
#: ⚠ 实测：35 份真机产出里，cdnjs 出现在 14 份、unpkg 出现在 3 份。
#:   把它们当硬失败等于每页都要重问，整步必挂——这条判据本身会变成事故。
_COMMON_CDN_HOSTS = ("cdnjs.cloudflare.com", "unpkg.com", "cdn.jsdelivr.net")

#: XML 命名空间**不是链接**。`xmlns="http://www.w3.org/2000/svg"` 是每个内联
#: SVG 都有的东西，扫 URL 时必须先排掉——第一版没排，真机 35 页里当场误报。
_XMLNS_RE = re.compile(r'xmlns(?::\w+)?\s*=\s*["\'][^"\']*["\']')

_URL_RE = re.compile(r"https?://([A-Za-z0-9.-]+)")
#: 剥外链时要整段换掉，不能只抠 host，不然 href 还指着原址。
_URL_FULL_RE = re.compile(
    r"https?://[A-Za-z0-9.-]+(?::\d+)?(?:/[^\s\"'<>]*)?",
    re.I,
)
#: xmlns 里的 w3.org 不是外链。剥的时候也要放过，否则每个内联 SVG 被改成 #。
_NEUTRALIZE_KEEP_HOSTS: Tuple[str, ...] = _ALLOWED_HOSTS + _COMMON_CDN_HOSTS + ("w3.org",)


def _host_is(host: str, allowed: Tuple[str, ...]) -> bool:
    name = (host or "").lower().rstrip(".")
    return any(name == a or name.endswith("." + a) for a in allowed)


def neutralize_foreign_urls(markup: str) -> str:
    """白名单外的 http(s) 改成 ``#``，而不是把整页扔掉。

    ⚠ 2026-08-20 Foclip（sr-20260820153501-ZWNB860JKH）：拾取工作台 /
    知识资产库把示例条目写成 ``tech.example.com``、``blog.dev.io``。
    ``validate_page_html`` 把整页判死刑，``page_shell`` 仍按 spec 把四条
    菜单写进剩下两页的侧栏。宿主点 ``data-page-id=p1`` 在 pages 里找不到
    页，``resolveActivePageId`` 静默回落最新页——看起来像「菜单路由坏了」。

    外链不该出现在交付物里（连锁药房页脚那次），但修法是**拔掉链接**：
    这一页还在，菜单点得进去。供应商身份（欧亿 / rcouyi 字样）不走这里，
    那是品牌泄漏，继续 fail-closed。
    """

    def _repl(match: re.Match[str]) -> str:
        url = match.group(0)
        host = url.split("://", 1)[-1].split("/", 1)[0].split(":", 1)[0]
        if _host_is(host, _NEUTRALIZE_KEEP_HOSTS):
            return url
        return "#"

    return _URL_FULL_RE.sub(_repl, markup or "")


def scan_foreign_references(markup: str) -> List[str]:
    """扫产出里的**外部链接**与**模型供应商身份**。

    ## 为什么要有这条

    真机（连锁药房，2026-08-15）：模型把中转站自己的域名写进了客户的页脚。
    这跟外壳漂移不是一个量级——那是排版问题，这是**交付物里混进了第三方的
    品牌与链接**，直接发给客户就是事故。

    ## ⚠ 只拦两类，不拦「品牌名」本身

    这条**刻意不做**通用的品牌词过滤。同一天的产出里有
    士卓曼 (Straumann BLT)、诺贝尔 (Nobel Biocare)、Bio-Oss 骨粉、
    瑞士ITI种植体——那些是**正确的领域细节**，是这个模型最值钱的地方，
    拦掉就把好东西一起杀了。

    所以判据收窄成两条机械可判的：
      ① 白名单之外的外部主机（提示词只授权了 tailwind CDN 和 placehold.co）
      ② 模型供应商自己的身份（欧亿 / OuYi / rcouyi）——这个在客户产品里
        没有任何正当出现的理由

    ## ⚠ 分两档，因为上线前量了 35 份真机产出：**94% 会命中**

    第一版把所有命中都当阻断，等于每页都要重问、整步必挂——**这条判据本身
    会变成事故**（同 120s 落后者截止线那次：拿一批数据推的阈值套到另一批上）。
    拆开看三类性质完全不同：

      · `www.w3.org`                 内联 SVG 的 xmlns，**纯误报**，先抠掉再扫
      · cdnjs / unpkg                图标库 CDN，35 份里 17 份有。是**依赖选择**，
                                     不是品牌泄漏 → 只提醒，不阻断
      · 欧亿 / rcouyi.com            **真事故** → 阻断

    返回 (阻断项, 提醒项)。**只有阻断项进 validate_page_html。**
    """
    text = markup or ""
    blocking: List[str] = []
    notes: List[str] = []

    # ⚠ 先把 xmlns 抠掉再扫 URL，否则每个内联 SVG 都误报 w3.org。
    scannable = _XMLNS_RE.sub("", text)
    hosts = {
        host
        for host in _URL_RE.findall(scannable)
        if not _host_is(host, _ALLOWED_HOSTS)
    }
    cdn = sorted(
        h for h in hosts if any(h == c or h.endswith("." + c) for c in _COMMON_CDN_HOSTS)
    )
    other = sorted(hosts - set(cdn))

    if other:
        blocking.append(
            f"页面里出现了未授权的外部链接：{'、'.join(other[:5])}"
            f"（只允许 {'、'.join(_ALLOWED_HOSTS)}）"
        )
    if cdn:
        # 提醒不阻断：要不要收敛 CDN 依赖是**产品决策**，
        # 不该由一条校验规则替人做主，更不该拿它去打死整步。
        notes.append(f"页面引了公共 CDN：{'、'.join(cdn)}（不阻断，离线环境会掉样式）")

    low = text.lower()
    hit = [w for w in _VENDOR_IDENTITY if w in low or w in text]
    if hit:
        blocking.append(
            f"页面里出现了模型供应商的身份标识：{'、'.join(hit)}——"
            f"这是客户的产品，不许出现生成方的品牌、域名或联系方式"
        )
    return blocking, notes


#: 一份能用的页面至少要有的东西。**每一条都能机械判**，没有「看着够不够丰富」
#: 这种判断——今天在这上面栽过三次（数字段 / 数语义标签 / 拿坏渲染器截图）。
#: ⚠ 这里刻意**不判丰富度**：丰富度得渲染出来用眼睛看，机械判据只负责挡住
#:   「明显不是一份完整页面」的东西。
def guidelines_gate_notes(markup: str, *, product_archetype: str = "") -> List[str]:
    """机械审查，不当审美来源。对照 Vercel web-design-guidelines 的可机械部分。

    只记不拦（增强类 fail-open）。对比 / 空态能静态看见的才报；
    触控尺寸要渲染后才准，这里不拿 class 猜 44px。
    内容原型另报「没有 <img>」——图是一等公民，缺图就是缺，但本轮不拦画页。
    """
    text = markup or ""
    low = text.lower()
    notes: List[str] = []
    if re.search(r"text-(gray|slate|zinc)-[123]00", low) and re.search(
        r"bg-(white|slate-50|gray-50|zinc-50)", low
    ):
        notes.append("浅字浅底，对比可能不够")
    emptyish = bool(re.search(r"<t(body|able)\b", low)) and not re.search(
        r"<tr\b", low
    )
    if emptyish and not re.search(r"暂无|还没有|空空|没有数据|empty", text):
        notes.append("表/列表没有行，也没有空态文案")
    from .archetype_legal import is_open_chrome

    if is_open_chrome(product_archetype) and not re.search(r"<img\b", low):
        notes.append("开放壳产品没有 <img>，图不是一等公民")
    return notes


def validate_page_html(markup: str) -> List[str]:
    problems: List[str] = []
    text = markup or ""
    low = text.lower()
    if "<html" not in low:
        problems.append("不是一份完整 HTML 文档（找不到 <html>）")
    if "</html>" not in low:
        # 截断是这条链上真实发生过的失败形态：推理模型思考吃光 max_tokens，
        # 正文写一半就停，而 finish_reason 不会喊。收尾标签是最便宜的判据。
        problems.append("HTML 没有收尾（找不到 </html>），多半是被截断了")
    if "cdn.tailwindcss.com" not in low:
        problems.append("没有引入 Tailwind，栈约束没被遵守")
    if not re.search(r"[一-鿿]", text):
        problems.append("整页没有一个中文字符，占位文案没按设计系统写")
    # 「只示意不写真实数据」的反面：模型有时会返回一段解释再跟 HTML
    if low.strip().startswith(("here", "sure", "好的", "以下")):
        problems.append("正文前面带了解释性文字，没有按要求只返回 HTML")
    # 外链与供应商身份。放在最后：前面几条判的是「是不是一份完整页面」，
    # 这条判的是「这份页面能不能交给客户」。
    # ⚠ 只取阻断档；提醒档（公共 CDN）由调用方自己决定要不要打印，
    #   混进来会让 35 份真机产出里 94% 都触发重问。
    blocking, _notes = scan_foreign_references(text)
    problems.extend(blocking)
    return problems


def generate_page_html(
    page: Dict[str, Any],
    spec: Dict[str, Any],
    *,
    device: str = "desktop",
    design_system: Optional[str] = None,
    product: str = "",
    product_archetype: str = "",
    llm_call: Optional[Callable[..., Any]] = None,
    max_attempts: int = 2,
) -> Dict[str, Any]:
    """一页 spec → 一份 HTML。失败抛 SpecPageHtmlError，**不回落占位**。

    返回 {"version", "pageId", "html", "brief", "prompt"}。
    """
    brief = build_page_brief(page, spec, product=product)
    prompt = build_page_html_prompt(
        brief,
        device=device,
        design_system=design_system,
        product_archetype=product_archetype,
    )
    if llm_call is None:
        # ⚠ 用带重试的那个，不是裸 call_llm（2026-08-13 修）。
        #
        # 病灶：真机跑六页时一次 httpx.RemoteProtocolError（网关断开）就把
        # **整轮**打死了——前面那 70 秒的 SPEC 白跑。而那是个瞬时错误，
        # 重跑一次就好。
        #
        # 下面 max_attempts 那个循环治的是**校验不过**（HTML 被截断、没引
        # Tailwind…），跟网络断开是两回事：网络类错误连 HTML 都没拿到，
        # 拿什么去校验？两者混在一个计数里，等于一次网络抖动就吃掉一次
        # 宝贵的重问额度。
        #
        # 仓里现成的 call_llm_with_retry 已经把这件事分好了：LlmError 带
        # transient 标志（429/524/5xx/连接断开为 True，401/404 为 False），
        # 只对瞬时错误重试，还带 gRPC hedging 语义治长尾慢请求。
        # ⚠ 所以**不引 tenacity / backoff**：那会是个新依赖，且只覆盖重试
        # 不覆盖对冲，比现有的弱。
        from sliderule_llm.client import call_llm_with_retry

        def llm_call(messages, **kwargs):  # type: ignore[misc]
            return call_llm_with_retry(messages, max_attempts=3, backoff_ms=2000, **kwargs)

    last: List[str] = []
    for _ in range(max(1, max_attempts)):
        response = llm_call(
            [
                {"role": "system", "content": "You are an expert at building front-ends."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
        )
        html = neutralize_foreign_urls(_strip_fences(getattr(response, "content", "") or ""))
        last = validate_page_html(html)
        if not last:
            for note in guidelines_gate_notes(
                html, product_archetype=product_archetype
            ):
                print(f"[spec_page_html] 页面 {page.get('id')} 交付闸：{note}")
            return {
                "version": SPEC_PAGE_HTML_VERSION,
                "pageId": str(page.get("id") or ""),
                "html": html,
                "brief": brief,
                "prompt": prompt,
            }
    raise SpecPageHtmlError(
        f"页面 {page.get('id')} 的 HTML 未通过校验：{'；'.join(last)}"
    )


def edit_page_html(
    page: Dict[str, Any],
    prev_html: str,
    instruction: str,
    *,
    llm_call: Optional[Callable[..., Any]] = None,
    max_attempts: int = 2,
    product_archetype: str = "",
) -> Optional[Dict[str, Any]]:
    """在已有页面上**改一小块**，成功返回同 generate_page_html 的形状；
    改不动返回 **None**，由调用方回落整页重画。

    ## 为什么是 None 而不是抛

    改不动不是故障，是"这条路没走通"，正常结局是退回整页重画（今天的行为）。
    抛异常会被上层当成"这一页挂了"记进 failed，于是**一次可以正常降级的
    事故被记成缺页**——第 4 步的页面覆盖判据会报一个并不存在的缺口。

    ## 三道关，缺一不可

        1. 模型得给出 SEARCH/REPLACE 块        —— 给不出就是没走通
        2. 至少套上一块                        —— 一块都没套上 = 页面原样，
                                                 当成"改好了"交出去就是说谎
        3. 改完的 HTML 仍要过 validate_page_html —— 局部改也能把页面改坏

    ⚠ 第 2 条特别重要：`apply_edit_blocks` 匹配不上时**原样返回**输入 HTML。
      不看 applied 数就交出去，表现是"用户说了话、页面一个字没变、日志全绿"。
    """
    from .page_edit_blocks import (
        apply_edit_blocks,
        build_edit_prompt,
        describe_failures,
        parse_edit_blocks,
    )

    page_id = str(page.get("id") or "")
    if not prev_html.strip() or not (instruction or "").strip():
        return None

    if llm_call is None:
        from sliderule_llm.client import call_llm_with_retry

        def llm_call(messages, **kwargs):  # type: ignore[misc]
            return call_llm_with_retry(messages, max_attempts=3, backoff_ms=2000, **kwargs)

    messages = build_edit_prompt(page_id, prev_html, instruction)
    for attempt in range(max(1, max_attempts)):
        response = llm_call(messages, temperature=0.2)
        text = getattr(response, "content", "") or ""
        blocks = parse_edit_blocks(text)
        if not blocks:
            print(f"[spec_page_html] 页面 {page_id} 局部改：模型没给出 SEARCH/REPLACE 块")
            return None

        got = apply_edit_blocks(prev_html, blocks)
        if not got["applied"]:
            # 一块都没套上。照 Aider 的做法把**原文里最接近的几行**回喂过去
            # ——光说"没匹配上"模型不知道自己差在哪。
            if attempt + 1 < max(1, max_attempts):
                messages = messages + [
                    {"role": "assistant", "content": text[:4000]},
                    {"role": "user", "content": describe_failures(prev_html, got["failed"])},
                ]
                continue
            print(f"[spec_page_html] 页面 {page_id} 局部改：{len(blocks)} 块一块都没匹配上")
            return None

        cleaned = neutralize_foreign_urls(got["html"])
        from .bind_hole_freeze import freeze_bind_holes

        cleaned = freeze_bind_holes(prev_html, cleaned)
        for note in guidelines_gate_notes(
            cleaned, product_archetype=product_archetype
        ):
            print(f"[spec_page_html] 页面 {page_id} 交付闸：{note}")
        problems = validate_page_html(cleaned)
        if problems:
            print(
                f"[spec_page_html] 页面 {page_id} 局部改后没过校验，回落整页重画："
                f"{'；'.join(problems)[:160]}"
            )
            return None

        print(
            f"[spec_page_html] 页面 {page_id} 局部改：套上 {len(got['applied'])} 块"
            + (f"，{len(got['failed'])} 块没匹配上" if got["failed"] else "")
        )
        return {
            "version": SPEC_PAGE_HTML_VERSION,
            "pageId": page_id,
            "html": cleaned,
            "brief": "",
            "prompt": "",
            "editedBlocks": len(got["applied"]),
        }
    return None


def _straggler_idle_seconds() -> float:
    """落后者预算的**下限**（锚在上次有页落地）。

    120s 是量出来的，不是拍的：干净并发 5 页实测 200.8s 全部到齐，页与页之间
    最大间隔 43s（157.5 / 163.2 / 173.8 / 177.2 / 200.8）。120s 留了近三倍余量。

    ⚠ 它现在是**下限**而不是预算本身——见 `_straggler_budget`。改成下限之后
      这条线只会比原来更宽松，绝不会更严，所以它不可能引入新的误杀。

    ⚠ 调这个值前先想清楚锚点：它量的是「这批还在不在动」，不是「一共跑了多久」。
    """
    return float(os.getenv("SLIDERULE_SPEC_PAGE_STRAGGLER_IDLE_SECONDS", "120"))


def _straggler_multiplier() -> float:
    """预算 = 首页实测耗时 × 这个倍率。

    1.5 的来处：干净那批页间最大间隔 43s、首页 157.5s，比值 0.27。取 1.5 是
    留了五倍余量，同时仍远小于「一页从头重跑」的量级。
    """
    return float(os.getenv("SLIDERULE_SPEC_PAGE_STRAGGLER_MULTIPLIER", "1.5"))


def _straggler_max_seconds() -> float:
    """预算的**上限**：首页本身病态地慢时，不许把截止线撑到形同虚设。

    首页可能因为重试而耗到 990s（真机见过一次 331.1s 的空挂，重试 3 次）。
    没有上限的话预算会被它带到 1485s，这条线就白设了。
    """
    return float(os.getenv("SLIDERULE_SPEC_PAGE_STRAGGLER_MAX_SECONDS", "600"))


def _straggler_budget(first_page_seconds: float) -> float:
    """按首页实测耗时定这一批的落后者预算。

    ## 为什么要自适应

    固定 120s 在真机上把 5 页里的 4 页误杀了（2026-08-15 口腔连锁）：

        181.7s  页面步开始
        357.9s  p2 到 (+176.2s)   ← 上膛
        477.9s  整步结束           ← 357.9 + 120，算术分毫不差

    截止线**按设计动作了**，是 120s 这个数低于这条链路的正常页间方差。而
    120s 的来处是「干净那批页间最大间隔 43s」——那批**首页只要 157.5s**。
    同一个绝对值套到一个首页 176s、上游还在抖的批次上就不成立了：页间方差
    是跟着单页生成成本走的，不是一个跨环境的常数。

    所以改成**拿这一批自己的首页耗时当尺子**——它天然编码了当前模型、话题
    长度、上游拥塞的综合快慢，不需要我们替每种组合各拍一个数。

    ## 三个数怎么合成

        budget = min(max(下限, 首页耗时 × 倍率), 上限)

    下限保证它**永不比原来更严**（所以这次改动不可能引入新误杀）；上限保证
    一个病态的首页不会把线撑到形同虚设。

    ## 拿两批真机数据回算

    · 市政园林（当初促成这条线的那批）：首页 175.6s → 预算 263s。
      p3/p4/p5 的间隔 6.3 / 52.9 / 34.9s 全在预算内照常交付；p1 永远不来，
      在 760.4s 之后 263s 开火 ≈ 整步 533s，仍从 936s 里砍掉 400s。
      **这条线的原始用途完好。**
    · 口腔连锁（这次被误杀的那批）：首页 176.2s → 预算 264s，是原来的 2.2 倍。
    · 干净基线：首页 157.5s → 预算 236s，页间最大 43s，永不触发。

    ⚠ 首页取的是「**第一个完成的 future**」，成功失败都算，不是「第一个成功的页」。
      理由：这把尺子量的是「当前上游把一页跑完要多久」，一次带重试的失败同样
      是这个环境真实的耗时形状。而一个**秒失败**（比如校验不过）会把尺子量小——
      那一半由下限兜住，落回原来的 120s，不会更糟。
    """
    return min(
        max(_straggler_idle_seconds(), first_page_seconds * _straggler_multiplier()),
        _straggler_max_seconds(),
    )


def _style_for(design_system: Any, page_id: str) -> Optional[str]:
    """风格段可以是**一段**（全应用共用）或**一份 pid→段的表**（逐页各拿各的）。

    ⚠ 逐页那种是 2026-08-16 换成 LLM 现写之后才需要的：对照实验里 B 臂的
      风格段是应用级的，而模型自发写成了逐页版式计划——于是 p1 的提示词里
      塞着 p2/p3/p4 该怎么排。密度腰斩多半有这一份。
    """
    if isinstance(design_system, dict):
        return design_system.get(page_id) or design_system.get("*")
    return design_system


def _safe_on_page(
    on_page: Optional[Callable[[str, str, int, int], None]],
    page_id: str,
    html: str,
    done: int,
    total: int,
) -> None:
    """推一页给前端，回调炸了只记账不外抛。

    单独提出来是因为**有两处在推**（重画完的、原样照搬的），两处各写一遍
    try/except 迟早漂移——本仓在"手抄两份必然漂移"上栽过好几次。
    """
    if on_page is None:
        return
    try:
        on_page(page_id, html, done, total)
    except Exception as sink_exc:  # noqa: BLE001 — 见 generate_pages_parallel docstring
        print(f"[spec_page_html] 页面回调失败（不影响产出）：{str(sink_exc)[:120]}")


def generate_pages_parallel(
    spec: Dict[str, Any],
    *,
    device: str = "desktop",
    design_system: Optional[Any] = None,
    product: str = "",
    max_workers: int = 6,
    llm_call: Optional[Callable[..., Any]] = None,
    on_page: Optional[Callable[[str, str, int, int], None]] = None,
    reuse_pages: Optional[Dict[str, str]] = None,
    edit_base: Optional[Dict[str, str]] = None,
    edit_instruction: str = "",
    product_archetype: str = "",
) -> Dict[str, Any]:
    """把 spec 的每一页并发生成 HTML。**单页失败不拖垮整批。**

    ## 为什么要有这个函数

    调用方原本自己写 `pool.map(lambda pg: generate_page_html(pg, spec), pages)`
    ——`pool.map` 的语义是**任何一个 worker 抛异常，整个迭代就抛**。六页里挂
    一页，另外五页的成果一起丢，而它们已经烧掉了几分钟。页数越多越容易踩：
    六页比三页翻倍。

    写法照 `freeform_block.refine_sheet_prompts_parallel`（本仓已有的同型
    并发批量）：逐个 future 取结果，失败的位置单独记账，不抛。

    ## 跟 fail-open 的区别

    这里**不 fail-open**。失败的页不产出占位 HTML，而是如实记进 `failed`，
    由调用方决定是整轮停还是带着缺页往下走——第 4 步那条页面覆盖判据会发现
    缺页（喂几份出几页），所以缺页不会被静默吞掉。

    ## on_page：一页好了就交出去，别等整批

    `on_page(page_id, html, done, total)` 每落地一页调一次。有它是因为这一步
    是整条链上**第一个产出可以直接看的东西**的地方——一份能独立打开的 HTML，
    比模型早四五分钟。攒齐再交等于把这四五分钟白白变成转圈。

    ⚠ 回调里的异常**吞掉不外抛**：它是"顺带推给前端看"，不是产出的一部分。
    让一个 UI 推送失败去打死已经生成好的页面，是拿次要的东西赔主要的。
    （同款判断见 app_preview.OverviewPreviewSink：出图失败是 fail-open 的
    正常结局，调用方不需要为此加判断。）

    返回 {"pages": {pageId: html}, "failed": {pageId: 原因}}。
    """
    pages = list(spec.get("pages") or [])
    if not pages:
        return {"pages": {}, "failed": {}}

    from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

    ok: Dict[str, str] = {}
    failed: Dict[str, str] = {}

    # ★ 按需重画（2026-08-17）：在 reuse_pages 里的页**原样交付、根本不提交给
    #   线程池**，一次 LLM 都不调。做法取自 Aider——没 add 到 chat 的文件模型
    #   碰不到，那是**能力边界**不是约束。见 services/refine_page_scope.py。
    #
    # ⚠ 照搬的页也要走 on_page：前端直播舞台按 pageId 覆盖，不发的话用户会
    #   盯着一批空位，以为这些页丢了。它们是"已经好了"，不是"还没轮到"。
    #
    # ⚠ 也要计进 total：第 4 步的页面覆盖判据比的是"喂几份 HTML 出几个页面"，
    #   而上游 spec_pages_declared 对账比的是 SPEC 声明数。照搬的页不计数的话，
    #   两处都会把它当成缺页——判据会报一个并不存在的缺口。
    reused: Dict[str, str] = {}
    if reuse_pages:
        for pg in pages:
            pid = str(pg.get("id") or "")
            html = reuse_pages.get(pid)
            if pid and isinstance(html, str) and html.strip():
                reused[pid] = html
    if reused:
        ok.update(reused)
        print(
            f"[spec_page_html] 按需重画：{len(reused)}/{len(pages)} 页原样沿用上一版"
            f"（{'、'.join(sorted(reused))}），只重画 {len(pages) - len(reused)} 页"
        )
    pages = [pg for pg in pages if str(pg.get("id") or "") not in reused]
    if not pages:
        # 全部照搬：也要把它们推给前端，然后直接收工。
        for i, (pid, html) in enumerate(reused.items(), 1):
            _safe_on_page(on_page, pid, html, i, len(reused))
        return {"pages": dict(ok), "failed": {}}
    # ⚠ **不用 `with`**：ThreadPoolExecutor.__exit__ 是 shutdown(wait=True)，
    #   它会一直等到所有线程跑完——那正是这条截止线要避免的事。用了 with，
    #   截止线只会让日志早一点写，墙钟一秒都省不下来。
    pool = ThreadPoolExecutor(max_workers=min(max_workers, len(pages)))
    try:
        # ⚠ **as_completed，不是按提交顺序 for fut in futures。** 这条是真机
        #   量出来的（2026-08-14，宠物医院一轮）：
        #
        #       [347s] p1  [347s] p2  [348s] p3   ← 三页挤在同一秒
        #       [369s] p4  [369s] p5              ← 又两页挤在一起
        #
        #   五页是并发跑的，可 `fut.result()` **按提交顺序阻塞**：p1 慢，
        #   p2/p3 早就好了也得等它。用户看到的就是"画完了才一起显示"，
        #   而 on_page 这个 sink 存在的全部意义正是"一页好了就交出去"——
        #   接线全通、判据全绿，效果被一行遍历顺序抵消掉。
        #
        #   ⚠ 代价是**产出顺序不再是 spec 的页面顺序**。ok 是 dict 不是 list，
        #     下游按 page_id 取，所以不受影响；真正在乎顺序的是导航，而导航由
        #     page_shell 按 spec.pages 重排（见 unify_shell）——不靠这里。
        def _make_page(pg):
            """一页的活：能局部改就局部改，改不动整页重画。

            ★ 2026-08-17：这是"按需"的第二层。第一层（refine_page_scope）把
              范围从"所有页"缩到"指令点到的页"；这一层再从"整页重画"缩到
              "只改那几行"——用户说的多半是「菜单栏换个图标」「这个模块加点
              数据」，为这个重画整页，既慢又会把没提的地方一起改掉。

            ⚠ 回落方向是**整页重画**，不是"这页不改"。局部改不动是常事
              （模型没给出块、SEARCH 对不上、改完过不了校验），那时退回今天
              的行为即可；退成"不改"会让用户说了话而页面一动不动。
            """
            pid = str(pg.get("id") or "")
            prev = (edit_base or {}).get(pid)
            if prev and (edit_instruction or "").strip():
                try:
                    got = edit_page_html(
                        pg, prev, edit_instruction, llm_call=llm_call,
                        product_archetype=product_archetype,
                    )
                    if got is not None:
                        return got
                except Exception as exc:  # noqa: BLE001 — 局部改属增强，炸了走重画
                    print(f"[spec_page_html] 页面 {pid} 局部改异常，回落整页重画：{str(exc)[:160]}")
            drawn = generate_page_html(
                pg, spec, device=device,
                design_system=_style_for(design_system, pid),
                product=product, product_archetype=product_archetype,
                llm_call=llm_call,
            )
            if prev and isinstance(drawn, dict) and drawn.get("html"):
                from .bind_hole_freeze import freeze_bind_holes

                drawn = dict(drawn)
                drawn["html"] = freeze_bind_holes(prev, str(drawn["html"]))
            return drawn

        fut_to_id = {
            pool.submit(_make_page, pg): str(pg.get("id") or "")
            for pg in pages
        }
        # ⚠ 进度的分母要含照搬的那批，否则前端会显示「3 页里第 1 页」而实际
        #   有 5 页——照搬的先推、编号在前，重画的接着往下数。
        total = len(fut_to_id) + len(reused)
        done = 0
        for pid, html in reused.items():
            done += 1
            _safe_on_page(on_page, pid, html, done, total)
        pending = set(fut_to_id)
        batch_started = time.monotonic()
        # 首页落地之前用不上（那之前不设限），落地时按 _straggler_budget 改写。
        idle_budget = _straggler_idle_seconds()
        # 截止线**锚在"上一次有进展"上，不锚在整批开始**。
        #
        # 锚在开始的话，页数一多就必然误伤：6 页本来就比 3 页久，一个固定的
        # 总时长要么对小批太松、要么对大批太严。锚在"上次有页落地"则跟批量
        # 大小无关，量的是**这批还在不在动**。
        #
        # ★ 但它**只在第一页落地之后才上膛**（2026-08-14 当天真机修回来的）：
        #
        #   头一版从整批开跑就开始计时，结果 120s 的预算在第一张页到达之前
        #   就开火——真机 `got=0 failed=5 missingPages=p1..p5`，整条新链路
        #   被自己的截止线打死、回落老链路。
        #
        #   ⚠ 阈值是我从"页与页之间最大间隔 43s"推的，**而开跑到第一张页
        #     本来就要 150~175s**（单页基准 149.0s）。同一批数据里两个区间
        #     量的是不同的东西，我拿其中一个去卡另一个。
        #
        #   概念上也应当如此：「落后者」的前提是**别人已经到了**。一个都没到
        #   的时候大家都在飞，没有落后者可言。那一段的兜底是每页自己的
        #   LLM 超时与重试（call_llm_with_retry），不归这条线管。
        #
        # ★★ 首页落地的**同时**，顺手拿它的耗时把预算定下来（2026-08-15）。
        #    固定 120s 在真机上误杀了 5 页里的 4 页——不是逻辑错，是那个绝对值
        #    低于这条链路的正常页间方差。详见 `_straggler_budget` 的回算。
        last_progress: Optional[float] = None
        while pending:
            # last_progress 为 None = 还没有任何一页落地 → 不设限，等着
            budget = (
                None
                if last_progress is None
                else max(0.0, idle_budget - (time.monotonic() - last_progress))
            )
            waited, pending = wait(
                pending,
                timeout=budget,
                return_when=FIRST_COMPLETED,
            )
            if not waited:
                # 静默超过预算：剩下的按超时收尾。**不产出占位 HTML**——
                # 与单页失败同一条纪律，缺页由 failedPages / missingPages 说话。
                for fut in pending:
                    page_id = fut_to_id[fut]
                    # ⚠ 报**算出来的**预算，不是那个下限常数。排障时会拿它对
                    #   时间轴做算术（口腔连锁那次正是靠「357.9 + 120 = 477.9
                    #   分毫不差」定位的），印一个从没生效过的数会把人带沟里。
                    failed[page_id] = (
                        f"整批静默超过 {idle_budget:.1f}s（最后一页落地之后再无进展），"
                        f"按超时收尾"
                    )
                    print(f"[spec_page_html] 页面 {page_id} 触发落后者截止线，放弃等待")
                    fut.cancel()  # 只取消**还没开跑**的；已在跑的取消不掉
                break
            now = time.monotonic()
            if last_progress is None:
                first_page_seconds = now - batch_started
                idle_budget = _straggler_budget(first_page_seconds)
                print(
                    f"[spec_page_html] 首页 {first_page_seconds:.1f}s 落地 → "
                    f"落后者预算 {idle_budget:.0f}s"
                    f"（下限 {_straggler_idle_seconds():.0f}s ×{_straggler_multiplier()} "
                    f"上限 {_straggler_max_seconds():.0f}s）"
                )
            last_progress = now
            for fut in waited:
                page_id = fut_to_id[fut]
                done += 1
                try:
                    html = fut.result()["html"]
                    ok[page_id] = html
                    _safe_on_page(on_page, page_id, html, done, total)
                except Exception as exc:  # noqa: BLE001 — 单页失败不拖垮整批
                    failed[page_id] = str(exc)[:200]
                    print(f"[spec_page_html] 页面 {page_id} 生成失败：{str(exc)[:160]}")
    finally:
        # ⚠ wait=False：**不等落后者**，那正是这条截止线的全部意义。
        #   cancel_futures 只能取消还没开跑的；已经在飞的 HTTP 请求停不掉
        #   （同 run_cancel 那条教训：线程里的活取消不了）。所以这里的语义
        #   诚实地说是「**不再等它**」，不是「已经把它停了」——它会在后台
        #   自己跑完然后被丢弃。
        pool.shutdown(wait=False, cancel_futures=True)
    return {"pages": ok, "failed": failed}
