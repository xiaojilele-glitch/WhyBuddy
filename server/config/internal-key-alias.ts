/**
 * 内部密钥的变量名归一（2026-08-04）。
 *
 * ## 这里在解决什么
 *
 * Node 和 Python 守的是**同一把钥匙**，但读的是**两个不同的环境变量名**：
 *
 *     Node   → PYTHON_SLIDE_RULE_INTERNAL_KEY   （"我发给 Python 的那把"，12 个文件在读）
 *     Python → SLIDE_RULE_INTERNAL_KEY          （"我要求来访者出示的那把"）
 *
 * 两边的默认值恰好都是 `dev-slide-rule-internal`，所以在**都不配**的时候能对上
 * ——这是个巧合，不是设计。一旦只配了其中一个，Node 发的和 Python 认的就是两个
 * 值，**每一次 Node→Python 的内部调用都会 403**，而现象是"整个应用没反应"，
 * 没人会想到是两个环境变量名不一样。
 *
 * 这个坑是 2026-08-04「出厂密码不许上生产」那次改动**激活**的：在那之前谁也
 * 不会去改这个值，两边永远同时用默认值；之后 Python 端在生产环境会强制要求
 * 换掉，于是"只配了 Python 那个"成了最自然、也最容易踩的操作。
 *
 * ## 为什么是别名而不是改名
 *
 * 改名要动 12 个文件加各自的测试，而这两个名字在各自的语境里都是对的
 * （一个是"我要发的"、一个是"我要收的"）。所以保留两个名字，在**进程启动最早
 * 处做一次单向兜底**：Node 那个没配、通用那个配了，就把值抄过去。
 *
 * 单向、且只在缺失时生效——显式配了 `PYTHON_SLIDE_RULE_INTERNAL_KEY` 的部署
 * （比如 Node 和 Python 之间隔着网关、两段用不同的钥匙）行为完全不变。
 *
 * 于是运维只需要配**一个** `SLIDE_RULE_INTERNAL_KEY`，两边自动一致。
 */

const NODE_SIDE = "PYTHON_SLIDE_RULE_INTERNAL_KEY";
const SHARED = "SLIDE_RULE_INTERNAL_KEY";

export function applyInternalKeyAlias(env: NodeJS.ProcessEnv = process.env): void {
  const explicit = (env[NODE_SIDE] || "").trim();
  if (explicit) return; // 显式配了就尊重它，别覆盖

  const shared = (env[SHARED] || "").trim();
  if (!shared) return; // 两个都没配 → 各自走默认值（本地开发的常态）

  env[NODE_SIDE] = shared;
  console.log(
    `[config] ${NODE_SIDE} 未配置，已沿用 ${SHARED}` +
      "（两者必须一致，否则 Node→Python 的内部调用会全部 403）"
  );
}
