# -*- coding: utf-8 -*-
"""一次性写出 index.json。清单以写出的 JSON 为准，本文件只是生成器。"""

from __future__ import annotations

import json
from pathlib import Path

A = "https://codeload.github.com/anthropics/skills/zip/refs/heads/main"
O = "https://codeload.github.com/addyosmani/web-quality-skills/zip/refs/heads/main"
S = "https://codeload.github.com/obra/superpowers/zip/refs/heads/main"
W = "https://codeload.github.com/wshobson/agents/zip/refs/heads/main"
F = "https://codeload.github.com/lamvu211/office-skills/zip/refs/heads/main"
Y = "https://codeload.github.com/SugarMGP/study.skill/zip/refs/heads/main"

AH = "https://github.com/anthropics/skills/tree/main/skills"
OH = "https://github.com/addyosmani/web-quality-skills/tree/main/skills"
SH = "https://github.com/obra/superpowers/tree/main/skills"
WH = "https://github.com/wshobson/agents/tree/main/plugins"
FH = "https://github.com/lamvu211/office-skills"
YH = "https://github.com/SugarMGP/study.skill"


def p(
    slug: str,
    name: str,
    description: str,
    *,
    license: str,
    source_url: str,
    category: str,
    archive: str,
) -> dict[str, str]:
    return {
        "slug": slug,
        "name": name,
        "description": description,
        "version": "1.0.0",
        "license": license,
        "source_url": source_url,
        "category": category,
        "archive": archive,
    }


def anth(slug: str, name: str, description: str, category: str) -> dict[str, str]:
    return p(
        slug, name, description,
        license="Apache-2.0",
        source_url=f"{AH}/{slug}",
        category=category,
        archive=A,
    )


def osm(slug: str, name: str, description: str, category: str) -> dict[str, str]:
    return p(
        slug, name, description,
        license="MIT",
        source_url=f"{OH}/{slug}",
        category=category,
        archive=O,
    )


def sup(slug: str, name: str, description: str, category: str) -> dict[str, str]:
    return p(
        slug, name, description,
        license="MIT",
        source_url=f"{SH}/{slug}",
        category=category,
        archive=S,
    )


def wsh(plugin: str, slug: str, name: str, description: str, category: str) -> dict[str, str]:
    return p(
        slug, name, description,
        license="MIT",
        source_url=f"{WH}/{plugin}/skills/{slug}",
        category=category,
        archive=W,
    )


def root(
    slug: str,
    name: str,
    description: str,
    category: str,
    *,
    archive: str,
    source_url: str,
) -> dict[str, str]:
    return p(
        slug, name, description,
        license="MIT",
        source_url=source_url,
        category=category,
        archive=archive,
    )


PACKAGES = [
    anth("webapp-testing", "Playwright Web 应用测试", "用 Playwright 测本地网页：点、填、读控制台。", "测试"),
    anth("mcp-builder", "MCP 服务构建", "按指南搭 MCP 服务器，带初始化与评估脚本。", "开发工具"),
    anth("frontend-design", "Anthropic 前端界面设计", "做有辨识度的前端界面，躲开千篇一律的 AI 审美。", "界面设计"),
    anth("web-artifacts-builder", "Claude.ai Web 应用构建", "用 React、Tailwind 和 shadcn/ui 搭带状态和路由的网页。", "开发工具"),
    anth("algorithmic-art", "p5.js 算法艺术创作", "用 p5.js 做原创算法艺术：种子随机、流场、粒子。", "界面设计"),
    anth("brand-guidelines", "Anthropic 品牌视觉规范", "把 Anthropic 的官方色和字体用到页面或文稿上。", "界面设计"),
    anth("theme-factory", "Anthropic 主题样式生成", "给幻灯片、文档、报告套现成主题，也能现做一套。", "界面设计"),
    anth("canvas-design", "Anthropic 视觉画布设计", "按设计原则出海报和视觉稿，输出 png 或 pdf。", "内容创作"),
    anth("doc-coauthoring", "Anthropic 文档协作写作", "带着用户一步步写文档、提案、规格和决策记录。", "内容创作"),
    anth("internal-comms", "Anthropic 内部沟通写作", "按公司常用格式写状态汇报、事故说明和 FAQ。", "办公"),
    root(
        "office-skills",
        "Office 出文件",
        "做 Word、Excel、PPT、PDF：建、改、出表，不靠单独装一套 Office。",
        "办公",
        archive=F,
        source_url=FH,
    ),
    wsh("pptx-deck-creation", "pptx-slide-specification", "演示文稿规格", "先把每一页写清，再画 PPT，别一上来堆标题加条目。", "办公"),
    wsh("pptx-deck-creation", "pptx-deck-context", "演示文稿上下文", "听众、时长、场合先钉住，再决定讲什么。", "办公"),
    wsh("pptx-deck-creation", "pptx-quality-gates", "演示文稿验收", "页数、字号、对比，交差前过一遍。", "办公"),
    wsh("file-conversion", "file-conversion", "办公文件互转", "在常见文档格式之间转，转完核对内容还在。", "办公"),
    root(
        "study",
        "学习讲义与复习",
        "从目标出大纲、讲义和练习，再用间隔复习盯掌握度。",
        "办公",
        archive=Y,
        source_url=YH,
    ),
    osm("accessibility", "WCAG 无障碍检查", "按 WCAG 2.2 查对比、键盘、读屏。有 Lighthouse 就用量，没有就看源码。", "测试"),
    osm("web-quality-audit", "网页质量验收", "用证据查性能、无障碍、SEO。先量再改，分数不当证明。", "测试"),
    osm("performance", "网页性能优化", "查加载和运行慢在哪，先量再改。", "测试"),
    osm("core-web-vitals", "核心网页指标", "对 LCP、INP、CLS，用测量说话。", "测试"),
    osm("seo", "搜索可见性检查", "查标题、抓取、结构化数据，不保证排名。", "测试"),
    osm("best-practices", "网页稳妥做法", "查安全头、过时接口、控制台报错。", "测试"),
    sup("systematic-debugging", "系统排查", "出 bug 先查根因，再动手改。不许猜着补。", "开发工具"),
    sup("verification-before-completion", "交差先对证据", "说做完之前，先把验证命令跑一遍，拿输出再说。", "测试"),
    sup("requesting-code-review", "提审前整理", "把 diff 和说明理清楚再给人看。", "开发工具"),
    sup("receiving-code-review", "收下评审意见", "一条条对，改完再回。", "开发工具"),
    wsh("frontend-mobile-development", "react-state-management", "React 状态管理", "用 Zustand、Jotai、React Query 管页面状态。", "开发工具"),
    wsh("frontend-mobile-development", "nextjs-app-router-patterns", "Next.js 路由写法", "按 App Router 搭页面、服务端组件和流式输出。", "开发工具"),
    wsh("frontend-mobile-development", "tailwind-design-system", "Tailwind 设计系统", "用 Tailwind 搭组件库和主题。", "界面设计"),
    wsh("ui-design", "design-system-patterns", "设计系统搭法", "用 token、组件和主题把界面收成一套。", "界面设计"),
    wsh("ui-design", "responsive-design", "自适应布局", "用 Grid、Flex 和容器查询把页面铺开。", "界面设计"),
    wsh("ui-design", "interaction-design", "交互与动效", "做微交互、动画和手势，别为动而动。", "界面设计"),
    wsh("ui-design", "visual-design-foundations", "视觉基础", "字号、颜色、间距和层次先摆正。", "界面设计"),
    wsh("ui-design", "web-component-design", "Web 组件设计", "做可复用、可访问的自定义元素。", "界面设计"),
    wsh("ui-design", "accessibility-compliance", "界面无障碍落地", "按 WCAG 补 ARIA 和键盘路径。", "测试"),
    wsh("ui-design", "mobile-ios-design", "iOS 界面规范", "按苹果人机指南排 iOS 界面。", "界面设计"),
    wsh("ui-design", "mobile-android-design", "Android 界面规范", "按 Material 3 排 Android 界面。", "界面设计"),
    wsh("ui-design", "react-native-design", "React Native 界面", "一套代码两头看的跨端界面写法。", "界面设计"),
    wsh("frontend-mobile-development", "react-native-architecture", "React Native 架构", "导航和原生模块怎么拆。", "开发工具"),
    wsh("framework-migration", "react-modernization", "React 现代化", "旧 React 迁到 Hooks 和并发特性。", "开发工具"),
    wsh("javascript-typescript", "typescript-advanced-types", "TypeScript 类型手艺", "泛型、条件类型，把类型写准。", "开发工具"),
    wsh("javascript-typescript", "nodejs-backend-patterns", "Node 后端写法", "用 Express 或 Fastify 搭能上线的服务。", "开发工具"),
    wsh("javascript-typescript", "javascript-testing-patterns", "JS 测试写法", "用 Jest、Vitest、Testing Library 写行为测试。", "测试"),
    wsh("javascript-typescript", "modern-javascript-patterns", "现代 JavaScript", "async/await、解构、函数式，按现在的写法来。", "开发工具"),
    wsh("python-development", "async-python-patterns", "Python 异步写法", "asyncio 和并发，别把事件循环堵死。", "开发工具"),
    wsh("python-development", "python-testing-patterns", "Python 测试写法", "pytest、夹具、mock，测行为不测实现。", "测试"),
    wsh("python-development", "python-packaging", "Python 打包发布", "包结构理清，再往 PyPI 推。", "开发工具"),
    wsh("python-development", "python-performance-optimization", "Python 性能排查", "先 profile，再改真正慢的地方。", "开发工具"),
    wsh("python-development", "uv-package-manager", "uv 包管理", "用 uv 建环境、锁依赖，少等 pip。", "开发工具"),
    wsh("python-development", "python-background-jobs", "Python 后台任务", "队列和定时活怎么拆，别堵请求。", "开发工具"),
    wsh("python-development", "python-code-style", "Python 代码风格", "命名、格式、工具链按一套来。", "开发工具"),
    wsh("shell-scripting", "bats-testing-patterns", "Bash 测试", "用 Bats 给壳脚本写能跑的测试。", "测试"),
    wsh("systems-programming", "memory-safety-patterns", "内存安全写法", "所有权、越界检查、消毒器，少留野指针。", "开发工具"),
    wsh("python-development", "python-design-patterns", "Python 设计模式", "常用结构怎么落到 Python 里。", "开发工具"),
    wsh("python-development", "python-error-handling", "Python 错误处理", "异常要有边界，别吞、别裸 raise。", "开发工具"),
    wsh("python-development", "python-observability", "Python 可观测", "日志、指标、追踪怎么埋。", "开发工具"),
    wsh("python-development", "python-project-structure", "Python 项目结构", "包、测试、脚本各放哪。", "开发工具"),
    wsh("python-development", "python-resilience", "Python 韧性", "超时、重试、熔断，失败要收得住。", "开发工具"),
    wsh("python-development", "python-resource-management", "Python 资源管理", "文件、连接、锁，用完要还。", "开发工具"),
    wsh("python-development", "python-type-safety", "Python 类型安全", "类型标注和检查，别靠猜。", "开发工具"),
    wsh("api-scaffolding", "fastapi-templates", "FastAPI 项目模板", "按异步和错误处理搭一套能开干的骨架。", "开发工具"),
    wsh("backend-development", "api-design-principles", "API 设计原则", "REST 和 GraphQL 怎么设计才好用、好维护。", "开发工具"),
    wsh("backend-development", "architecture-patterns", "后端架构模式", "整洁架构、六边形、DDD，按边界拆。", "开发工具"),
    wsh("backend-development", "microservices-patterns", "微服务拆法", "服务边界、事件和韧性，别先拆成一地碎片。", "开发工具"),
    wsh("backend-development", "event-store-design", "事件存储设计", "事件流、快照、分区怎么摆。", "开发工具"),
    wsh("backend-development", "cqrs-implementation", "CQRS 落地", "读写模型分开，接受最终一致。", "开发工具"),
    wsh("backend-development", "projection-patterns", "读模型投影", "从事件流做出好查的视图。", "开发工具"),
    wsh("backend-development", "saga-orchestration", "分布式事务 Saga", "补偿和失败路径先写清。", "开发工具"),
    wsh("developer-essentials", "e2e-testing-patterns", "端到端测试", "用 Playwright 或 Cypress 覆盖关键路径。", "测试"),
    wsh("accessibility-compliance", "wcag-audit-patterns", "WCAG 审计步骤", "自动加手测，对照 WCAG 2.2 过一遍。", "测试"),
    wsh("accessibility-compliance", "screen-reader-testing", "读屏测试", "NVDA、JAWS、VoiceOver 怎么走页面。", "测试"),
    wsh("security-scanning", "sast-configuration", "静态安全扫描", "把 SAST 接到仓库里，先抓住能自动抓的洞。", "测试"),
    wsh("security-scanning", "stride-analysis-patterns", "STRIDE 威胁分析", "按欺骗、篡改、抵赖几类把威胁列全。", "测试"),
    wsh("security-scanning", "attack-tree-construction", "攻击树", "从目标往下拆攻击路径。", "测试"),
    wsh("security-scanning", "security-requirement-extraction", "安全需求抽取", "从威胁模型写出可验收的安全要求。", "测试"),
    wsh("security-scanning", "threat-mitigation-mapping", "威胁与对策对照", "每个威胁对上缓解措施，并排优先级。", "测试"),
    wsh("payment-processing", "pci-compliance", "支付卡合规", "按 PCI DSS 看卡数据怎么收、怎么存。", "测试"),
    wsh("hr-legal-compliance", "gdpr-data-handling", "GDPR 数据处理", "同意、最小化、删除权，按规则收个人数据。", "测试"),
    wsh("developer-essentials", "error-handling-patterns", "错误处理写法", "异常、Result、降级，失败要看得见。", "开发工具"),
    wsh("developer-essentials", "code-review-excellence", "代码评审怎么评", "对事不对人，按清单看，少喷风格。", "开发工具"),
    wsh("developer-essentials", "auth-implementation-patterns", "登录与权限", "JWT、OAuth2、会话、RBAC，按场景选。", "开发工具"),
    wsh("developer-essentials", "git-advanced-workflows", "Git 进阶操作", "rebase、cherry-pick、bisect、worktree。", "开发工具"),
    wsh("developer-essentials", "sql-optimization-patterns", "SQL 优化", "索引、EXPLAIN、慢查询对着改。", "开发工具"),
    wsh("developer-essentials", "debugging-strategies", "调试策略", "复现、收证据、再下结论。", "开发工具"),
    wsh("developer-essentials", "monorepo-management", "Monorepo 管理", "Turborepo、Nx、pnpm workspace 怎么拆。", "开发工具"),
    wsh("developer-essentials", "nx-workspace-patterns", "Nx 工作区", "缓存和 affected，只重跑改过的。", "开发工具"),
    wsh("developer-essentials", "turborepo-caching", "Turborepo 缓存", "流水线和远程缓存怎么配。", "开发工具"),
    wsh("framework-migration", "dependency-upgrade", "依赖大版本升级", "先看兼容，再升，升完跑测试。", "开发工具"),
    wsh("documentation-generation", "openapi-spec-generation", "OpenAPI 规格生成", "从代码出完整的 OpenAPI 3.1。", "内容创作"),
    wsh("documentation-generation", "changelog-automation", "更新日志自动化", "从约定式提交攒 changelog。", "内容创作"),
    wsh("documentation-generation", "architecture-decision-records", "架构决策记录", "把为什么这么选写成 ADR。", "内容创作"),
    wsh("avoid-ai-writing", "avoid-ai-writing", "去掉 AI 腔", "把机翻腔改成人话，能只标就只标。", "内容创作"),
    wsh("business-analytics", "kpi-dashboard-design", "指标看板设计", "看板要能下钻，数字要能采取行动。", "办公"),
    wsh("business-analytics", "data-storytelling", "用数据讲清楚", "把洞察写成别人能听懂的故事。", "办公"),
    wsh("incident-response", "postmortem-writing", "复盘怎么写", "不追责，写清根因和下一步。", "内容创作"),
    wsh("database-design", "postgresql-table-design", "PostgreSQL 表设计", "按 Postgres 的脾气建表和约束。", "开发工具"),
    wsh("cicd-automation", "github-actions-templates", "GitHub Actions 模板", "测试、构建、发布的工作流怎么写。", "开发工具"),
    wsh("cicd-automation", "deployment-pipeline-design", "发布流水线", "多阶段、审批、安全检查怎么串。", "开发工具"),
    wsh("cicd-automation", "gitlab-ci-patterns", "GitLab CI 写法", "多阶段和分布式 runner 怎么配。", "开发工具"),
    wsh("framework-migration", "database-migration", "数据库迁移", "不停机迁数据，先写回滚。", "开发工具"),
    wsh("framework-migration", "angular-migration", "Angular 迁移", "AngularJS 迁到新 Angular，能渐进就渐进。", "开发工具"),
    wsh("shell-scripting", "bash-defensive-patterns", "Bash 防守写法", "生产脚本要设 -euo pipefail，少踩坑。", "开发工具"),
    wsh("shell-scripting", "shellcheck-configuration", "ShellCheck 配置", "用静态检查把壳脚本的坑扫出来。", "测试"),
    wsh("systems-programming", "rust-async-patterns", "Rust 异步写法", "Tokio、Future、错误怎么传。", "开发工具"),
    wsh("systems-programming", "go-concurrency-patterns", "Go 并发写法", "channel、worker pool、context 取消。", "开发工具"),
]


def main() -> None:
    slugs = [item["slug"] for item in PACKAGES]
    if len(slugs) != len(set(slugs)):
        dup = [s for s in slugs if slugs.count(s) > 1]
        raise SystemExit(f"duplicate_slug:{dup}")
    dest = Path(__file__).resolve().parent / "index.json"
    dest.write_text(
        json.dumps({"packages": PACKAGES}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(dest.name, len(PACKAGES))


if __name__ == "__main__":
    main()
