"""从远端库的 forum_topic 读话题档，出一份分析报告。

分析口径都写在下面各函数的注释里——赛道是从标题里认的（论坛没有结构化赛道字段），
所以有误差，误差来源也一并标出来。
"""
from __future__ import annotations

import json
import re
from collections import Counter
from statistics import median
from typing import Any

from forum_neon import Store

# 赛道关键词。选手在标题里写法极不统一（【学习工作赛道】/学习工作 |/〖学习工作赛道〗/
# [学习工作]/【学子工作】…），所以按关键词认而不是按固定格式解析。
# 一个帖可以命中多个（"社会服务+社会公益"这种合并投稿很常见），故为多标签。
TRACKS = {
    "学习工作": ("学习工作", "学子工作"),
    "生活娱乐": ("生活娱乐", "娱乐生活", "生活服务", "生活育儿"),
    "社会服务": ("社会服务",),
    "社会公益": ("社会公益", "社区公益", "公益赛道"),
    "硬件交互": ("硬件交互",),
    "非遗/古籍": ("非遗", "古籍活化", "文创赛道"),
}

# 外链分类：看选手有没有真的把东西放出来
LINK_KINDS = {
    "GitHub": ("github.com", "gitee.com"),
    "视频": ("bilibili.com", "b23.tv", "youtube.com", "douyin.com"),
    "在线体验": ("vercel.app", "netlify.app", "github.io", "pages.dev", "railway.app",
                "zeabur.app", "streamlit.app", "hf.space", "huggingface.co"),
    "应用市场": ("taptap", "apps.apple.com", "play.google.com", "pgyer.com", "fir.im"),
    "网盘": ("pan.baidu.com", "quark.cn", "aliyundrive", "alipan.com", "lanzou"),
}

FORUM_INTERNAL = ("forum.trae.cn", "trae-forum-cdn", "trae.com.cn", "trae.cn")


def classify_tracks(row: dict[str, Any]) -> tuple[list[str], str]:
    """返回（赛道列表，判定来源）。

    **以论坛标签为准**——大赛专区的帖子带结构化标签，恰好就是 5 个赛道
    （生活娱乐/学习工作/社会公益/社会服务/硬件交互），比从标题猜准得多：
    实测标题解析只认出 26 个社会公益，而标签口径是 76 个，差了近 3 倍——
    因为大量选手把"社会公益"写在正文而不是标题里。
    只有无标签的帖子才回落到标题关键词。"""
    tags = [t for t in (row.get("tags") or []) if t in TRACKS]
    if tags:
        return sorted(tags), "标签"
    title = row.get("title") or ""
    hits = [name for name, kws in TRACKS.items() if any(k in title for k in kws)]
    return (hits or ["未标注"]), "标题"


def classify_links(links: list[str]) -> set[str]:
    """一个帖命中哪几类外链。论坛自家域名（图床/内链）不算'放出来了'。"""
    kinds: set[str] = set()
    for url in links:
        if any(d in url for d in FORUM_INTERNAL):
            continue
        for kind, domains in LINK_KINDS.items():
            if any(d in url for d in domains):
                kinds.add(kind)
    return kinds


def external_links(links: list[str]) -> list[str]:
    return [u for u in links if not any(d in u for d in FORUM_INTERNAL)]


def bar(n: int, total: int, width: int = 28) -> str:
    filled = round(width * n / total) if total else 0
    return "█" * filled + "·" * (width - filled)


def pct(n: int, total: int) -> str:
    return f"{100 * n / total:.1f}%" if total else "—"


def main() -> None:
    db = Store()
    rows: list[dict[str, Any]] = db.q(
        "select topic_id, url, title, author_username, category_name, tags, "
        "created_at, views, like_count, reply_count, posts_count, participant_count, "
        "word_count, length(body_text) as body_len, images, links, replies "
        "from forum_topic order by views desc"
    )
    n = len(rows)
    print("=" * 78)
    print(f"  TRAE 论坛话题档分析 · 共 {n} 个话题")
    print("=" * 78)

    # ── 1. 赛道分布 ────────────────────────────────────────
    print("\n【1】赛道分布（以论坛标签为准，无标签的回落标题识别；多标签，跨赛道投稿计入多个）\n")
    tc: Counter[str] = Counter()
    src_c: Counter[str] = Counter()
    multi = 0
    for r in rows:
        tracks, src = classify_tracks(r)
        src_c[src] += 1
        multi += len(tracks) > 1
        for t in tracks:
            tc[t] += 1
    for name, c in tc.most_common():
        print(f"  {name:<10} {c:>4} 帖  {bar(c, n)}  {pct(c, n)}")
    print(f"\n  跨赛道投稿：{multi} 帖（{pct(multi, n)}）")
    print(f"  判定来源：标签 {src_c['标签']} 帖 / 标题回落 {src_c['标题']} 帖")

    # ── 2. 热度 ────────────────────────────────────────────
    print("\n【2】热度分布\n")
    for label, key in (("阅读", "views"), ("点赞", "like_count"), ("回帖", "reply_count")):
        vals = sorted(r[key] for r in rows)
        print(f"  {label}：中位 {median(vals):>6.0f} | 均值 {sum(vals)/n:>7.1f} | "
              f"最高 {vals[-1]:>6} | 最低 {vals[0]:>4} | "
              f"P90 {vals[int(n*0.9)]:>6}")
    zero_like = sum(1 for r in rows if r["like_count"] == 0)
    zero_reply = sum(1 for r in rows if r["reply_count"] == 0)
    print(f"\n  零点赞：{zero_like} 帖（{pct(zero_like, n)}）"
          f" | 零回帖：{zero_reply} 帖（{pct(zero_reply, n)}）")

    # ── 3. 内容深度 ────────────────────────────────────────
    print("\n【3】内容深度\n")
    lens = sorted(r["body_len"] for r in rows)
    imgs = sorted(len(r["images"]) for r in rows)
    print(f"  正文长度：中位 {median(lens):>6.0f} 字 | 均值 {sum(lens)/n:>7.0f} | "
          f"最长 {lens[-1]:>6} | 最短 {lens[0]:>4}")
    print(f"  配图数量：中位 {median(imgs):>6.0f} 张 | 均值 {sum(imgs)/n:>7.1f} | "
          f"最多 {imgs[-1]:>6} | 无图 {sum(1 for i in imgs if i == 0)} 帖")
    buckets = [(0, 1000, "<1千字"), (1000, 3000, "1–3千"), (3000, 6000, "3–6千"),
               (6000, 10000, "6–1万"), (10000, 10**9, ">1万字")]
    print()
    for lo, hi, label in buckets:
        c = sum(1 for x in lens if lo <= x < hi)
        print(f"  {label:<8} {c:>4} 帖  {bar(c, n)}  {pct(c, n)}")

    # ── 4. 交付证据 ────────────────────────────────────────
    print("\n【4】交付证据：帖子里有没有真的把东西放出来\n")
    kc: Counter[str] = Counter()
    none_ext = 0
    for r in rows:
        kinds = classify_links(r["links"])
        if not external_links(r["links"]):
            none_ext += 1
        for k in kinds:
            kc[k] += 1
    for kind, c in kc.most_common():
        print(f"  {kind:<10} {c:>4} 帖  {bar(c, n)}  {pct(c, n)}")
    print(f"\n  全无站外链接：{none_ext} 帖（{pct(none_ext, n)}）——纯图文介绍，没给可验证的东西")

    # ── 5. 榜单 ────────────────────────────────────────────
    print("\n【5】阅读量 Top 15\n")
    for i, r in enumerate(rows[:15], 1):
        print(f"  {i:>2}. {r['views']:>5}阅 ♥{r['like_count']:>3} 回{r['reply_count']:>3} "
              f"| {r['title'][:44]}")

    print("\n【6】点赞 Top 15\n")
    for i, r in enumerate(sorted(rows, key=lambda x: -x["like_count"])[:15], 1):
        print(f"  {i:>2}. ♥{r['like_count']:>3} {r['views']:>5}阅 "
              f"| {r['title'][:46]}")

    print("\n【7】正文最长 Top 10（写得最细的）\n")
    for i, r in enumerate(sorted(rows, key=lambda x: -x["body_len"])[:10], 1):
        print(f"  {i:>2}. {r['body_len']:>6}字 图{len(r['images']):>2} {r['views']:>5}阅 "
              f"| {r['title'][:42]}")

    # ── 8. 标签与分类 ──────────────────────────────────────
    print("\n【8】论坛分类与标签\n")
    for name, c in Counter(r["category_name"] for r in rows).most_common():
        print(f"  分类 {name or '(空)':<24} {c:>4} 帖")
    tag_c: Counter[str] = Counter()
    for r in rows:
        for t in r["tags"]:
            tag_c[t] += 1
    for t, c in tag_c.most_common(10):
        print(f"  标签 {t:<24} {c:>4} 帖")

    # ── 9. 时间分布 ────────────────────────────────────────
    print("\n【9】发帖时间分布（按月）\n")
    mc = Counter((r["created_at"] or "")[:7] for r in rows)
    for m, c in sorted(mc.items()):
        print(f"  {m or '(未知)':<10} {c:>4} 帖  {bar(c, n)}")

    print("\n" + "=" * 78)


if __name__ == "__main__":
    main()
