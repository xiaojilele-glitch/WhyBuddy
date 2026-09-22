"""技能注水炸了不许拖垮 project_start。

## 事故（2026-09-20 code review）

skill_hydrate.files_for_owner 的 docstring 写着「失败 fail-open 成空图，
不拖垮 project_start」——但契约只兑现了一半：

    files_for_owner      try/except 全包            ✅ 目录/清单这一半是 fail-open
    write_skill_files    write_files(handle, batch) ❌ 裸调，E2B 写一抖就抛
    hydrate_owner_into   直接转调，也没兜

而调用点 ProjectRuntimeService.start 把它放在 try 里，**except 会销毁刚建好的
沙盒、让整个 project_start 失败**。技能注水是增强类，按 §7 炸了不许拖垮主链路：
工程本身没有它照样能跑，少几个技能目录而已。

⚠ 只测 hydrate_owner_into 自己不算数——那证明不了产线那条链不会被拖垮
  （§3：函数写对了 ≠ 它接在链路上）。所以下面第二组**直接查产线源码**，
  钉住调用点还在 try 里、而被调方自己兜住。
"""
import ast
import pathlib

import pytest

from services.skill_hydrate import (
    SKILL_SANDBOX_PREFIX, hydrate_owner_into, write_skill_files)

RUNTIME_SRC = pathlib.Path(__file__).resolve().parents[1] / "services" / "project_runtime.py"


class _Boom(RuntimeError):
    pass


@pytest.fixture
def 有技能可写(monkeypatch):
    """⚠ 必须让 files_for_owner 返回**非空**，否则 write_skill_files 开头
    `if not files: return 0` 直接短路，write_files 根本不会被调用——
    第一版判据就是这样"通过"的，把 try 拿掉照样绿（§3：通过的理由是错的）。
    这个 fixture 保证真的走到写沙盒那一步。
    """
    prefix = SKILL_SANDBOX_PREFIX + "/"
    monkeypatch.setattr("services.skill_hydrate.files_for_owner",
                        lambda owner_id, **kw: {f"{prefix}alpha/SKILL.md": "a"})


def test_写沙盒抛异常时注水返回0而不是向上抛(有技能可写):
    called = []

    def explode(handle, batch):
        called.append(batch)
        raise _Boom("E2B write exploded")

    assert hydrate_owner_into(explode, object(), "owner-x") == 0
    assert called, "write_files 必须真的被调到——否则这条判据什么都没验"


@pytest.mark.parametrize("exc", [_Boom("boom"), TimeoutError("slow"), OSError("socket"), MemoryError()])
def test_任何写异常都被兜住(exc, 有技能可写):
    called = []

    def explode(handle, batch):
        called.append(batch)
        raise exc

    assert hydrate_owner_into(explode, object(), "owner-x") == 0
    assert called


def test_正常路径仍然把文件写下去_没被兜底顺手吞掉():
    """反向：兜底不许把成功也一起吃了。"""
    seen = []

    def record(handle, batch):
        seen.append(batch)

    # ⚠ 用**产线真实前缀** SKILL_SANDBOX_PREFIX 拼路径，不自己编一个 skills/。
    #   第一版就是编的，三个文件全落进同一批——判据红了，红的是判据不是代码（§一之二）。
    prefix = SKILL_SANDBOX_PREFIX + "/"
    written = write_skill_files(record, object(), {
        f"{prefix}alpha/SKILL.md": "a", f"{prefix}alpha/run.py": "b", f"{prefix}beta/SKILL.md": "c"})
    assert written == 3
    # 按技能分批，不跟工程 8MiB 清单挤一次 write_files
    assert len(seen) == 2


def test_产线调用点确实在那条会销毁沙盒的try里():
    """§1：判据要盯真跑的那条路，不是我记得的那条。

    调用点一旦挪出 try（或 start 不再 except 销毁），这条会红——
    那时该重新想兜底还要不要，而不是让判据继续绿着。
    """
    tree = ast.parse(RUNTIME_SRC.read_text(encoding="utf-8"))
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Try):
            continue
        for child in ast.walk(node):
            if (isinstance(child, ast.Call) and isinstance(child.func, ast.Name)
                    and child.func.id == "hydrate_owner_into"):
                found.append(node)
    assert found, "产线源码里 hydrate_owner_into 不在任何 try 里了——兜底前提变了"


def test_剥注释后源码里调用点仍然裸调_兜底只能在被调方():
    """⚠ 按 §2 先剥注释再匹配：上面那段事故说明里写满了 hydrate_owner_into。

    钉住修复位置：兜底做在 skill_hydrate 里，调用点保持一行裸调。
    如果哪天有人改成在调用点包 try，这条会提示两处都有兜底、该收一处。
    """
    code = "\n".join(line.split("  #")[0] for line in
                     RUNTIME_SRC.read_text(encoding="utf-8").splitlines()
                     if not line.strip().startswith("#"))
    assert "hydrate_owner_into(" in code
    assert code.count("hydrate_owner_into(") == 1
