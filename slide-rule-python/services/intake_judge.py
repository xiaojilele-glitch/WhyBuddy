"""入站判定闸门：这一轮用户说的，是真需求 / 真迭代，还是别的。

背景（真实成本）：一轮推演约 20 分钟 + 一次完整 LLM 推演 + 最多 9 张生图。
在此之前任何输入都会直接进推演——"你好""今天天气怎么样"照样烧这些。而
前端唯一的启发式 `looksLikeNewAppIntent`（useSlideRuleSession.ts）只做
"新话题 vs 迭代"的路由，从不拒绝任何东西，而且它的 `false` 语义重载：
"这是迭代"和"这我没认出来"返回值一模一样，二分类装不下这个问题。

设计取舍（2026-07-29 追加：拒绝档的来源）：
- 判定类别原本只有 real/iteration/vague/off_topic/meta，缺一档：**说清楚了，
  但这个产品的形态五系统模型根本表达不了**。实测「3D 像素竞速游戏」「基于
  ESP32-S3 的桌面硬件」这类输入被判 real、置信度 0.93~0.98，然后照常烧掉
  一整轮推演，最后交给用户一个不伦不类的表单系统。
- 这一档在学界有成熟先例。TriageSQL（Zhang et al. 2020, arXiv:2010.12634）
  把 text-to-SQL 的问题意图分成五类，其中 `ambiguous`（说不清）与
  `unanswerable by sql`（说清了但 SQL 表达不了）是**分开的两类**——正对应
  本文件的 vague 与 out_of_scope。它的实验数据还给了两个可直接用的结论：
  `unanswerable by sql` 是五类里最好判的（F1 0.90），而 `answerable`
  反倒最难（0.53）——所以风险不在"能不能认出超纲"，在"会不会误伤真需求"。
- Query Carefully（arXiv:2512.21345，JasminSaxer/QueryCarefully）在 LLM 时代
  复现了同一结论：schema-aware prompt + 明写的 No-Answer Rules + 正反例各给
  几条，超纲检出 0.8；而且**加反例不会拉低正例的表现**。
- 两篇的共同做法是把**能力面**（schema）写进 prompt——判"做不做得了"必须
  先知道"做得了什么"。本判定器此前一个字的能力面都没有，这才是模型敢用
  0.98 置信度说"永动机管理系统是真需求"的根因。所以 _capability_block()
  从 five_system_legal.json 现算（不手抄，避免账本改了这里不跟）。

设计取舍（2026-07-27 调研三个开源方案后的结论）：
- NeMo Guardrails / semantic-router 的话题围栏靠向量匹配少样本例句，
  Parlant 的规则匹配也走向量（nano-vectordb）——但本项目的 LLM 网关
  普遍没有 /embeddings 端点（.env 里 RAG_VECTOR_ENABLED=false 就是这个
  原因），这条路对相当一部分用户直接不可用。
- guardrails-ai/RestrictToTopic 要 transformers+torch，openai-guardrails
  要 43 个包含整套 spaCy（实测依赖解析）——为一道闸门装这些不合算。
- 三者的输出都是二元 flagged/Pass-Fail，都不产出面向用户的引导话术，
  而"引导用户去发真实需求"恰恰是这里最需要的那一格。
所以：不引任何依赖，只借两个结构——RestrictToTopic 的「确定性层在前、
不确定才花钱调 LLM」，以及 Parlant 的「规则带条件与优先级、每轮只把相关
的送进模型」（见 _RULES / _applicable_rules，不是一个巨型 prompt）。

纪律：
- **fail-open**：判定本身出任何问题（LLM 挂了/超时/返回不合法）一律放行。
  闸门自己坏了不能变成产品坏了。
- **第一版不阻断**：只产出 action=hint，由前端决定怎么提示；用户永远有
  "仍然推演"的逃生口。误判率在真实数据上收敛之前不升级成硬拦——这个
  项目刚被 _recognize_domain 的静默误判坑过（要翻译平台拿到工单系统），
  把人挡在核心功能外面的代价更大。
"""

from __future__ import annotations
from .archetype_legal import device_rubric_bullets as _device_rubric_bullets
from .archetype_legal import judge_device_domain_bar as _judge_device_domain_bar
from .archetype_legal import valid_judge_devices as _valid_judge_devices
from .closed_tools import is_closed_tool_command, is_factory_hop_command

import os
import re
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

from sliderule_llm.config import default_max_tokens

Verdict = Literal["real", "iteration", "vague", "off_topic", "meta", "out_of_scope"]
Action = Literal["proceed", "hint"]
# 设备档。合法域同源于账本（接通的设备 + unspecified 哨兵）。
# 2026-08-30：删掉手写 Literal——账本接通 tablet 而这里没跟上，判定会输出
# 闸不认的值，或反过来把已经接通的档判成非法。unspecified 见 Judgement.device。
Device = str

_ENABLED_ENV = "SLIDERULE_INTAKE_JUDGE_ENABLED"
_BLOCKING_ENV = "SLIDERULE_INTAKE_JUDGE_BLOCKING"


def judge_enabled() -> bool:
    """默认开（判定本身不阻断，开着只多一次 1~2s 的调用换到诊断数据）。
    显式 0/false/no/off 关掉。"""
    from .env_flags import flag

    return flag(_ENABLED_ENV, default=True)


def blocking_enabled() -> bool:
    """第一版默认关：判定只提示不拦。误判率收敛后再显式打开。"""
    from .env_flags import flag

    return flag(_BLOCKING_ENV, default=False)


# ── 第 0 层：确定性预判（零成本零延迟，只挡闭眼都知道的）────────────
# 纪律：这一层只处理"绝不可能是需求"的形状，宁可漏也不能误伤——真需求
# 落到这里被拦，用户就没有第二次机会了。

_GREETING_RE = re.compile(
    r"^(你好+|您好|哈喽|hello|hi|hey|在吗|在么|有人吗|early|测试|test|"
    r"謝謝|谢谢|thanks?|thx|ok|okay|好的|嗯+|哦+|额+|1+)[\s!！?？.。,，~、]*$",
    re.IGNORECASE,
)
_PUNCT_ONLY_RE = re.compile(r"^[\s\W_]+$", re.UNICODE)
# 只短路 1~2 个有效字的输入。阈值曾经是 4，评测台抓到它把「你是谁」（3 字）
# 判成了 vague——用户问"你是谁"却被回"再多说两句，比如涉及哪些角色"。
# 3 字以上交给 LLM：这类输入判起来很便宜，而 LLM 判得明显更准。
_MIN_MEANINGFUL_CHARS = 3


@dataclass
class Judgement:
    """一次判定的完整结果。action 与 verdict 分开，是为了让阻断策略能独立
    演进——把 blocking 打开只改 _resolve_action，不动判定本身。"""

    verdict: Verdict
    action: Action
    reason: str = ""
    guidance: str = ""
    rewrite: list[str] = field(default_factory=list)
    confidence: float = 1.0
    source: str = "llm"  # precheck | llm | degraded
    degraded_reason: str = ""
    # 2026-07-30：设备档随判定一起出。**刻意不新开一次 LLM 调用**——入站判定
    # 每次输入都已经在调一次了，多抽一个槽位成本是 0；单独加一次"判设备"是
    # 一次完整往返。unspecified 是一等取值，不是 None 的别名：判不出来跟
    # "判出来是桌面"必须能区分开，否则下游没法决定该不该两档都生成。
    device: Device = "unspecified"
    device_reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "verdict": self.verdict,
            "action": self.action,
            "reason": self.reason,
            "guidance": self.guidance,
            "rewrite": list(self.rewrite),
            "confidence": self.confidence,
            "source": self.source,
            "degradedReason": self.degraded_reason,
            "device": self.device,
            "deviceReason": self.device_reason,
        }


def precheck(text: str, *, has_app: bool = False) -> Optional[Judgement]:
    """确定性层。命中返回判定，否则 None（交给 LLM 层）。"""
    t = (text or "").strip()
    if not t:
        return Judgement(
            verdict="vague", action="hint", source="precheck",
            reason="输入为空",
            guidance="说说你想做什么系统吧——一句话就行，比如「社区宠物诊所的预约与分诊」。",
        )
    if _PUNCT_ONLY_RE.match(t):
        return Judgement(
            verdict="vague", action="hint", source="precheck",
            reason="只有标点或符号",
            guidance="没读到内容。用一句话描述你想理顺的业务流程就可以。",
        )
    if _GREETING_RE.match(t):
        return Judgement(
            verdict="meta", action="hint", source="precheck",
            reason="纯问候语",
            guidance="你好。我是把一句话推演成可运行系统的——说说你手头有什么流程想理顺？",
            rewrite=["社区宠物诊所的预约与分诊系统", "二手乐器寄售与鉴定平台"],
        )
    if len(re.sub(r"[\s\W_]", "", t, flags=re.UNICODE)) < _MIN_MEANINGFUL_CHARS:
        return Judgement(
            verdict="vague", action="hint", source="precheck",
            reason="内容过短，无法判断意图",
            guidance="再多说两句？比如涉及哪些角色、要走什么流程。",
        )
    # 已有应用：工厂单跳 / 闭集芯片（含 refine）不是新话题。
    # 空会话不走这条——「闭环发布管理系统」仍交给 LLM 当新产品。
    if has_app:
        if is_factory_hop_command(t) or is_closed_tool_command(t):
            return Judgement(
                verdict="iteration",
                action="proceed",
                source="precheck",
                reason="工厂单跳指令",
                confidence=1.0,
            )
    return None


# ── 能力面：判"做不做得了"之前，先让模型知道"做得了什么"──────────────
# TriageSQL / QueryCarefully 两篇都把 schema 写进 prompt——判可行性必须
# 有个可行性的参照物。此前这里一个字都没有，模型只能凭"听起来像不像个正
# 经需求"来判，于是「3D 像素竞速游戏」以 0.95 的置信度过关。
#
# 能表达的那一半从 five_system_legal.json 现算：账本是这些枚举的唯一真相
# 源（见 schema_legal 的模块注释），手抄一份必然漂移——加一种页面形态却
# 忘了改这里，判定器就会继续按旧能力面拒绝本来已经做得到的东西。


def _capability_block() -> str:
    """能表达什么：直接由合法域账本渲染，不手抄。"""
    from services.schema_legal import CHART_TYPES, FIELD_TYPES, PAGE_KINDS

    return (
        "这个产品能推演出来的，是**记录 / 流转 / 查看**类的业务系统，具体由五个部分组成：\n"
        f"  · 数据模型：若干实体，每个实体的字段只有这几种类型——{'、'.join(FIELD_TYPES)}\n"
        "  · 角色与权限：角色、菜单、按权限决定谁看得到哪些页、能不能新建\n"
        "  · 流程：节点与流转（提交 → 审核 → 完成这类）\n"
        f"  · 页面：只有这几种形态——{'、'.join(PAGE_KINDS)}\n"
        f"  · 图表：只有这几种——{'、'.join(CHART_TYPES)}\n"
        "换句话说：能被做成「一张张表单 + 一条条记录 + 一个流程 + 几张列表和图表」"
        "的东西，都做得了。"
    )


# 表达不了的那一半**不在账本里**——账本记的是"合法枚举"，不是"产品边界"。
# 这五类是 2026-07-29 从 250 条真实参赛作品标题里聚类出来的（其中 96 条超纲，
# 见 tests/data/intake_judge_cases.jsonl 的 oos_* 用例，id 前缀就是这里的分类）。
# 五类的共同点：产品核心不是"记录与流转"，而是实时渲染 / 设备 IO / 信号处理 /
# 内容生成 / 模型推断——这些东西不是"字段不够用"，是**根本不在这个形态里**。
_OUT_OF_SCOPE_KINDS = (
    ("game", "游戏与实时互动：任何有游戏循环、实时对战、体感互动、剧情推进的东西"
             "（竞速/卡牌/战棋/消除/模拟器/互动叙事）。做成生成器也一样——产物仍是游戏。"),
    ("hw", "硬件与设备：单片机固件、传感器、外设、机械结构（ESP32/Arduino/雕刻机/"
           "智能药盒/拐棍/乐器）。"),
    ("native", "端侧原生与系统级能力：iOS/Android/Mac 原生应用、屏幕共享、系统面板、"
               "调摄像头麦克风、语音操控手机。"),
    ("media", "图形与内容创作工具：3D 建模、动画、绘本、写作台、剪辑、字帖、"
              "可视化播放器——产品核心是生成内容本身。"),
    ("signal_algo", "实时信号处理与算法产品：实时音频、助听、空间音频、姿态识别、"
                    "录像分析教练、发育监测、防火墙——产品核心是模型推断。"),
)


def _out_of_scope_block() -> str:
    return "下面这五类做不了（不是字段不够用，是产品形态根本不在上面那五个部分里）：\n" + "\n".join(
        f"  · {desc}" for _, desc in _OUT_OF_SCOPE_KINDS
    )


# ── 设备档判据（2026-07-30）───────────────────────────────────────────
# 为什么值得单独判：此前 appbundle.preferredDevice 虽然在生成契约里、门禁也校验
# 合法域，但契约只写了一句"MAY include preferredDevice 'desktop'|'tablet'|'phone'"，
# **没给任何该怎么选的判据**。实测扫了会话库与产出库：9 个应用 9 个 desktop，
# 这个字段是死的。于是总览页两档版式永远都得生成一遍手机版——不是因为需要，
# 是因为没人知道要不要。
#
# 判据用**姿态**而不是关键词。这是设计行业的老概念（Alan Cooper《About Face》的
# posture：sovereign 长时段独占屏幕 vs transient 短暂打断式），也是 Flutter 官方
# adaptive/responsive 那篇的落点——它明确说判据应该是"可用空间与是否好用"，
# 而不是设备型号。关键词判会立刻栽在两个方向上：
#   「骑手运力调度看板」有"骑手"但用的人是调度员坐在后台 → 桌面
#   「巡检工单现场拍照上传」有"工单"但人站着走动 → 手机
# 所以规则正文里两个方向的硬负样本都写上（跟拒绝档同一套办法）。
_DEVICE_RUBRIC = (
    "顺带判一件事：这个系统主要该在**哪种设备**上用。判据是**使用姿态**"
    "（人在什么状态下操作），不是句子里出现了什么词。\n"
    # ⚠ 设备条目由账本生成（加设备只改 JSON，提示词自动跟上）。
    #   下面五行「容易判错的例子」是**标定过的**，手写保留——
    #   生成它等于把标定丢给模板。判据 test_rubric_逐字不变 钉住整串。
    + _device_rubric_bullets() + "\n"
    "两个方向的坑（这两组最容易判错，判的是谁在什么状态下用，不是词）：\n"
    "  「外卖骑手运力调度看板」有「骑手」，但用的人是调度员坐在后台 → desktop\n"
    "  「员工打卡的月度汇总与补卡审批」有「打卡」，但汇总审批是 HR 坐着做 → desktop\n"
    "  「巡检工单，工人到现场拍照上传当场提交」有「工单」，但人站着走动 → phone\n"
    "  「仓库盘点，扫码逐箱核对」有「仓库」，但扫码逐箱是走动作业 → phone\n"
    "用户明说了「App」「手机端」「小程序」「PC 端」「网页版」「电脑上用」就直接照办，"
    "不用再推姿态。\n"
    "拿不准、或者一句话里几个角色姿态不同（提交侧像手机、审批侧像桌面）→ "
    "unspecified。**判 unspecified 不丢人，硬猜错了下游会按错的档去设计版式。**"
)


# ── 第 1 层：规则表（Parlant 式 condition/action + 适用域 + 优先级）──
# 不写成一个巨型 prompt 的原因：规则一多就会互相干扰，而这个项目已经在
# 域识别器上踩过"规则太糙导致误判"的坑（"sla" 命中 translation）。这里每
# 条规则带适用域，每轮只把相关的拼进 prompt——规则增长时干扰面不扩大。


@dataclass(frozen=True)
class JudgeRule:
    id: str
    scope: Literal["always", "new_session", "has_app"]
    condition: str
    verdict: Verdict
    priority: int  # 越大越优先；同轮多条命中时供模型裁决参考


_RULES: tuple[JudgeRule, ...] = (
    JudgeRule(
        id="meta_product_question", scope="always", priority=90,
        condition="在问这个产品本身（怎么收费、你是谁、能做什么、怎么用、有什么限制），"
                  "而不是要造一个系统。注意：这类话里也常出现「系统」二字，别被字面骗了。",
        verdict="meta",
    ),
    JudgeRule(
        id="off_topic_chitchat", scope="always", priority=80,
        condition="闲聊、常识问答、算术、天气、情绪表达等，与「把某个业务流程做成系统」无关。",
        verdict="off_topic",
    ),
    JudgeRule(
        id="new_business_need", scope="new_session", priority=70,
        condition="描述了一个想被系统化的业务场景或流程。**不要求**出现「系统/应用/平台」"
                  "这类载体名词——「我们店里排班总是乱，想弄个东西管一管」「把公司报销"
                  "流程数字化」都算真需求。",
        verdict="real",
    ),
    JudgeRule(
        # 2026-07-28：已有应用时 real 压根不在候选判定里——模型只能在
        # iteration/vague/meta/off_topic 里选，于是「另外再做一套幼儿园接送打卡」
        # 这种全新领域的需求要么被塞进 iteration，要么被判 vague 弹提示条
        # （误拦真需求）。实测 9/9 全错，8 条判 vague；模型自己在 reason 里写
        # 「当前判定类别中没有"新建系统"选项」。这条规则就是把那个选项补回来。
        # 优先级高于 iteration：先问"是不是同一件事"，再谈"是不是在改它"。
        id="new_unrelated_need", scope="has_app", priority=75,
        condition="虽然已经有一个应用，但这句话描述的是**另一个业务领域**的新需求"
                  "（换了行业/换了对象/明说「另外做一套」「新开个话题」「这个先放着」）。"
                  "判据是业务领域相不相干，不是句子长短：「再给我做一套幼儿园接送打卡」"
                  "对一个药店进销存应用来说就是全新需求。"
                  "注意与 iteration 的边界：同一领域内加功能（药店应用里「再加中药饮片"
                  "批号追溯」）仍是 iteration，不是新需求。",
        verdict="real",
    ),
    JudgeRule(
        id="iteration_on_current_app", scope="has_app", priority=70,
        condition="针对当前已生成的应用提修改、增删、追问或反馈。包括很短的祈使句"
                  "（「把侧栏改成深色」）、纯评价（「这个配色太素了」）、版本操作"
                  "（「回到上一版」）——它们都不像需求描述，但都是有效迭代。"
                  "**前提是说的还是当前这个应用**：换了业务领域的走上面那条 real，"
                  "不要因为「会话里已经有应用」就默认什么都算迭代。",
        verdict="iteration",
    ),
    JudgeRule(
        # 2026-07-29 新增。优先级刻意压在 real/iteration **之下**：
        # TriageSQL 的数据说超纲是最好判的一类（F1 0.90）、真需求反倒最难
        # （0.53），所以风险从来不在"认不出超纲"，在"误伤真需求"。让 real
        # 先手，这一条只在真需求这条路走不通时才轮到。
        id="out_of_scope_form", scope="always", priority=60,
        condition="说的是什么很清楚（不是 vague），但**产品的核心形态**不是"
                  "「记录 + 流转 + 查看」，落在上面列的五类做不了的东西里。\n"
                  "     判的是产品核心，**不是关键词**——这条最容易判错的方式就是"
                  "看见某个技术领域的词就往这里塞。反例（这些全都是 real）：\n"
                  "     「录音棚的档期预订与设备租借」有「录音」但本体是预订与租借；\n"
                  "     「密室逃脱门店的场次排班与客诉处理」有「密室逃脱」但本体是排班；\n"
                  "     「机器人竞赛的报名、分组与评分登记」有「机器人」但本体是报名与评分；\n"
                  "     「短视频 MCN 的达人签约与分成结算」有「短视频」但本体是签约与结算。\n"
                  "     反过来，「智能水杯提醒喝水」听着像业务，核心却是硬件；"
                  "「教小孩认字的闯关小程序」听着像学习工具，产物却是游戏——这两个是 out_of_scope。\n"
                  "     一句话判据：**去掉那个领域名词，剩下的还是不是「谁在什么时候"
                  "记一笔、谁来审、在哪儿看」？** 是就 real，不是才 out_of_scope。",
        verdict="out_of_scope",
    ),
    JudgeRule(
        id="too_vague", scope="always", priority=40,
        condition="确实是想做点什么，但信息少到无法开始（「做个系统」「帮我搞个东西」"
                  "「再搞个别的」）。只有在既判不出具体业务、也判不出要改什么时才用这条。"
                  "**说清了业务领域和主要环节就不算 vague**——角色、字段、页面这些细节"
                  "本来就是推演过程要问的，不是入站门槛。实测教训：「农机租赁调度，机主"
                  "挂单、农户下单、作业验收」被判 vague，理由是「缺少角色权限和验收流程」"
                  "——那是推演的活，不是拦人的理由。",
        verdict="vague",
    ),
)


def _applicable_rules(has_app: bool) -> tuple[JudgeRule, ...]:
    """按会话状态挑规则——空会话不谈迭代，已有应用不谈新建。"""
    scope = "has_app" if has_app else "new_session"
    return tuple(r for r in _RULES if r.scope in ("always", scope))


def _rules_block(has_app: bool) -> str:
    lines = []
    for rule in sorted(_applicable_rules(has_app), key=lambda r: -r.priority):
        lines.append(f"- {rule.verdict} (priority {rule.priority}): {rule.condition}")
    return "\n".join(lines)


_REQUIRED_KEYS = ("verdict", "reason", "confidence")


def build_messages(text: str, *, has_app: bool, app_summary: str = "") -> list[dict[str, str]]:
    """拼判定用的对话。带上会话状态与当前应用摘要——判「是不是真迭代」
    必须知道现在这个应用是什么，否则「加个杯测记录」这种话无从判断。"""
    verdicts = sorted({r.verdict for r in _applicable_rules(has_app)})
    context = (
        f"用户当前已经有一个生成好的应用：{app_summary or '（未提供摘要）'}"
        if has_app
        else "用户还没有任何应用，这是一轮全新的开始。"
    )
    # 已有应用时先做一次领域比对再选类别。只把 real 加进候选还不够——实测
    # 模型拿到候选后仍以 0.99 的置信度全判 iteration，因为"会话里已经有应用"
    # 这句铺垫压过了一切。必须把比对写成一个显式步骤，模型才会真去比。
    domain_step = (
        "\n\n判之前先做一步：把用户这句话说的**业务领域**跟上面那个应用比一比。\n"
        "  - 不是同一个领域（换了行业、换了服务对象、或明说「另外做一套」「新开个话题」）"
        "→ 这是 real，一个全新需求，跟现有应用无关。\n"
        "  - 是同一个领域（在现有应用上加功能、改规则、调页面）→ 这才是 iteration。\n"
        f"当前应用的领域是：{app_summary or '（未提供摘要，此时按语义判断）'}"
        if has_app
        else ""
    )
    system = (
        "你是一个推演产品的入站判定器。这个产品把用户一句话的业务需求推演成"
        "可运行的系统（含数据模型、权限、流程、页面）。一轮推演成本很高，"
        "所以要先判断这一轮输入属于哪一类。\n\n"
        # 能力面必须在判定类别之前给：判"做不做得了"要先知道"做得了什么"。
        f"这个产品的能力边界：\n{_capability_block()}\n\n{_out_of_scope_block()}\n\n"
        f"当前会话状态：{context}{domain_step}\n\n"
        f"判定类别（只能选其一）：\n{_rules_block(has_app)}\n\n"
        "输出严格的 JSON，不要任何解释文字或代码块标记：\n"
        "{\n"
        f'  "verdict": {"|".join(verdicts)},\n'
        '  "reason": "一句中文，说明为什么这样判",\n'
        '  "confidence": 0.0 到 1.0 的小数,\n'
        '  "guidance": "给用户看的引导话术（verdict 不是 real/iteration 时必填，'
        '中文，友好、具体、不说教，直接告诉他可以怎么说）",\n'
        '  "rewrite": ["改写示例1", "改写示例2"],\n'
        f'  "device": {_judge_device_domain_bar()},\n'
        '  "deviceReason": "一句中文，说明按什么姿态判的"\n'
        "}\n\n"
        f"{_DEVICE_RUBRIC}\n\n"
        "判定纪律：\n"
        "- 拿不准就往宽了判（real/iteration）。误拦一个真需求的代价，远大于"
        "放过一句闲聊。\n"
        "- confidence 要诚实：模棱两可就给 0.5 以下，不要为了显得确定而虚高。\n"
        "- guidance 要针对用户这句话本身说，不要套模板。\n"
        # out_of_scope 的话术要求跟别的类不一样：别的类是"你说得不够清楚，
        # 再说说"，这一类是"你说得很清楚，但这件事我做不了"。后者如果也写成
        # "再多说两句"就是在骗人——用户补再多细节也变不出一个游戏引擎。
        "- 判成 out_of_scope 时，guidance 必须做到三件事：①一句话直说这个"
        "形态做不了，别绕弯子也别道歉三行；②说清做不了的是**哪一部分**"
        "（是实时画面？是硬件？是内容生成？）；③给出这件事**周边真做得了**"
        "的那个系统。rewrite 就填那个周边需求的完整说法，用户点一下就能改过去。\n"
        "  举例：「横版闯关小游戏」→ 做不了游戏画面本身，但「关卡素材与"
        "版本发布的审批流程」做得了；「智能水杯」→ 做不了硬件，但「饮水"
        "计划与每日打卡记录」做得了。"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": (text or "").strip()[:2000]},
    ]


_VALID_VERDICTS = {"real", "iteration", "vague", "off_topic", "meta", "out_of_scope"}
#: ⚠ 判定输出域 = 闸的合法域 + unspecified 哨兵。同源于账本（第四条）。
_VALID_DEVICES = _valid_judge_devices()


def _coerce(payload: dict[str, Any], *, has_app: bool) -> Judgement:
    """把 LLM 输出收敛成合法判定。任何不合法的字段都退回放行侧，不猜。"""
    verdict = str(payload.get("verdict") or "").strip()
    if verdict not in _VALID_VERDICTS:
        raise ValueError(f"verdict 非法: {verdict[:40]!r}")
    # 空会话不可能是 iteration——没有"现有应用"可改，这个方向的收敛是安全的。
    if verdict == "iteration" and not has_app:
        verdict = "real"
    # 反方向**不能**收敛（2026-07-28 移除）：原来这里有一句
    #     elif verdict == "real" and has_app: verdict = "iteration"
    # 它假设"已经有应用了就不可能再提新需求"，可用户完全可以在一个药店进销存
    # 应用旁边说「另外再给我做一套幼儿园接送打卡」。实测 9/9 跨领域新需求全被
    # 这行改写掉——模型 reason 里明明白白写着「属于全新需求」，verdict 却被
    # 覆盖成 iteration，理由和标签自相矛盾。规则表把 real 加回候选也没用，
    # 因为改写发生在模型输出之后。判"是不是同一件事"是模型的活，不是这里的。
    try:
        confidence = float(payload.get("confidence"))
    except (TypeError, ValueError):
        confidence = 0.5
    confidence = min(1.0, max(0.0, confidence))
    rewrite = payload.get("rewrite")
    rewrite = [str(x)[:80] for x in rewrite][:3] if isinstance(rewrite, list) else []
    # 设备档：不合法一律落 unspecified，**不猜**。这里最要紧的是别把"模型没
    # 回这个字段"和"模型判成桌面"混成一件事——前者应该两档都生成，后者才该
    # 只生成桌面档。所以缺省值是 unspecified 而不是 desktop。
    device = str(payload.get("device") or "").strip().lower()
    if device not in _VALID_DEVICES:
        device = "unspecified"
    return Judgement(
        verdict=verdict,  # type: ignore[arg-type]
        action=_resolve_action(verdict, confidence),  # type: ignore[arg-type]
        reason=str(payload.get("reason") or "")[:200],
        guidance=str(payload.get("guidance") or "")[:400],
        rewrite=rewrite,
        confidence=confidence,
        source="llm",
        device=device,  # type: ignore[arg-type]
        device_reason=str(payload.get("deviceReason") or "")[:200],
    )


# 低于这个置信度不提示——模型自己都不确定，就别去打扰用户。
_HINT_CONFIDENCE_FLOOR = 0.6


def _resolve_action(verdict: Verdict, confidence: float) -> Action:
    """判决 → 动作。这是唯一决定"要不要打扰用户"的地方；第一版永远不返回
    阻断动作，blocking 开关留给误判率收敛之后。"""
    if verdict in ("real", "iteration"):
        return "proceed"
    # out_of_scope 走的是跟 off_topic/meta/vague 同一条路，共用同一个置信度地板。
    # 想过给它单独调低地板（漏掉一个超纲的代价是白烧一整轮，比漏掉一句闲聊贵），
    # 但没这么做：地板调低，被误伤的就是那批"带技术领域词的真需求"（设备巡检、
    # 电竞报名、3D 打印排产），而误伤真需求才是这条链路最贵的错误。地板要动，
    # 得先在评测台上看到误伤为 0。
    if confidence < _HINT_CONFIDENCE_FLOOR:
        return "proceed"  # 判不准就别提示，宁可放过
    return "hint"


def judge_turn(
    text: str,
    *,
    has_app: bool = False,
    app_summary: str = "",
    llm_json_fn: Optional[Any] = None,
) -> Judgement:
    """判定一轮输入。**任何异常都不外抛**——出问题一律放行（fail-open）。

    llm_json_fn 只为测试注入；生产走 sliderule_llm.structured。"""
    if not judge_enabled():
        return Judgement(verdict="real" if not has_app else "iteration",
                         action="proceed", source="degraded",
                         degraded_reason="judge disabled by env")

    hit = precheck(text, has_app=has_app)
    if hit is not None:
        return hit

    fallback_verdict: Verdict = "iteration" if has_app else "real"
    try:
        messages = build_messages(text, has_app=has_app, app_summary=app_summary)
        if llm_json_fn is not None:
            payload = llm_json_fn(messages)
        else:
            from sliderule_llm.structured import structured_llm_json

            payload = structured_llm_json(
                messages, required_keys=_REQUIRED_KEYS,
                temperature=0.0, max_tokens=default_max_tokens(), max_retries=1,
            )
        if not isinstance(payload, dict):
            raise ValueError("payload 不是对象")
        return _coerce(payload, has_app=has_app)
    except Exception as exc:  # noqa: BLE001 — 闸门坏了不能变成产品坏了
        return Judgement(
            verdict=fallback_verdict, action="proceed", source="degraded",
            degraded_reason=f"{type(exc).__name__}: {str(exc)[:160]}",
        )
