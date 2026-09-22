# -*- coding: utf-8 -*-
"""JSON Merge Patch（RFC 7386 / 7396）—— 让"没提到的地方不变"成为**结构保证**。

## 为什么需要它

2026-08-16 一整天在治同一个病：用户在已生成的应用上说一句「某一页的列表是空的，
加点模拟数据」，系统把整个五系统模型重写一遍。三次修复逐级推进：

    48ffe604  指令能到达生成层                    必要，不够
    0f5686e5  精修提示词不再自相矛盾              必要，不够
    fef97cb3  精修模式提到主循环之前才设上下文    **保住了结构**（菜单 3/3、页面不丢）

但线上干净复测（sr-20260816201658）显示：菜单保住了，**六段指纹仍然全变**——
包括跟指令毫不相干的 workflow 和 rbac。而那一轮的指令里明写着「其他页面不要动」。

    从"最小增量"到"逐字节保持"到"其他页面不要动"，能说的都说了，模型照样重写。

前三条都是在**求模型自觉**。Merge Patch 换一个思路：**模型只被允许输出"要改的
那部分"，基线由代码合并**。没提到的段想变也变不了。

## 为什么是 7386 而不是 6902

RFC 6902（JSON Patch）用 op/path 序列，表达力强，但 path 里要写数组下标。
《JSON Whisperer: Efficient JSON Editing with LLMs》(arXiv 2510.04717) 的结论是
**数组下标是补丁生成的主要出错源**——模型很容易写歪。

Merge Patch 不用写下标：给一份形状跟原文档一样、只含要改字段的对象即可。对模型
友好一个档次。代价是它删不掉数组里的单项（只能整段替换数组），对"加点模拟数据"
"改个标题"这类指令足够。

## 实现照 RFC 7386 第 2 节的伪代码逐行来

    define MergePatch(Target, Patch):
      if Patch is an Object:
        if Target is not an Object:
          Target = {}          # 忽略原值，改用空对象
        for each Name/Value pair in Patch:
          if Value is null:
            if Name exists in Target:
              remove the Name/Value pair from Target
          else:
            Target[Name] = MergePatch(Target[Name], Value)
        return Target
      else:
        return Patch

⚠ `null` 是**删除**，不是"设成 null"——这是 Merge Patch 唯一的语义陷阱，也是它
表达不了"把某字段设为 null"的原因。规范原文就这么定的，不要"改良"。

⚠ 数组**整体替换**，不做逐项合并。同样是规范定的：数组走的是 else 分支。

## 2026-08-17：它守的是**老链路**，别再往 spec-first 上接

写这个文件那天接错了插座——挂在 `generate_five_system_model` 上，而那一轮真正
产出模型的是 spec-first。后来没有把它硬塞进 spec-first，因为**方案跟那条链的
架构不兼容**：spec-first 天生"从 spec 树重新生成"，出口永远是完整六段，合并器
看到六段齐全就判"没按补丁交付"、原样放行。这不是接线问题。

现在两条精修路径各有各的机制，**不是重复，是分工**：

    老链路（generate_five_system_model）   Merge Patch —— 模型只吐增量
                                           v5_llm_generate.py:1136 在用，还活着
    spec-first（默认路径）                 逐段沿用 —— 模型声明碰了哪几段，
                                           出口把其余段按住
                                           spec_first_pipeline.apply_refine_segment_reuse

老链路在 spec-first 失败时兜底，所以这个文件**没死、别删**。但也别再试图把它
接到 spec-first 上——那条路走过了，不通。
"""

from __future__ import annotations

import copy
from typing import Any


def merge_patch(target: Any, patch: Any) -> Any:
    """按 RFC 7386 把 patch 合并进 target，返回新对象（不改原参数）。"""
    if not isinstance(patch, dict):
        # 非对象（含数组、标量、None）→ 整体替换。数组不逐项合并，见模块头。
        return copy.deepcopy(patch)

    result = copy.deepcopy(target) if isinstance(target, dict) else {}
    for name, value in patch.items():
        if value is None:
            # null = 删除。这是规范语义，不是"设成 null"。
            result.pop(name, None)
        else:
            result[name] = merge_patch(result.get(name), value)
    return result


def patch_touches(patch: Any) -> list:
    """补丁动到了哪些顶层键 —— 给判据和日志用。

    只看顶层：五系统模型的顶层就是 datamodel/workflow/rbac/page/aigc/appbundle，
    "没提到的段有没有被动"这个问题在这一层就能答。
    """
    return sorted(patch.keys()) if isinstance(patch, dict) else []


def looks_like_full_model(patch: Any, required_sections: tuple) -> bool:
    """模型有没有无视"只给补丁"的要求、直接吐了一份完整模型。

    判据是"六段齐全"。齐全时合并等价于整份替换——**行为退化成修复前，不会更糟**，
    这正是这条路的安全性所在：模型不配合时优雅降级，而不是产出半个模型。

    区分出来只是为了能统计"模型配合率"，不改变合并行为。
    """
    return isinstance(patch, dict) and all(s in patch for s in required_sections)
