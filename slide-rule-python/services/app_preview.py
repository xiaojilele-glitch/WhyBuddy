"""app_preview — 首页参照板 → 应用中心缩略图的**收集槽**。

## 这是干嘛的

生成总览页时会先让生图模型画一张「首页参照板」（见
freeform_block._generate_overview_sheet_b64），设计 LLM 照着它排版式。运营总览
直接收这张参照板；营销首页因完整视觉稿不能再充当运行时 Hero，改收与它并发生成的
独立 Hero 媒体。两者都是这次生成的代表画面，也都避免应用中心重新活渲染。

对面那头（应用中心）此前靠**活渲染**：每张卡挂一个真的 AppRuntimeScreen，
antd 表格 + echarts 全套跑一遍。AppsWorkbench 自己的注释记着实测数字——
「生产构建下同屏 14 张卡，最长单任务 4106ms，主线程连续堵四秒」。现有缓解手段
只是把挂载排队（视口闸 + requestMountPermit），没有减少总工作量。

## 为什么是「显式传一个槽」，不是挂在 model 上

最省事的写法是把 base64 临时挂到 model 上借道传给落库那一步。试过，不能这么写：

  ① **会跟着 model 到处走。** model 会流向会话存档、linkage 产物、前端重渲，
     一张约 1MB 的 base64 会进每一份快照；它还会进 model_signature 的输入，
     让"同一个模型"因为图变了而被判定成变了、白起一个新版本。
  ② **产出 model.json 的入口不止一个。** enrich_monitor_page_overviews 另有
     两个脚本调用方——scripts/fresh_topic_shot.py 与
     scripts/enrich_builtin_domain_models.py，后者写的是**仓库里冻结的**
     builtin 域夹具。挂在 model 上就要求这两处都记得摘掉，忘一次就是往 git
     里提交几 MB 的 base64。

显式传槽把默认值放在了安全的一边：**不传就什么都不收集**，脚本路径一个字
都不用改，也不可能被污染。

## 为什么不是 v5 模型的一个正式字段

它不是设计模型的一部分，是一份**衍生资产**（跟截图、导出的 zip 同类）。
过门契约里没有它、gate 也不校验它；写成正式字段等于要求所有模型消费方
（前端渲染、夹具、契约测试）都认识一个跟设计无关的大二进制。

## 为什么不用 contextvar / threading.local

那样调用方连槽都不用传，看着更干净——但这条链路正在做的事就是**并行化**
（见 docs/enrich-pipeline-parallelization-audit-2026-07-31.md）。
ThreadPoolExecutor 默认不复制 contextvar，改成并行的那天收集会静默失效，
而失效的表现只是"卡片回落活渲染"，没人会立刻发现。显式对象跨线程照样是同
一个，配上锁就够了。
"""

from __future__ import annotations

import threading
from typing import Optional


class OverviewPreviewSink:
    """收集这一次生成里"代表这个应用"的那张参照板。

    **最多只留一张**：应用中心一张卡只显示一张图，多留的没人用，而每张都是
    约 1MB 的 base64。选哪一张有明确判据——落地页（appbundle.landingPageRef）
    那张就是用户点开应用第一眼看到的页，跟卡片该代表的东西一致。落地页那张
    还没来（或者压根没声明落地页）就先收着第一张，之后落地页那张到了再顶掉。

    带锁：这条链路的并行化改造已经在计划里（多个总览页同时生图），到那天
    offer 会被多个线程同时调用。锁的成本在这里可以忽略——每页最多进来一次，
    而每次背后是一趟几十秒的生图。
    """

    __slots__ = ("_lock", "_b64", "_page_id", "_from_landing")

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._b64: Optional[str] = None
        self._page_id: str = ""
        self._from_landing = False

    def offer(self, page_id: str, png_b64: Optional[str], *, is_landing: bool = False) -> None:
        """交一张候选图。png_b64 为空直接忽略——生图失败/预算撞顶都是 fail-open
        的正常结局，调用方不需要为此加判断。"""
        if not png_b64:
            return
        with self._lock:
            # 已经收到落地页那张 → 谁也顶不掉；否则落地页的图优先，
            # 其余情况先到先得。
            if self._from_landing:
                return
            if self._b64 is not None and not is_landing:
                return
            self._b64 = png_b64
            self._page_id = page_id
            self._from_landing = is_landing

    @property
    def png_b64(self) -> Optional[str]:
        with self._lock:
            return self._b64

    @property
    def page_id(self) -> str:
        with self._lock:
            return self._page_id
