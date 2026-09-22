"""全套件测试基线环境（P2a 引入，2026-07-16）。

外呼工具（web.search 真搜索）在测试里全局关闭：测试必须确定性、
不碰网络（CI 无凭据也要绿；维基/搜索供应商的延迟与波动不进测试）。
需要验证工具行为的测试自行 monkeypatch 开关与供应商（见
test_mcp_tools.py）；需要真网络的活体冒烟用
SLIDERULE_LIVE_WEB_TESTS=1 显式开。
"""

import os
import sys
import tempfile
from pathlib import Path

# ── 让 `from app import app` 在**任何**调用方式下都成立（2026-08-09）─────────
#
# 此前没有这一行，而套件里有测试写 `from app import app`（test_v5_smoke.py:15）
# 并在失败时 `pytest.skip(allow_module_level=True)`。后果不是报错，是**整个文件
# 静默跳过**：
#
#     单独跑 tests/test_v5_smoke.py  → 1 skipped（一条都没跑）
#     跑全量                          → 它跑了，而且红 3 条
#
# 差别来自别的测试文件自己做了 `sys.path.insert(0, parent)`（如
# test_gate_field_types.py:33）——先跑到那一个，`app` 才变得可导入。也就是说
# 这个冒烟文件**跑不跑，取决于文件名排序**。
#
# 这比红更糟：单跑是绿的（因为压根没跑），全量是红的，看起来像"环境问题"。
# 路径是全套件的事，就该在 conftest 里定一次。
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("SLIDERULE_WEB_SEARCH", "off")
# 会话存储全套件隔离（E14 揭出的老毛病）：不少路由/驱动测试不各自
# monkeypatch 存储路径，跑一遍 pytest 就往开发库灌几十个 fixture 会话，
# 工作台「我的应用」全是垃圾卡。默认落临时目录；显式设置的测试不受影响。
os.environ.setdefault(
    "SLIDERULE_SESSIONS_FILE",
    str(Path(tempfile.mkdtemp(prefix="sliderule-tests-")) / "sessions.json"),
)
# 应用库全套件隔离（2026-08-05，为一次真实污染补的）。
#
# 上面那条会话隔离的理由，对应用库**一字不差地成立**，而且后果更重：会话
# 灌的是本机开发库，应用库灌的可能是**共享的远端库**。真实发生过——
# .env 里配上 APP_STORE_HTTP_API_URL 指向线上 /db-api 之后跑一遍 pytest，
# 91 行 fixture 应用 + 23 张参照图直接写进了生产库（s1/s2/e6/u4 这些夹具
# id 一看就是测试的），同时 28 条用例因为读到彼此的残留而红。
#
# 那次是"库刚建好还没接应用"，清掉就完事；接上线之后同样一条命令就会往
# 真实用户数据里掺垃圾，而且分不清哪些该删。
#
# 所以三个入口一起按空：HTTP API 两个变量、以及远端 DSN。落到临时 SQLite，
# 每次 pytest 一个新目录，跑完自然消失。
#
# ⚠ 这里只改**默认值**——os.environ 的优先级高于 .env 文件，但显式
# monkeypatch settings 的测试仍然照自己的来（测 Neon/HTTP 后端本身的用例
# 就是这么做的），一条都不会被这段挡住。
_APP_STORE_TEST_DIR = Path(tempfile.mkdtemp(prefix="sliderule-appstore-tests-"))
os.environ.setdefault("APP_STORE_HTTP_API_URL", "")
os.environ.setdefault("APP_STORE_HTTP_API_KEY", "")
os.environ.setdefault(
    "APP_STORE_DATABASE_URL", f"sqlite:///{_APP_STORE_TEST_DIR / 'apps.db'}"
)
os.environ.setdefault("APP_STORE_FILE", str(_APP_STORE_TEST_DIR / "apps.json"))

# P2b 执行类工具同理全局关闭：测试不开真沙盒（活体验证用
# SLIDERULE_LIVE_SANDBOX_TESTS=1 显式开，见 test_mcp_tools.py）
os.environ.setdefault("SLIDERULE_CODE_RUN", "off")
# E32 agentic pick 产品默认 on——测试基线关：驱动循环测试要确定性
# 选材（无 key 时它也只是快速回落，但不该依赖"恰好没配 key"这种巧合）。
# 验证提案行为的测试自行 monkeypatch（见 test_agentic_pick.py 若有）。
os.environ.setdefault("SLIDERULE_AGENTIC_PICK", "off")
# 权限体系上线后（2026-08-02）：推演接口要求登录（匿名只能查看）。
# 全套件里有几十条**验证推演管线**的测试，它们跟身份无关却会被 401 挡住。
#
# 这里给它们一个默认的"已登录"身份，用 FastAPI 的 dependency_overrides 注入。
# 两条纪律：
#   · **不是**让内部密钥绕过登录。Node 代理每个请求都带内部密钥，那样等于
#     线上全部绕过——那才是真正危险的做法。
#   · 关心身份本身的测试（test_auth_identity / test_app_routes_access）用
#     `real_auth` fixture 把这个覆盖摘掉，走真实令牌解析。
os.environ.setdefault("SLIDERULE_AUTH_SECRET", "sliderule-test-secret-" + "x" * 24)
# 内部密钥同理钉死（2026-08-05）。
#
# 套件里几十条路由测试**硬编码**发 `x-internal-key: dev-slide-rule-internal`
# （tests/test_v5_smoke.py:21），而 settings 是从 .env 读的。只要 .env 里配了
# 真密钥，这些请求就全部 403——实测 146 条红，其中 21 条集中在 test_v5_smoke。
#
# 这不是"测试写得不好"，是**隔离漏了一项**：上面会话、应用库、鉴权密钥都按
# 默认值钉过了，唯独这一个漏网。后果比红一片更糟——它红得很像业务回归
# （403/断言失败，不是"缺配置"），真的回归混在里面就看不出来了。
#
# 钉成出厂默认值即可：它本来就是测试里那一串。生产环境沿用默认值会被
# _enforce_non_default_secrets 直接拒绝启动，所以这里钉它不会放松线上。
os.environ.setdefault("SLIDE_RULE_INTERNAL_KEY", "dev-slide-rule-internal")

import pytest  # noqa: E402


#: 默认测试身份的 id。**测试里手工造会话时要把它写进 ownerId**。
#
# 2026-08-09 加：会话是私有的（session_record 恒判 private），无主会话只有超管
# 看得见。所以直接走 service 层 `save_session(V5SessionState(...))` 播种、再用
# TestClient 去 GET/PUT 的测试，会稳定拿到 404——不是鉴权回归，是那条会话确实
# 谁都不属于。播种时带上这个 id，测的才是它自己声称在测的东西。
TEST_USER_ID = "u-test-default"


class _TestUser:
    """默认测试身份：普通登录用户（**不是**超管——超管会掩盖权限不足的 bug）。"""

    id = TEST_USER_ID
    email = "test@example.com"
    is_active = True
    is_superuser = False

    def public(self):
        return {"id": self.id, "email": self.email, "isSuperuser": False}


# ── 历史欠账：钉住的红用 strict xfail，修好了必须摘牌 ──────────────────────
#
# 抄 grok-build 的 xfail 契约（scroll_matrix/runner.rs）：
#     Precedence: any `Fail` (non-xfail violation) fails the cell; else any
#     `XPass` fails it (fixed/rotted xfail must be promoted, not absorbed);
#     else any `XFail` marks the expected failure; else `Pass`.
# 关键在第二句——修好了却还挂在名单上，同样算失败。pytest 的
# `xfail(strict=True)` 就是这个语义，不用自己造。
#
# 名单和每条的"红在哪"在 tests/known_failures.py。


def _ledger_key(nodeid: str) -> str:
    """pytest 的 nodeid → 台账里的键。

    ⚠ 同一条用例的 nodeid 随**在哪儿起跑**而变：

        在 slide-rule-python/ 里跑   tests/test_x.py::test_y
        在仓根跑（CLAUDE.md 写的那条命令）
                                     slide-rule-python/tests/test_x.py::test_y

    台账按后半截存。写死任一种前缀，另一种调用方式下整张名单**静默失效**
    ——不报错，只是 10 条红原样红回来，看起来像"台账没生效"。所以这里
    统一裁到最后一个 `tests/` 之后。
    """
    marker = "tests/"
    idx = nodeid.rfind(marker)
    return nodeid[idx + len(marker) :] if idx >= 0 else nodeid


def pytest_collection_modifyitems(config, items):  # noqa: ARG001
    from known_failures import KNOWN_FAILURES

    for item in items:
        why = KNOWN_FAILURES.get(_ledger_key(item.nodeid))
        if why is None:
            continue
        item.add_marker(
            pytest.mark.xfail(
                strict=True,
                reason=f"历史欠账（tests/known_failures.py）：{why}",
            )
        )


# ⚠️ 套件里有测试会 `importlib.reload(app)`（test_drive_persists_goal.py:92），
# 那会**重建整个 FastAPI app 对象**。而别的模块在收集期就把旧对象绑进了
# 模块级 TestClient。只往"当前那个 app"装覆盖的话，请求走的是旧对象、拿不到
# 覆盖——表现是单独跑绿、全量跑红。所以这里记住见过的每一个实例，一起装。
_seen_apps: list = []


def _all_apps() -> list:
    import sys

    mod = sys.modules.get("app")
    # 还没被导入就**主动导一次**（2026-08-09）。
    #
    # 原来只看 `sys.modules`，于是覆盖能不能装上取决于**测试在哪一行导入 app**：
    #
    #     模块顶层 import（test_v5_smoke.py:15）  → 收集期就在，装得上
    #     测试函数体内 import（持久化契约那几条） → fixture 跑完才导入，装不上
    #
    # 后者的表现是 POST /sessions 返回 401「请先登录后再推演」——看起来像鉴权
    # 回归，其实只是覆盖晚了一步。套件里 4 条契约测试红在这个形状上。
    #
    # 主动导一次就没有先后问题了。上面那些 os.environ 已经在本文件顶部设好，
    # 导入拿到的是测试基线配置。
    if mod is None:
        try:
            import app as _app_mod  # noqa: F401

            mod = sys.modules.get("app")
        except Exception:  # noqa: BLE001 — 纯单元测试的环境可能装不全依赖
            mod = None
    current = getattr(mod, "app", None) if mod else None
    if current is not None and not any(a is current for a in _seen_apps):
        _seen_apps.append(current)
    return list(_seen_apps)


@pytest.fixture(autouse=True, scope="session")
def _gate_health_goes_to_tmp(tmp_path_factory):
    """闸体检的台账落到 tmp，别写进仓里那份真记录。

    ⚠ 2026-09-05 当场踩到：跑一遍全量之后 `data/gate-health.jsonl` 里全是
      `authority-check`、`golden-conv-drive`、`t-capability-plan` 这种**判据里的
      会话 id**——测试把生产记录污染了。那份文件是给几个月后排查用的，
      混进判据的样本，看的人会以为线上真出现过这些会话。
    """
    import os

    os.environ["SLIDERULE_GATE_HEALTH_DIR"] = str(
        tmp_path_factory.mktemp("gate-health")
    )
    yield


@pytest.fixture(autouse=True)
def _default_logged_in_user():
    """全套件默认已登录。用 real_auth fixture 可摘掉。"""
    try:
        from middlewares.current_user import optional_user
    except Exception:  # noqa: BLE001 — 缺依赖时跳过
        yield
        return
    apps = _all_apps()
    for a in apps:
        a.dependency_overrides[optional_user] = lambda: _TestUser()
    try:
        yield
    finally:
        for a in _all_apps():
            a.dependency_overrides.pop(optional_user, None)


@pytest.fixture
def demo_fixture_path(monkeypatch):
    """打开演示域夹具快路径（`SLIDERULE_DEMO_FIXTURE_ENABLED`）。

    这条路 2026-08-10 起在用户路径上**默认关**，理由见
    services/v5_capability_executor._demo_fixture_enabled 的头注（认对了域也
    只有一份 2026-07 冻结的残次品可给）。夹具本身没删，演示/回归照旧要测，
    所以这些用例用这个 fixture 显式把它打开。

    ⚠️ 故意**不做成 autouse、也不写进上面那堆 os.environ.setdefault**：那样
    等于把开关在全套件恢复成"开"，于是没有任何一条用例跑在产品的真实默认
    值上——这次要守住的恰恰是"用户路径不再走夹具"。依赖写在用例签名/
    usefixtures 上，改默认值时红的就是真正依赖它的那几条。
    """
    monkeypatch.setenv("SLIDERULE_DEMO_FIXTURE_ENABLED", "1")
    yield


@pytest.fixture
def real_auth():
    """摘掉默认身份覆盖，走真实的令牌/Cookie 解析。

    关心"匿名会不会被拦住"的测试必须用它——否则默认覆盖会让匿名分支永远测不到。
    """
    from middlewares.current_user import optional_user

    for a in _all_apps():
        a.dependency_overrides.pop(optional_user, None)
    yield
    for a in _all_apps():
        a.dependency_overrides.pop(optional_user, None)
