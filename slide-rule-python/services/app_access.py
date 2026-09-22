"""应用的访问模型（2026-08-02）。

## 为什么不是通用 RBAC

上一版审查过的那套后台是「角色 → 权限码 → 接口」的通用 RBAC。那个模型适合
**后台管理系统**（固定的一批人、固定的一批菜单），不适合这里：这边是**每个用户
产出自己的应用、别人可以浏览和 Fork**，权限依附在**资源**上而不是菜单上。

同样形状的成熟产品是代码托管：仓库有所有者、有公开/私有、能被 Fork、Fork 有血缘。
所以模型参照 **Gitea**（MIT，拉到本地读了 `models/perm` 与 `services/repository`）：

  · **有序的访问级别阶梯**（`models/perm/access_mode.go:17`）
        None(0) < Read(1) < Write(2) < Owner(3)
    判定全部是 `>= ` 比较，没有权限矩阵。加一个新动作只要问"它至少需要哪一级"，
    而不是去矩阵里补一行——后者正是那套 RBAC 后来长到 92 个路由文件还漏一半的原因。

  · **单调的合成顺序**（`models/perm/access/access.go:36`）
        起点 None → 公开的给 Read → 匿名到此为止 → 所有者直接 Owner → 否则查显式授权
    每一步**只能抬高、不能压低**。这个性质让"漏了某个分支"的后果是**权限不足**
    （用户会来报），而不是**权限过大**（没人会来报）。

  · **复刻不是 git fork**（2026-08-19）
        Gitea 有两条路：`fork.go:97` 继承源可见性（协作网络），
        `template.go:85` `IsPrivate: opts.Private`（从模板生成，可见性独立）。
        面团的「复刻」是拿一份自己改，对标后者：默认 private，要上市场再点公开。
        git fork 那条仍禁止「私有被复刻后变公开」（后门）。

  · **官方是所有权转让，不是打勾**（对标 `transfer.go` `repo.OwnerID = newOwner.ID`）
        GitHub/Gitea 的官方仓库归官方组织。超管把应用送上官方货架 = 把
        `owner_id` 改成面团官方主体，不是在别人的应用上插一面旗。
        `is_official` 仍留下作为货架投影和存量过渡；交还时按 `prior_owner_id` 转回去。

## 三档可见性

    public    列在应用中心，任何人可看（含匿名）
    unlisted  不列出，但有链接就能看（对标 YouTube 不公开列表 / GitHub Gist）
    private   只有所有者与被显式授权的人可看

`unlisted` 值得单独一档：产品里"我想把这个分享给同事看，但不想挂在广场上"是很常见
的诉求。只有 public/private 两档时，用户为了分享就只能设成 public。

## 存量数据

`owner_id` 为空的历史应用：**可读（沿用现状），不可写**（超管除外）。
判成可写等于权限一上线就把所有历史应用敞开；判成不可读则会让应用中心突然空掉。
读写分开处理，两边都不激进。
"""

from __future__ import annotations

from enum import IntEnum
from typing import Any, Optional, Protocol

# ────────────────────────── 访问级别 ──────────────────────────


class Access(IntEnum):
    """有序阶梯，判定用 `>=`（对齐 Gitea models/perm/access_mode.go:17）。

    刻意**不设 Admin 档**：超管是正交的全局身份，不是资源上的一级。混进阶梯里会
    让"这个资源的管理员"和"系统超管"两个概念纠缠。
    """

    NONE = 0
    READ = 1
    WRITE = 2
    OWNER = 3

    def label(self) -> str:
        return {0: "none", 1: "read", 2: "write", 3: "owner"}[int(self)]


class Visibility:
    PUBLIC = "public"
    UNLISTED = "unlisted"
    PRIVATE = "private"

    ALL = (PUBLIC, UNLISTED, PRIVATE)
    DEFAULT = PUBLIC


class Shelf:
    """应用中心三个货架。⚠ 2026-08-19：原先「我的应用」其实是
    filter_records 之后的全部可见记录——超管把自己的、别人的、广场上的
    混在一墙。货架是展示口径，不是第二套权限。"""

    MARKET = "market"
    MINE = "mine"
    OFFICIAL = "official"
    ALL = (MARKET, MINE, OFFICIAL)


#: 面团官方主体。不是某个超管的登录 id——超管自己创建的应用仍在「我的应用」。
#: 对标 Gitea/GitHub 的官方组织命名空间，不对应可登录账号。
OFFICIAL_OWNER_ID = "system:official"


def normalize_visibility(value: Optional[str]) -> str:
    """认不出的一律按**最保守**的档处理。

    与本项目其他地方"认不出就用默认值"的取向相反，是刻意的：可见性字段脏了
    （手工改库、迁移写错）时，把未知值当 public 等于把可能私密的东西публично 放出去。
    宁可让用户来问"我的应用怎么看不见了"，也不要静默泄露。
    """
    v = (value or "").strip().lower()
    if not v:
        return Visibility.DEFAULT  # 真的没设置 → 用默认（存量应用就是这种）
    return v if v in Visibility.ALL else Visibility.PRIVATE


# ────────────────────────── 用户视角 ──────────────────────────


class Viewer(Protocol):
    """访问者。只用到三样，避免把 identity_store.User 绑死进来——测试里可以传桩。"""

    @property
    def id(self) -> str: ...

    @property
    def is_superuser(self) -> bool: ...

    @property
    def is_active(self) -> bool: ...


def _viewer_id(viewer: Any) -> Optional[str]:
    if viewer is None:
        return None
    vid = getattr(viewer, "id", None)
    return str(vid) if vid else None


def _is_super(viewer: Any) -> bool:
    return bool(viewer is not None and getattr(viewer, "is_superuser", False))


# ────────────────────────── 合成 ──────────────────────────

# 显式授权表：app_id + user_id → 级别。现在只有 Fork/协作两个来源，
# 表结构留在 app_store 里，这里只消费。
GrantLookup = Any  # Callable[[str, str], Access] | None


def access_for(
    record: dict[str, Any],
    viewer: Any = None,
    *,
    grant_lookup: GrantLookup = None,
) -> Access:
    """算出 viewer 对这条应用记录的访问级别。

    合成顺序严格照 Gitea `accessLevel`（access.go:36）——**每一步只抬不压**：

        ① 起点 NONE
        ② 公开/不公开列表 → READ（匿名也算）
        ③ 匿名到此为止
        ④ 超管 → OWNER
        ⑤ 所有者 → OWNER
        ⑥ 显式授权 → 取其级别
        ⑦ 取以上最大值

    这个单调性是安全性的来源：任何一处漏判的后果都是**级别偏低**（用户会报"我
    打不开"），而不是**级别偏高**（没人会报，直到出事）。
    """
    mode = Access.NONE
    visibility = normalize_visibility(record.get("visibility"))
    owner_id = (record.get("owner_id") or "") or None

    # ② 公开与不公开列表都给读。两者的差别在**列表查询**里体现（见 visible_filter），
    #    不在这里——能拿到 record 说明已经知道 id 了。
    if visibility in (Visibility.PUBLIC, Visibility.UNLISTED):
        mode = Access.READ
    # 存量应用（没有 owner_id、没有 visibility）保持可读，避免应用中心突然空掉
    elif owner_id is None and not record.get("visibility"):
        mode = Access.READ

    viewer_id = _viewer_id(viewer)
    # ③ 匿名：到此为止。停用的账号同理（optional_user 已经把它们变成 None）
    if viewer_id is None:
        return mode

    # ④ 超管：包括处理无主的存量数据
    if _is_super(viewer):
        return Access.OWNER

    # ⑤ 所有者
    if owner_id is not None and owner_id == viewer_id:
        return Access.OWNER

    # ⑥ 显式授权
    if grant_lookup is not None:
        try:
            granted = grant_lookup(str(record.get("id") or ""), viewer_id)
        except Exception:  # noqa: BLE001 — 授权表查不到时按"没有额外授权"处理
            granted = Access.NONE
        if granted and int(granted) > int(mode):
            mode = Access(int(granted))

    return mode


# ────────────────────────── 动作 → 所需级别 ──────────────────────────
#
# 加新动作时只在这里补一行，不需要动判定逻辑。这正是阶梯模型相对权限矩阵的好处。

REQUIRED: dict[str, Access] = {
    "view": Access.READ,        # 打开应用、看缩略图
    "fork": Access.READ,        # 能看就能 Fork（Gitea 同款：可读即可 Fork）
    "drive": Access.WRITE,      # 继续推演（会改这个应用的状态）
    "rename": Access.WRITE,
    "revise": Access.WRITE,     # 出新版本
    "set_visibility": Access.OWNER,
    "grant": Access.OWNER,      # 把权限分给别人
    "delete": Access.OWNER,
    # 从快照重建工作区（对照 GitHub create codespace）。不是 fork：
    # 还是这一张卡，只换一台工作区。要能改这个应用。
    "reopen": Access.WRITE,
}


def can(action: str, record: dict[str, Any], viewer: Any = None, **kw: Any) -> bool:
    """能不能对这条记录做这个动作。

    未知动作**一律拒绝**——拼错动作名的后果必须是"做不了"，不能是"畅通无阻"。
    """
    need = REQUIRED.get(action)
    if need is None:
        return False
    return access_for(record, viewer, **kw) >= need


def require(action: str, record: dict[str, Any], viewer: Any = None, **kw: Any) -> None:
    """不满足就抛 HTTPException。

    404 vs 403 的取舍：**看不见的资源报 404**，而不是 403。报 403 等于确认
    "这个 id 确实存在"，可以被用来枚举别人的私有应用。能看见但权限不够才报 403。
    """
    from fastapi import HTTPException

    level = access_for(record, viewer, **kw)
    need = REQUIRED.get(action)
    if need is None:
        raise HTTPException(status_code=403, detail="不支持的操作")
    if level >= need:
        return
    if level < Access.READ:
        raise HTTPException(status_code=404, detail="应用不存在")
    if _viewer_id(viewer) is None:
        raise HTTPException(status_code=401, detail="请先登录", headers={"WWW-Authenticate": "Bearer"})
    raise HTTPException(status_code=403, detail="没有权限执行该操作")


# ────────────────────────── Fork ──────────────────────────


def fork_visibility(source_record: dict[str, Any]) -> str:
    """复刻出来的应用用什么可见性。

    ⚠ 2026-08-19：面团的复刻对标 Gitea `GenerateRepository`
    （`services/repository/template.go:85`，`IsPrivate: opts.Private`），
    **不是** git fork（`fork.go:97` 继承源可见性）。从市场复刻一张公开卡
    若跟着公开，等于立刻又上架一份——要上市场请在「我的应用」里点公开。

    私有源仍然不得升级为公开：那是绕过私有的后门，Gitea fork 那条没丢。
    """
    return Visibility.PRIVATE


# ────────────────────────── 列表过滤 ──────────────────────────


def visible_filter(viewer: Any = None) -> dict[str, Any]:
    """应用中心列表应该看到哪些。返回一个描述，由存储层翻译成各自的 SQL/谓词。

    三条规则：
      · 匿名：只有 public（**unlisted 不进列表**——这正是它与 public 的唯一区别）
      · 登录用户：public + 自己的（任何可见性）+ 被显式授权的
      · 超管：全部

    ⚠️ 列表过滤和单条判定是**两套代码**，很容易漂移（列表漏过滤 = 私有应用出现在
    广场上）。所以 `filter_records` 用 `access_for` 逐条复核，两套必须给出一致结论，
    有测试盯着这件事。
    """
    if _is_super(viewer):
        return {"scope": "all"}
    viewer_id = _viewer_id(viewer)
    if viewer_id is None:
        return {"scope": "public_only"}
    return {"scope": "public_plus_own", "viewer_id": viewer_id}


def normalize_shelf(value: Optional[str]) -> Optional[str]:
    """列表 `scope=`。空 = 不按货架切（兼容老调用）。认不出 → None。"""
    v = (value or "").strip().lower()
    if not v or v == "all":
        return None
    return v if v in Shelf.ALL else None


def is_official_app(record: dict[str, Any]) -> bool:
    """官方货架投影。货架看旗；所有权看 owner_id == OFFICIAL_OWNER_ID。
    移交时两份一起写，旗留下是为了存量过渡和 SQL 货架谓词。"""
    value = record.get("is_official") if isinstance(record, dict) else None
    if value is True or value == 1:
        return True
    if isinstance(value, str) and value.strip().lower() in ("1", "true", "yes"):
        return True
    return False


def is_official_owner(owner_id: Any) -> bool:
    return (owner_id or None) == OFFICIAL_OWNER_ID


def transfer_to_official(record: dict[str, Any]) -> dict[str, Any]:
    """把应用交给面团官方。对标 Gitea `transferOwnership`：改 OwnerID。

    第一次移交才记下 prior_owner_id，交还时转回去。已经在官方名下不再覆盖原主。
    官方货架给人看，顺手公开（unlisted 除外）。
    """
    owner = record.get("owner_id") or None
    if not is_official_owner(owner):
        if not record.get("prior_owner_id"):
            record["prior_owner_id"] = owner
        record["owner_id"] = OFFICIAL_OWNER_ID
    record["is_official"] = True
    if normalize_visibility(record.get("visibility")) != Visibility.UNLISTED:
        record["visibility"] = Visibility.PUBLIC
    return record


def transfer_from_official(record: dict[str, Any]) -> dict[str, Any]:
    """从官方货架交还。有 prior_owner_id 才改回 OwnerID；没有则只摘旗
    （存量「只打勾没转让」的应用，所有者本来就是原作者）。"""
    prior = record.get("prior_owner_id") or None
    if is_official_owner(record.get("owner_id")) and prior:
        record["owner_id"] = prior
    record["prior_owner_id"] = None
    record["is_official"] = False
    return record


def matches_shelf(
    record: dict[str, Any],
    shelf: Optional[str],
    viewer: Any = None,
) -> bool:
    """这条记录进哪个货架。权限仍由 filter_records / access_for 把关。

    · market   — 公开、且不是官方（广场）
    · mine     — owner_id == 当前用户（新建 / Fork 都落这里；超管也不例外）
    · official — is_official
    """
    if not shelf:
        return True
    official = is_official_app(record)
    if shelf == Shelf.OFFICIAL:
        return official
    if shelf == Shelf.MINE:
        vid = _viewer_id(viewer)
        return bool(vid) and (record.get("owner_id") or None) == vid
    if shelf == Shelf.MARKET:
        return (not official) and normalize_visibility(record.get("visibility")) == Visibility.PUBLIC
    return False


def filter_records(
    records: list[dict[str, Any]], viewer: Any = None, *, grant_lookup: GrantLookup = None
) -> list[dict[str, Any]]:
    """在内存里过滤（JSON/小数据量后端用）。

    实现上直接复用 `access_for`，而不是另写一套条件——列表与单条判定漂移是这类
    系统最常见的泄露方式（列表少过滤一个条件，私有应用就出现在广场上）。
    """
    out = []
    for rec in records:
        if access_for(rec, viewer, grant_lookup=grant_lookup) < Access.READ:
            continue
        # unlisted 能直接打开但**不进列表**——这是它与 public 的唯一区别
        if normalize_visibility(rec.get("visibility")) == Visibility.UNLISTED:
            vid = _viewer_id(viewer)
            owned = vid is not None and (rec.get("owner_id") or None) == vid
            if not (_is_super(viewer) or owned):
                continue
        out.append(rec)
    return out


# ────────────────────────── 会话（2026-08-06）──────────────────────────
#
# 会话此前**完全没有隔离**：sliderule_session 表只有 session_id/payload/rev/
# created_at/last_active，5 条路由（list/create/get/save/delete）没有一条带
# viewer。实测匿名可以列出全站所有人的会话（连业务目标原文都出来）、可以读
# 任意 id 的完整状态、可以直接删掉别人的会话。
#
# 这里**不新写一套判定**，把会话转成上面 access_for 认识的记录形状即可——
# 应用侧那套阶梯照抄 Gitea accessLevel（models/perm/access/access.go:36），
# 已经过一轮实战；再写一份的唯一结果是两边漂移。
#
# 两处会话特有的取值：
#
# ① 可见性恒为 private。会话是"正在进行的工作台"，没有"公开分享一个会话"这个
#    产品概念（要分享的是**应用**，那边有完整的 public/unlisted/private）。
#    写死而不是加字段，是为了不引入一个没人设置、永远是默认值的旋钮。
#
# ② 无主（ownerId 为空）保持可读——与应用侧存量数据同一条规则
#    （access_for 里"存量应用（没有 owner_id、没有 visibility）保持可读"）。
#    理由与取舍：
#      · 真正要防的是**登录用户之间**互相看到对方的业务内容，这条已经解决：
#        登录后建的会话带 ownerId，只有本人和超管能碰。
#      · 无主的只有两类——这个字段存在之前的存量数据，和匿名建的。前者是
#        演示/夹具，后者本来就没有"谁的"可言。把它们一刀切成不可读，会让
#        匿名用户连自己刚建的会话都读不回来。
#      · 想彻底清零：跑 scripts/backfill_session_owner.py 把能推断的补上，
#        剩下的直接删。


def session_record(payload: dict[str, Any]) -> dict[str, Any]:
    """把会话 payload 转成 access_for 认识的记录形状。

    payload 是唯一真相（V5SessionState.ownerId）；数据库那个 owner_id 列只是
    可查询的投影，判定不读它——否则列一旦没补上（老库、文件后端）就会静默
    变成"人人可读"。
    """
    owner = str((payload or {}).get("ownerId") or "").strip() or None
    return {
        "id": str((payload or {}).get("sessionId") or ""),
        "owner_id": owner,
        # **恒为 private，无主也一样**（2026-08-06 用户裁决"方案 B"之后收紧）。
        #
        # 原来无主留空 visibility，走 access_for 里"存量数据保持可读"那一支——
        # 跟应用侧存量数据同一条规则。方案 B 之后这条规则失去了理由：建会话
        # 已经要求登录，正常路径上不再产生无主会话。剩下的唯一来源是**本机
        # 文件存档自动导入**（启动时把 data/sliderule-sessions.json 灌进库，
        # 那批天然没有归属）——那种更不该人人可见。
        #
        # 结果：无主会话只有超管看得到（access_for 第 ④ 步）。
        "visibility": Visibility.PRIVATE,
    }


def session_access(payload: dict[str, Any], viewer: Any = None) -> Access:
    return access_for(session_record(payload), viewer)


def can_session(action: str, payload: dict[str, Any], viewer: Any = None) -> bool:
    return can(action, session_record(payload), viewer)


def require_session(action: str, payload: dict[str, Any], viewer: Any = None) -> None:
    """不够级别就抛 —— 与应用侧同一个异常形状（404/403 由 require 决定）。"""
    require(action, session_record(payload), viewer)


def filter_sessions(
    payloads: list[dict[str, Any]], viewer: Any = None
) -> list[dict[str, Any]]:
    """列表过滤。与单条判定共用 session_access，不另写条件——列表漏一个条件
    就是"别人的会话出现在侧栏里"，而单条打开是好的，所以没人会报 bug。
    """
    return [p for p in payloads if session_access(p, viewer) >= Access.READ]
