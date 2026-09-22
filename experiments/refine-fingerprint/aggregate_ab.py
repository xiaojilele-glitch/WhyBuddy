# -*- coding: utf-8 -*-
"""把多轮 A/B 的 runs/ 聚合成一张表 —— 并**顺带把网关故障率量出来**。

## 跟 analyze_ids.py 的分工

`analyze_ids.py` 是**单次**两版模型的显微镜（三把尺子 + 逐类 id/名字）。
这个脚本是**多次**的望远镜：每轮只取"逐类 id 保住率"这一个标量，然后按臂
汇总成 mean ± 全距，让 n=1 的"方向"变成有幅度的结论。

⚠ 逐类 id 保住率的算法**直接从 analyze_ids 导入**，不重写一份。
   同一个指标两处实现是本仓纪律四点名的形态（"改一条不改另一条不会报错，
   只会有一半不生效"）——这里更阴，两份算法算出不同的数还都像对的。

## 第二件事：网关故障率（交接文档说"没有任何地方统计"）

跑 A/B 会顺手产出十几轮真机日志，那正是统计这个的样本，白扔可惜。
从 run.log 里挖三类，都是这个中转站已知会犯的：

    [llm-retry] 第 N/3 次失败      → 连接层失败（RemoteProtocolError 等）
    客服话术特征                    → 网关把自己的问候语当结果返回（文档记过两次）
    结构/JSON 解析失败              → 拿到 200 但不是要的东西

⚠ 这三类都**不该**用来判 A/B 成败——它们是环境噪声，不是处理效应。分开报，
  是为了回答"这轮数据可不可信"，以及给那条一直没人量的隐患一个初值。
"""
import json
import os
import re
import sys
from collections import defaultdict

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from analyze_ids import pairs_of_class, CLASSES  # noqa: E402


def _seg_fp(seg) -> str:
    """段指纹。判断"这一段有没有被沿用"的**事实依据**——跟日志说什么无关。"""
    import hashlib

    return hashlib.sha256(
        json.dumps(seg, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:12]


def keep_rate(m1, m2, path):
    """一类对象的 id 保住率与名字保住率。分母用两版里较大的个数——
    个数本身会变（3 实体 → 5 实体），用较大者才不会把"变多了"读成"保住了"。"""
    a, b = pairs_of_class(m1, path), pairs_of_class(m2, path)
    ia, ib = {i for i, _ in a if i}, {i for i, _ in b if i}
    na, nb = {x for _, x in a if x}, {x for _, x in b if x}
    di = max(len(ia), len(ib))
    dn = max(len(na), len(nb))
    return {
        "id": (len(ia & ib) / di) if di else None,
        "name": (len(na & nb) / dn) if dn else None,
        "n1": len(a),
        "n2": len(b),
    }


GATEWAY_PATTERNS = {
    "llm_retry_fail": re.compile(r"\[llm-retry\] 第 \d+/\d+ 次失败"),
    # 网关问候语。文档记过两次真实样本：「你好！我是 OuYi（欧亿 AI 助手）…」
    "gateway_boilerplate": re.compile(r"OuYi|欧亿|我是[^\n]{0,12}(AI )?助手"),
    "json_parse_fail": re.compile(r"json.{0,20}(解析失败|parse\s*(error|failed)|not valid)", re.I),
    "reuse_applied": re.compile(r"精修沿用上一版模型段：(.+)"),
    "freeze_on": re.compile(r"精修 id 冻结："),
    "freeze_off": re.compile(r"id 冻结被开关关掉"),
}


def mine_log(path):
    out = defaultdict(int)
    reused = []
    if not os.path.exists(path):
        return out, reused
    text = open(path, encoding="utf-8", errors="replace").read()
    for name, pat in GATEWAY_PATTERNS.items():
        found = pat.findall(text)
        out[name] = len(found)
        if name == "reuse_applied":
            reused = [f if isinstance(f, str) else f[0] for f in found]
    out["lines"] = text.count("\n")
    return out, reused


def fmt(v):
    return "—" if v is None else f"{v:.2f}"


def main():
    runs_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(_HERE, "runs")
    if not os.path.isdir(runs_dir):
        print(f"没有这个目录：{runs_dir}")
        return 1

    per_arm = defaultdict(lambda: defaultdict(list))
    gw = defaultdict(lambda: defaultdict(int))
    reuse_log = defaultdict(list)
    counted = defaultdict(int)
    skipped = []

    for name in sorted(os.listdir(runs_dir)):
        d = os.path.join(runs_dir, name)
        if not os.path.isdir(d):
            continue
        arm = name.split("-")[0]
        f1, f2 = os.path.join(d, "model_round1.json"), os.path.join(d, "model_round2.json")

        g, reused = mine_log(os.path.join(d, "run.log"))
        for k, v in g.items():
            gw[arm][k] += v
        if reused:
            reuse_log[arm].append((name, reused))

        # ⚠ 只统计**自证通过**的轮次（OK 标记由 ab_multi_run 写）。少了这一条，
        #   开关没生效的那轮会被当成正常数据混进来，直接污染两臂对比。
        if not os.path.exists(os.path.join(d, "OK")):
            skipped.append(name)
            continue
        if not (os.path.exists(f1) and os.path.exists(f2)):
            skipped.append(name)
            continue

        m1, m2 = json.load(open(f1)), json.load(open(f2))
        counted[arm] += 1
        for label, path in CLASSES:
            r = keep_rate(m1, m2, path)
            if r["id"] is not None:
                per_arm[arm][label].append(r["id"])

    print(f"runs 目录：{runs_dir}")
    print(f"纳入统计：{dict(counted)}    跳过（未自证/不全）：{skipped or '无'}\n")

    arms = [a for a in ("off", "on") if a in per_arm]
    if not arms:
        print("没有可统计的轮次。")
        return 1

    print("=" * 78)
    print("逐类 id 保住率（每轮一个值，下面是 mean，括号内为各轮原始值）")
    print("=" * 78)
    hdr = f"{'对象':<24}{'OFF mean':<11}{'ON mean':<11}{'差值':<9}"
    print(hdr)
    print("-" * 78)
    for label, _ in CLASSES:
        vals = {a: per_arm[a].get(label, []) for a in arms}
        means = {a: (sum(v) / len(v) if v else None) for a, v in vals.items()}
        off_m, on_m = means.get("off"), means.get("on")
        delta = (on_m - off_m) if (off_m is not None and on_m is not None) else None
        star = ""
        if delta is not None and delta >= 0.3:
            star = "  ★"
        print(f"{label:<24}{fmt(off_m):<11}{fmt(on_m):<11}{fmt(delta):<9}{star}")
        for a in arms:
            raw = "、".join(f"{v:.2f}" for v in vals[a]) or "—"
            print(f"{'':<24}  {a}: {raw}")

    print("\n" + "=" * 78)
    print("词表覆盖：哪些类被 model_id_lexicon 真正干预了")
    print("=" * 78)
    # ⚠ 2026-08-17 修正：第一版把 page.pages 和 aigc.capabilities 一起标成
    #   "未干预"，**这是错的**，会把两种完全不同的东西读成同一回事：
    #     · aigc 不在词表里，但它在 REFINE_REUSABLE_SEGMENTS 里——沿用一旦过闸
    #       就整段照搬，id 自然全同。它的改善是**经由沿用的间接效应**，
    #       有明确因果链（冻结 → id 稳 → 闸放行 → 沿用生效 → aigc 整段照搬）。
    #     · page.pages 既不在词表、也不可沿用，是**纯噪声**。
    #   混在一起标注，等于把一条真因果和一堆运气写成同一个警告。
    print("  ① 词表直接干预 : datamodel.entities / rbac.roles / workflow.nodes")
    print("     （model_id_lexicon 把「名字→id」喂回第 4/5 步，要求照抄）")
    print("  ② 跟随实体     : rbac.permissions（形状 <实体id>:动作，实体稳它就稳）")
    print("  ③ 经沿用间接   : aigc.capabilities（不在词表，但在可沿用段里；")
    print("     沿用过闸就整段照搬 → id 全同。因果链成立，但中间隔着闸）")
    print("     ⚠ 别把 ③ 的每个 1.00 都记在沿用头上：on-2 实测没发生沿用，")
    print("       aigc id 照样没变（模型自己给了同一个 id，名字倒是改了）。")
    print("       要归因得连 run.log 里「沿用真的发生了吗」一起看。")
    print("  ④ 纯噪声       : page.pages（既不在词表、也不可沿用）")
    print("  ⚠ ④ 若出现大幅差异，那是运气，**不能算作疗效**；")
    print("    ③ 的差异要连着「沿用是否真的发生」一起读，单看数字会高估。")

    print("\n" + "=" * 78)
    print("环境噪声：网关故障（不参与 A/B 判定，只回答『这批数据可不可信』）")
    print("=" * 78)
    for a in arms:
        g = gw[a]
        print(f"  {a:<4} 连接层重试失败 {g['llm_retry_fail']:<4} "
              f"网关问候语 {g['gateway_boilerplate']:<4} "
              f"JSON解析失败 {g['json_parse_fail']:<4} "
              f"（日志 {g['lines']} 行）")

    print("\n" + "=" * 78)
    print("逐段沿用真的发生了吗（id 冻结的机制性证据，比指纹数字更能归因）")
    print("=" * 78)
    for a in arms:
        if reuse_log[a]:
            for run, segs in reuse_log[a]:
                print(f"  {a:<4} {run}: 沿用 {segs}")
        else:
            print(f"  {a:<4} 没有任何一轮发生逐段沿用")

    # ★ 2026-08-17 多轮跑出来的，单轮那次完全没碰到：**沿用失败的主因是
    #   page 引用了旧 rbac 没有的权限**。
    #
    #   第一版假设写的是"第二轮新增实体 ⇒ 沿用失败"，被 on-3 当场证伪：
    #   实体 3→3 没新增，照样退让到空，理由是
    #       page.pages[p5].actionPermissions：'service_staff:export' not found
    #   ——新增的不是实体，是**已有实体上的一个新动作**。
    #
    #   推广后的形状在每一轮退让里都成立（off-1 health_monitor:read、
    #   off-2 elderly:create、on-2 community_branch:read、on-3 service_staff:export）：
    #
    #       新生成的 page.actionPermissions ⊄ 沿用的旧 rbac.permissions
    #
    #   ⚠ 这**不是 id 漂移，冻结救不了**：冻结保的是"已有 id 别改名"，管不了
    #     "多出来一条"。沿用是整段照搬，整段照搬天然容纳不了增量。所以 on 臂
    #     也会退让到空——这条推翻了"冻结开着就不会退让"的隐含假设。
    #
    #   ⚠ 修法方向别急着定：仓里第 6 步早就把词汇表锁死（model_assembly:159
    #     "只能用下面这些 id，一个都不许新造"），而生成 page 的那步**没有**同款
    #     锁。到底该锁 page 还是该让 rbac 可增量，是两条不同的路，得先量清
    #     "page 新引的权限里有多少是真需求、多少是模型随手编的"再决定。
    print("\n" + "=" * 78)
    print("沿用失败的成因：page 引用了旧 rbac 没有的权限（冻结救不了的那一类）")
    print("=" * 78)
    perm_miss = re.compile(
        r"page action permission '([^']+)' not found in rbac\.permissions"
    )
    # ⚠ 两种日志格式都要认，否则统计会**静默归零**：
    #   前缀退让（旧）：⚠ 沿用「aigc」后过不了闸，改为重新生成这一段：<理由>
    #   1-maximal（新）：精修沿用上一版模型段：workflow、aigc（丢掉 rbac，首次拒绝：<理由>）
    #                    精修沿用逐段退让到空，整份用重新生成的那份（首次拒绝：<理由>）
    #   只认旧的那条，等 ddmax 改造落地后每一轮都会显示"没被拒过"——数字变好看了，
    #   其实是判据瞎了。这正是本仓纪律四点名的形状，只不过这次的两半是
    #   "被观测的代码"和"观测它的判据"。
    other_cause = re.compile(r"⚠ 沿用「[^」]+」后过不了闸[^\n]*|首次拒绝：[^\n)]*")
    print(f"  {'轮次':<9}{'实体 r1→r2':<13}{'沿用结果':<26}{'首条拒绝理由'}")
    print("  " + "-" * 88)
    causes = {"page缺权限": 0, "其他": 0}
    for name in sorted(os.listdir(runs_dir)):
        d = os.path.join(runs_dir, name)
        f1, f2 = os.path.join(d, "model_round1.json"), os.path.join(d, "model_round2.json")
        if not (os.path.exists(f1) and os.path.exists(f2) and os.path.exists(os.path.join(d, "OK"))):
            continue
        m1, m2 = json.load(open(f1)), json.load(open(f2))
        e1 = len(pairs_of_class(m1, ["datamodel", "entities"]))
        e2 = len(pairs_of_class(m2, ["datamodel", "entities"]))
        text = open(os.path.join(d, "run.log"), encoding="utf-8", errors="replace").read()
        # ★ 沿用结果从**落盘模型的段指纹**读，不从日志读（2026-08-17 改）。
        #
        #   前两版都读日志，两次都出错：
        #     · 第一版 .search() 取首条，而 max_loops=2 时一轮有两条，交付的是最后一条
        #     · 第二版取最后一条，但真机 on-4 那条日志**被并发写坏了**：
        #         …aigc field 'elder.health_[html_bindings] 页面 p3 重问第 1 次：…
        #                                 ↑ 没有换行，两条日志撞在一起
        #       第 3 步页面生成是并发的，多线程 print 到同一个 stdout 不是原子操作。
        #       于是聚合器判 on-4「未发生沿用」，而落盘模型显示 rbac 和 workflow
        #       的段指纹跟上一版**逐字节相同**——它明明沿用了。
        #
        #   教训是本仓纪律五的原话：判据要落在真正的产物上，不要量中间表征。
        #   日志是尽力而为的叙述，模型是事实。并发一撕，叙述就不可信了。
        reused_segs = [
            s for s in ("rbac", "workflow", "aigc")
            if s in m1 and _seg_fp(m1.get(s)) == _seg_fp(m2.get(s))
        ]
        retreated = not reused_segs
        result = f"沿用 {'、'.join(reused_segs)}" if reused_segs else "一段没沿用"
        rejects = other_cause.findall(text)
        if rejects:
            hit = perm_miss.search(rejects[0])
            if hit:
                why = f"page 缺权限 {hit.group(1)}"
                causes["page缺权限"] += 1
            else:
                why = rejects[0].split("：", 2)[-1][:46]
                causes["其他"] += 1
        else:
            why = "—（没被拒过）"
        print(f"  {name:<9}{f'{e1}→{e2}':<13}{result:<26}{why}")
    print("\n  拒绝成因分布：", json.dumps(causes, ensure_ascii=False))
    print("  ⚠ 实体数那一列**只是参考**，不是判据：on-3 实体 3→3 没新增照样退让，")
    print("    缺的是已有实体上的一个新动作（export）。看理由那一列才准。")

    # 开关自证的汇总：ON 臂每轮都该有 freeze_on、且绝不该有 freeze_off
    print("\n" + "=" * 78)
    print("开关自证汇总（正反两条都要对）")
    print("=" * 78)
    for a in arms:
        g = gw[a]
        print(f"  {a:<4} 冻结生效行 {g['freeze_on']:<4} 冻结关闭行 {g['freeze_off']:<4}")
    print("  期望：on 臂 生效>0 且 关闭=0；off 臂 关闭>0 且 生效=0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
