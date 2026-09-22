# -*- coding: utf-8 -*-
"""量清「逐段指纹 0/6」里有多少是内容真被重写、有多少只是 id 换了名字。

## 为什么要量

四次修复之后逐段指纹一直 0/6，交接文档据此判定"内容层面仍会被整段重写"，
方案 1/2/3 的整个选型都建立在这个判断上。但 2026-08-17 真机发现：refine 上下文
只到达第 2 步，第 4/5/6 步铸 id 时对上一版一无所知——**id 每轮重铸**。
那么就算模型把内容一字不差地复现，六段指纹也会全变。

于是 0/6 这个数字**证明不了**"内容被重写"。它跟"内容完全没变、只是 id 换了"
是同一个读数。这个脚本把两者分开。

## 三把尺子

    raw        原样 sha256                        —— 现在在用的那把
    canonical  抹掉 id + 引用换成被引对象的名字 + 列表按内容排序
    names      每段里的人类可读名字集合，算 Jaccard

    raw 变 / canonical 不变  →  纯 id 抖动，内容其实没动
    raw 变 / canonical 也变  →  内容真的被改了
    canonical 变 / names 高  →  骨架在、细节变
"""
import hashlib
import json
import sys

import os

# 模型落盘目录：默认本脚本同级，可用 argv[1] 覆盖
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
SEGMENTS = ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"]

# ⚠ CLASSES / pairs_of_class 提到模块级是给 aggregate_ab.py 复用的（2026-08-17）。
#   多轮聚合要的"逐类 id 保住率"跟这里第四把尺子是同一个算法——照抄一份到
#   聚合脚本里，是纪律四点名的形态，而且更阴：两份算出不同的数还都像对的。
#   改这里的口径，聚合那边自动跟上；反过来也是。
CLASSES = [
    ("datamodel.entities", ["datamodel", "entities"]),
    ("rbac.roles", ["rbac", "roles"]),
    ("rbac.permissions", ["rbac", "permissions"]),
    ("workflow.nodes", ["workflow", "nodes"]),
    ("page.pages", ["page", "pages"]),
    ("aigc.capabilities", ["aigc", "capabilities"]),
]


def pairs_of_class(model, path):
    """取一类对象的 (id, name) 列表。权限是裸字符串，name 为 None。"""
    node = model
    for k in path:
        node = (node or {}).get(k) or []
    out = []
    for x in node:
        out.append((x.get("id"), x.get("name")) if isinstance(x, dict) else (x, None))
    return out


def sha(obj) -> str:
    return hashlib.sha256(
        json.dumps(obj, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:12]


def build_id_to_name(node, acc):
    """全模型走一遍，收集 id → name。引用换名字全靠它。"""
    if isinstance(node, dict):
        i, n = node.get("id"), node.get("name")
        if isinstance(i, str) and isinstance(n, str) and i and n:
            acc.setdefault(i, n)
        for v in node.values():
            build_id_to_name(v, acc)
    elif isinstance(node, list):
        for v in node:
            build_id_to_name(v, acc)
    return acc


def resolve(s, id2name):
    """把一个可能是 id 的字符串换成 «名字»。

    ⚠ 复合 id 要分段解（'elderly:read'、'purchase_request.amount'）：
      这类"实体:动作 / 实体.字段"的引用最多，整串查表必然查不到，
      只按整串解等于这把尺子对权限和字段绑定完全失效。
    """
    if not isinstance(s, str) or not s:
        return s
    if s in id2name:
        return f"«{id2name[s]}»"
    for sep in (":", "."):
        if sep in s:
            head, _, tail = s.partition(sep)
            if head in id2name:
                return f"«{id2name[head]}»{sep}{tail}"
    return s


def canonical(node, id2name):
    """抹 id、解引用、列表按内容排序 —— 只剩"内容长什么样"。"""
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k == "id":
                continue  # 自己的 id 不算内容
            out[k] = canonical(v, id2name)
        return out
    if isinstance(node, list):
        items = [canonical(v, id2name) for v in node]
        # 顺序不算内容差异：同一批角色换个次序不是"被重写"
        return sorted(items, key=lambda x: json.dumps(x, ensure_ascii=False, sort_keys=True))
    return resolve(node, id2name)


def names_in(node, acc):
    if isinstance(node, dict):
        n = node.get("name")
        if isinstance(n, str) and n.strip():
            acc.add(n.strip())
        for v in node.values():
            names_in(v, acc)
    elif isinstance(node, list):
        for v in node:
            names_in(v, acc)
    return acc


def jaccard(a, b):
    if not a and not b:
        return 1.0
    return len(a & b) / len(a | b) if (a | b) else 1.0


def main():
    m1 = json.load(open(f"{OUT}/model_round1.json"))
    m2 = json.load(open(f"{OUT}/model_round2.json"))
    id1, id2 = build_id_to_name(m1, {}), build_id_to_name(m2, {})

    print(f"id→name 表：第一轮 {len(id1)} 条，第二轮 {len(id2)} 条")
    shared = set(id1) & set(id2)
    print(f"两轮共用的 id：{len(shared)} / {len(set(id1) | set(id2))} "
          f"（共用得越少，说明 id 重铸得越彻底）\n")

    hdr = f"{'段':<11}{'raw':<10}{'抹id后':<10}{'名字 Jaccard':<14}结论"
    print(hdr)
    print("-" * len(hdr) * 2)

    raw_same = canon_same = 0
    for seg in SEGMENTS:
        a, b = m1.get(seg), m2.get(seg)
        r = sha(a) == sha(b)
        # ⚠ `r or ...`：两边各用自己的 id→name 表解引用，于是**同一份字节**
        #   可能一边解得开、另一边解不开（引用的对象在新一轮里没了），
        #   canonical 反而判"变"。自检的 B 例就撞到：aigc 原样没动，
        #   raw=同 而 canonical=变，导致"抹 id 后"比 raw 还低——荒谬。
        #   原样相同就是相同，这条兜底保住单调性。悬空引用是另一个问题，
        #   由闸负责，不该混进"内容变没变"这把尺子。
        c = r or sha(canonical(a, id1)) == sha(canonical(b, id2))
        j = jaccard(names_in(a, set()), names_in(b, set()))
        raw_same += r
        canon_same += c
        if r:
            verdict = "完全没变"
        elif c:
            verdict = "★ 内容没变，只是 id 换了"
        elif j >= 0.8:
            verdict = "骨架在，细节变"
        elif j >= 0.4:
            verdict = "改动较大"
        else:
            verdict = "基本重写"
        print(f"{seg:<11}{'同' if r else '变':<10}{'同' if c else '变':<10}{j:<14.2f}{verdict}")

    n = len(SEGMENTS)
    print(f"\n现在在用的判据（raw）：{raw_same}/{n}")
    print(f"抹掉 id 之后：        {canon_same}/{n}")

    # ★ 第四把尺子，也是真正结案的那把（2026-08-17）。
    #
    # ⚠ 上面「抹 id 后」这把**会漏**：权限是裸字符串（'elder:read'）、没有 name
    #   字段，永远进不了 id→name 表，于是解不开、判成"变"。只看它会得出
    #   「id 不是主因」的错误结论——第一版就是这么错的。
    #
    # 逐类数「id 保住几个 / 名字保住几个」躲得开这个坑：名字保住得多而 id
    # 保住得少，就是 id 抖动，不管字符串长什么样。
    print("\n逐类对象：id 与 名字 各保住多少（名字 ≫ id 就是 id 抖动）\n")

    churn = []
    for label, path in CLASSES:
        a, b = pairs_of_class(m1, path), pairs_of_class(m2, path)
        ia, ib = {i for i, _ in a if i}, {i for i, _ in b if i}
        na, nb = {x for _, x in a if x}, {x for _, x in b if x}
        id_keep = f"{len(ia & ib)}/{max(len(ia), len(ib)) or 1}"
        nm_keep = f"{len(na & nb)}/{max(len(na), len(nb)) or 1}" if (na or nb) else "—"
        flag = ""
        if na and nb:
            idr = len(ia & ib) / (max(len(ia), len(ib)) or 1)
            nmr = len(na & nb) / (max(len(na), len(nb)) or 1)
            if nmr - idr >= 0.5:
                flag = "  ★ 名字在、id 全换 → id 抖动"
                churn.append(label)
            elif nmr < 0.4:
                flag = "  真的重写"
        print(f"  {label:<22}个数 {len(a)}→{len(b):<4}id {id_keep:<8}名字 {nm_keep:<8}{flag}")

    if churn:
        print(f"\n→ 这几类是 **id 抖动**（名字保住了、id 没保住）：{'、'.join(churn)}")
        print("  它们的指纹变化不该算进「内容被整段重写」——修 id 稳定化就能拿回来。")
        print("  ⚠ 注意这跟上面「抹 id 后」那一行可能矛盾。矛盾时**信这一段**："
              "\n    上面那把解不开裸字符串 id，会系统性低估 id 抖动。")
    else:
        print("\n→ 没有哪一类是「名字在而 id 全换」：内容确实被改了，id 不是主因。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
