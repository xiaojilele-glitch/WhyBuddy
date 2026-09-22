"""历史欠账台账：这些用例**现在就是红的**，且已知红在哪。

抄的标准答案：grok-build `xai-grok-pager-pty-harness/src/scroll_matrix/runner.rs`

    /// XPASS row detail: the actionable half of the xfail contract.
    const XPASS_DETAIL: &str = "expected to violate (xfail) but PASSED — the pinned bug got fixed \\
                                or the cell rotted; promote the invariant out of the xfail set";

    /// Precedence: any `Fail` (non-xfail violation) fails the cell; else any
    /// `XPass` fails it (fixed/rotted xfail must be promoted, not absorbed);
    /// else any `XFail` marks the expected failure; else `Pass`.

关键是**第二句**：钉住的 bug 修好了却还挂在名单上，同样算失败。没有这一条，
名单只会越来越长，最后变成一块谁也不敢碰的免检区。

pytest 原生就有这个语义：`xfail(strict=True)`。
    在名单里 + 还是红  → XFAIL，全量跑绿
    在名单里 + 变绿了  → XPASS → **红**，必须从名单里拿出去
    不在名单里 + 红    → 照常红

⚠ 台账不是免罪符，是**账单**。写进来的条件只有一个：这条红**在接手之前就红**，
  而且当下这轮改动不负责它。每条都得写清红在哪——写不清就说明还没看，
  那就别往里加。

⚠ 也**不许**拿它盖新债：新写的代码红了就是红了，名单里加一条等于把
  CLAUDE.md §3 的"闸全绿但东西没了"制度化。

台账现状（2026-08-27 接手时清点，10 条）：
  这轮（M5 → 判据 → UI → 抄标准答案）没碰它们中的任何一处代码。
"""

from __future__ import annotations

from typing import Dict

#: 用例 node id → 红在哪（一句话，写给下一个来还账的人）。
#:
#: node id 用**相对 tests/ 的**写法（`test_x.py::test_y`），和 pytest 自己
#: 报 FAILED 的形状一致，抄进来不用改。
KNOWN_FAILURES: Dict[str, str] = {
    # ── 复刻会话：路由压根没实现这两件事 ─────────────────────────
    "test_fork_session.py::test_fork_marks_goal_as_inherited": (
        "fork_generated_app 里没有 `\"inherited\": True`——复刻来的话题没标注，"
        "看不出这份 goal 是继承的还是用户自己写的"
    ),
    "test_fork_session.py::test_fork_route_sets_owner_and_suppresses_web_search": (
        "fork_generated_app 里没有 `ownerId=viewer.id`——副本会话不归复刻的人所有"
    ),
    # ── 页面骨架：导航项跟 spec 的页面清单对不上（2026-09-05 全部还清）──
    #
    #   曾经五条挂在这儿，写着「五条同源，一个因」。**是两个因混记成一笔**，
    #   于是谁来修都只能修掉一半然后困惑。两个都还了，全表移除，记账如下：
    #
    #   因一：**两侧口径不一致**。导航项是 `nav_tab_label()` 渲染的，
    #     而 `check_shell_consistency` 拿 spec 原名去比——只要有一页名字以
    #     「页」结尾就必然报错。外加 `主页` 没进白名单，「挑战主页」被剥成
    #     「挑战主」。两侧改用同一把尺子 + 补白名单。
    #
    #   因二：**剥「页」该不该分设备**。原来不分设备一律剥，而那条规则是为
    #     手机 390px 底栏挤出来的（2026-08-20 芸编智管：五项，「页」折成第三行）。
    #     去 GitHub 抄了标准答案，两边都看了源码：
    #       手机 `ant-design/ant-design-mobile` tab-bar/demos/demo1.tsx
    #            → title: '首页' / '待办' / '消息' / '我的'，短名不带「页」
    #       桌面 `ant-design/ant-design-pro` src/locales/zh-CN/menu.ts
    #            → '分析页' '监控页' '表单页' '列表页' '详情页' '基础详情页'
    #              '结果页' '异常页' '管理页' …… **14 项带「页」**
    #     结论：**手机剥，桌面不剥**。改完这三条判据自己就绿了——它们期望的
    #     本来就是桌面口径，是产线跟着手机的补丁跑偏了。
    # ── 精修局部打孔：主题 token 脚本混进了 diff ────────────────
    "test_refine_graph_scope.py::Test局部打孔::test_只重打图判点中的页": (
        "没被点中的页也变了：产物里多出 `<script>/* sliderule-theme-tokens */`，"
        "主题注入没有被局部打孔排除掉"
    ),
    # ── 全链路重放：闭环没被追加 ─────────────────────────────
    "test_sliderule_driver_fullpath.py::test_drive_full_appends_runtime_closure_for_real_command_replay": (
        "真命令重放这条路上 runtimeClosure 没被追加（any(...) 为 False）"
    ),
    # ── 事件循环上的裸阻塞 IO ───────────────────────────────
    "test_no_blocking_io_on_event_loop.py::test_异步函数里没有裸的阻塞IO[routes/sliderule_full.py]": (
        "3 处 async 函数里裸调 load_session()："
        "control_turn_stream:1330 / reopen_generated_app:3012 / delete_generated_app:3062。"
        "一处卡住全站请求一起排队"
    ),
}
