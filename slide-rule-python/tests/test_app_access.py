"""应用访问模型（2026-08-02）。

模型参照 Gitea（MIT）：有序访问级别阶梯 + 单调合成 + Fork 继承私有。

这份测试盯的是**只会朝一个方向出错**的那些性质——权限漏判的后果分两种：
级别偏低（用户会来报"我打不开"）和级别偏高（没人会报，直到数据泄露）。
下面每一条都是在防第二种。
"""

from __future__ import annotations

import pytest

from services.app_access import (
    Access,
    OFFICIAL_OWNER_ID,
    Shelf,
    Visibility,
    access_for,
    can,
    filter_records,
    fork_visibility,
    matches_shelf,
    normalize_visibility,
    require,
    transfer_from_official,
    transfer_to_official,
)


class FakeUser:
    def __init__(self, uid: str, *, superuser: bool = False) -> None:
        self.id = uid
        self.is_superuser = superuser
        self.is_active = True


ALICE = FakeUser("u-alice")
BOB = FakeUser("u-bob")
ROOT = FakeUser("u-root", superuser=True)


def app(**kw):
    base = {"id": "app-1", "owner_id": "u-alice", "visibility": Visibility.PUBLIC}
    base.update(kw)
    return base


# ────────────────────── ① 阶梯与合成 ──────────────────────


def test_access_ladder_is_ordered():
    """判定靠 `>=` 比较，顺序错了整个模型就垮了。"""
    assert Access.NONE < Access.READ < Access.WRITE < Access.OWNER


def test_public_app_is_readable_by_anonymous():
    assert access_for(app(), None) == Access.READ


def test_private_app_is_invisible_to_anonymous_and_others():
    rec = app(visibility=Visibility.PRIVATE)
    assert access_for(rec, None) == Access.NONE
    assert access_for(rec, BOB) == Access.NONE


def test_owner_gets_owner_level_regardless_of_visibility():
    for v in Visibility.ALL:
        assert access_for(app(visibility=v), ALICE) == Access.OWNER


def test_superuser_gets_owner_level_on_anything():
    assert access_for(app(visibility=Visibility.PRIVATE, owner_id="u-someone"), ROOT) == Access.OWNER


def test_explicit_grant_raises_but_never_lowers():
    """显式授权只能抬高级别。

    单调性是这个模型安全性的来源——如果授权能压低，一条写错的授权行就能把
    所有者自己锁在门外，而修复要靠翻库。
    """
    rec = app(visibility=Visibility.PRIVATE, owner_id="u-alice")
    grant = lambda _app, _user: Access.WRITE  # noqa: E731

    assert access_for(rec, BOB, grant_lookup=grant) == Access.WRITE
    # 所有者本来就是 OWNER，一条 WRITE 授权不能把他降下来
    assert access_for(rec, ALICE, grant_lookup=grant) == Access.OWNER


def test_broken_grant_lookup_does_not_grant_access():
    """授权表查询炸了 → 按「没有额外授权」处理，不是按「放行」。"""
    def boom(_a, _b):
        raise RuntimeError("授权表挂了")

    assert access_for(app(visibility=Visibility.PRIVATE), BOB, grant_lookup=boom) == Access.NONE


# ────────────────────── ② 未知值一律保守 ──────────────────────


def test_unknown_visibility_is_treated_as_private():
    """可见性字段脏了（手工改库/迁移写错）时按 private 处理。

    与本项目其他地方"认不出用默认值"的取向相反，是刻意的：把未知值当 public
    等于静默把可能私密的东西放出去。
    """
    assert normalize_visibility("PuBLiC") == Visibility.PUBLIC
    assert normalize_visibility("weird-value") == Visibility.PRIVATE
    assert access_for(app(visibility="typo"), None) == Access.NONE


def test_missing_visibility_keeps_legacy_apps_readable():
    """存量应用没有 visibility 字段 —— 不能让应用中心突然空掉。"""
    legacy = {"id": "old-1", "owner_id": None}
    assert access_for(legacy, None) == Access.READ


def test_legacy_ownerless_apps_are_not_writable():
    """可读但**不可写**：权限一上线不能把历史应用敞开给任何登录用户。"""
    legacy = {"id": "old-1", "owner_id": None}
    assert can("view", legacy, BOB) is True
    assert can("drive", legacy, BOB) is False
    assert can("delete", legacy, BOB) is False
    # 超管仍能处理，迁移期由它认领
    assert can("delete", legacy, ROOT) is True


def test_unknown_action_is_denied():
    """动作名拼错的后果必须是「做不了」，不能是「畅通无阻」。"""
    assert can("delet", app(), ALICE) is False
    assert can("", app(), ROOT) is False


# ────────────────────── ③ 动作所需级别 ──────────────────────


def test_anyone_who_can_read_can_fork():
    """能看就能 Fork（Gitea 同款）。这是产品要的：广场上看到就能拿来改。"""
    assert can("fork", app(), None) is True
    assert can("fork", app(), BOB) is True
    assert can("fork", app(visibility=Visibility.PRIVATE), BOB) is False


def test_driving_requires_write_not_just_read():
    """继续推演会改这个应用的状态，只读的人不能做。"""
    assert can("view", app(), BOB) is True
    assert can("drive", app(), BOB) is False
    assert can("drive", app(), ALICE) is True


def test_reopen_is_write_not_fork():
    """从快照重建工作区要能改这张卡。能看就能 fork，但不能 reopen 别人的。"""
    assert can("reopen", app(), ALICE) is True
    assert can("reopen", app(), BOB) is False
    assert can("fork", app(), BOB) is True
    assert can("reopen", app(), None) is False


def test_only_owner_can_change_visibility_or_delete():
    grant = lambda _a, _u: Access.WRITE  # noqa: E731
    rec = app()
    assert can("set_visibility", rec, BOB, grant_lookup=grant) is False
    assert can("delete", rec, BOB, grant_lookup=grant) is False
    assert can("set_visibility", rec, ALICE) is True


# ────────────────────── ④ Fork 继承私有 ──────────────────────


def test_fork_of_a_private_app_stays_private():
    """私有源复刻后仍私有——这条是后门防线，Gitea git fork 与模板生成都成立。"""
    assert fork_visibility(app(visibility=Visibility.PRIVATE)) == Visibility.PRIVATE


def test_fork_of_a_public_or_unlisted_app_starts_private():
    """对标 Gitea GenerateRepository：复刻进我的应用，要上市场再点公开。

    反：把公开源的复刻写成 public，市场会立刻多一张孪生卡。
    """
    assert fork_visibility(app(visibility=Visibility.PUBLIC)) == Visibility.PRIVATE
    assert fork_visibility(app(visibility=Visibility.UNLISTED)) == Visibility.PRIVATE


def test_fork_visibility_never_downgrades_privacy():
    """穷举一遍：Fork 出来的私密程度**不得低于**源。"""
    rank = {Visibility.PUBLIC: 0, Visibility.UNLISTED: 1, Visibility.PRIVATE: 2}
    for v in Visibility.ALL:
        assert rank[fork_visibility(app(visibility=v))] >= rank[v], f"{v} 的 Fork 被降级了"


# ────────────────────── ⑤ 列表过滤与单条判定必须一致 ──────────────────────


def test_list_never_shows_what_a_direct_open_would_refuse():
    """列表过滤和单条判定是两套代码，漂移就是泄露。

    这条测试是这个文件里最重要的一条：列表少过滤一个条件，私有应用就出现在广场上，
    而单条打开是好的，所以不会有人报 bug。
    """
    records = [
        app(id="pub", visibility=Visibility.PUBLIC, owner_id="u-alice"),
        app(id="unl", visibility=Visibility.UNLISTED, owner_id="u-alice"),
        app(id="pri", visibility=Visibility.PRIVATE, owner_id="u-alice"),
        {"id": "legacy", "owner_id": None},
    ]
    for viewer in (None, ALICE, BOB, ROOT):
        listed = filter_records(records, viewer)
        for rec in listed:
            assert access_for(rec, viewer) >= Access.READ, (
                f"{getattr(viewer,'id','匿名')} 的列表里出现了它打不开的 {rec['id']}"
            )


def test_unlisted_is_reachable_by_link_but_not_in_the_list():
    """unlisted 与 public 的**唯一**区别就在这里。"""
    rec = app(visibility=Visibility.UNLISTED)
    assert access_for(rec, BOB) == Access.READ          # 有链接能开
    assert [r["id"] for r in filter_records([rec], BOB)] == []   # 但不在列表里
    # 自己的和超管仍然看得到
    assert [r["id"] for r in filter_records([rec], ALICE)] == ["app-1"]
    assert [r["id"] for r in filter_records([rec], ROOT)] == ["app-1"]


def test_anonymous_list_contains_only_public_and_legacy():
    records = [
        app(id="pub", visibility=Visibility.PUBLIC),
        app(id="unl", visibility=Visibility.UNLISTED),
        app(id="pri", visibility=Visibility.PRIVATE),
        {"id": "legacy", "owner_id": None},
    ]
    got = {r["id"] for r in filter_records(records, None)}
    assert got == {"pub", "legacy"}


def test_owner_sees_own_private_apps_in_the_list():
    records = [app(id="mine", visibility=Visibility.PRIVATE, owner_id="u-alice")]
    assert [r["id"] for r in filter_records(records, ALICE)] == ["mine"]
    assert filter_records(records, BOB) == []


# ────────────────────── ⑥ 错误码不泄露资源是否存在 ──────────────────────


def test_invisible_resource_reports_404_not_403():
    """403 等于确认「这个 id 确实存在」，可以用来枚举别人的私有应用。"""
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as e:
        require("view", app(visibility=Visibility.PRIVATE), BOB)
    assert e.value.status_code == 404


def test_visible_but_insufficient_reports_403():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as e:
        require("delete", app(), BOB)   # 公开应用看得见，但删不了
    assert e.value.status_code == 403


def test_anonymous_on_a_readable_resource_gets_401_to_prompt_login():
    """看得见但要登录才能做 → 401，前端据此弹登录框（而不是显示"无权限"）。"""
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as e:
        require("drive", app(), None)
    assert e.value.status_code == 401


def test_require_passes_when_allowed():
    require("view", app(), None)
    require("delete", app(), ALICE)
    require("delete", app(visibility=Visibility.PRIVATE, owner_id="x"), ROOT)


# ────────────────────── ⑦ 货架（展示口径，不是第二套权限） ──────────────────────


def test_mine_shelf_is_owner_only_even_for_superuser():
    """⚠ 2026-08-19：原先「我的应用」= filter_records 之后全部可见。
    超管会把自己的、别人的、广场上的混成一墙。货架必须按 owner_id 切。"""
    records = [
        app(id="alice-pub", owner_id="u-alice", visibility=Visibility.PUBLIC),
        app(id="root-own", owner_id="u-root", visibility=Visibility.PRIVATE),
        app(id="bob-pub", owner_id="u-bob", visibility=Visibility.PUBLIC),
    ]
    mine_root = [r["id"] for r in records if matches_shelf(r, Shelf.MINE, ROOT)]
    assert mine_root == ["root-own"]
    mine_alice = [r["id"] for r in records if matches_shelf(r, Shelf.MINE, ALICE)]
    assert mine_alice == ["alice-pub"]
    assert matches_shelf(app(owner_id="u-alice"), Shelf.MINE, None) is False


def test_official_app_is_not_on_the_market_shelf():
    rec = app(is_official=True, visibility=Visibility.PUBLIC)
    assert matches_shelf(rec, Shelf.OFFICIAL, None) is True
    assert matches_shelf(rec, Shelf.MARKET, None) is False
    assert matches_shelf(rec, Shelf.MINE, ALICE) is True


def test_private_owned_app_is_mine_not_market():
    rec = app(visibility=Visibility.PRIVATE, owner_id="u-alice")
    assert matches_shelf(rec, Shelf.MINE, ALICE) is True
    assert matches_shelf(rec, Shelf.MARKET, ALICE) is False
    assert matches_shelf(rec, Shelf.MARKET, None) is False


def test_public_non_official_is_on_the_market():
    rec = app(visibility=Visibility.PUBLIC, is_official=False)
    assert matches_shelf(rec, Shelf.MARKET, None) is True
    assert matches_shelf(rec, Shelf.OFFICIAL, None) is False


def test_transfer_to_official_changes_owner_not_just_a_flag():
    """对标 Gitea transferOwnership：官方货架上的应用归面团官方，不归原作者。"""
    rec = transfer_to_official(app(owner_id="u-alice", visibility=Visibility.PRIVATE))
    assert rec["owner_id"] == OFFICIAL_OWNER_ID
    assert rec["prior_owner_id"] == "u-alice"
    assert rec["is_official"] is True
    assert rec["visibility"] == Visibility.PUBLIC
    assert matches_shelf(rec, Shelf.MINE, ALICE) is False
    assert matches_shelf(rec, Shelf.OFFICIAL, None) is True
    assert matches_shelf(rec, Shelf.MARKET, None) is False


def test_transfer_from_official_returns_the_prior_owner():
    rec = transfer_from_official(
        transfer_to_official(app(owner_id="u-alice", visibility=Visibility.PUBLIC))
    )
    assert rec["owner_id"] == "u-alice"
    assert rec["prior_owner_id"] is None
    assert rec["is_official"] is False
    assert matches_shelf(rec, Shelf.MINE, ALICE) is True
    assert matches_shelf(rec, Shelf.OFFICIAL, None) is False


def test_legacy_flag_without_transfer_still_counts_as_official_shelf():
    """过渡：老数据只打了勾、owner 还是原作者。货架认旗；交还时只摘旗。"""
    rec = app(is_official=True, owner_id="u-alice", visibility=Visibility.PUBLIC)
    assert matches_shelf(rec, Shelf.OFFICIAL, None) is True
    assert matches_shelf(rec, Shelf.MINE, ALICE) is True
    released = transfer_from_official(dict(rec))
    assert released["owner_id"] == "u-alice"
    assert released["is_official"] is False
