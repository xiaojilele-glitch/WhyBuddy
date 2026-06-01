/**
 * 仓库上下文抓取器 — 供澄清、路线生成、SPEC 树等阶段共用。
 *
 * 直接通过 GitHub REST API 获取仓库信息（不依赖 MCP bridge），
 * 生成一段可注入 LLM prompt 的仓库摘要文本。
 *
 * 设计要点：
 * - 使用 GitHub public API（无需 token 即可访问公开仓库）；
 * - 超时独立控制（默认 15 秒），不阻塞主流程；
 * - 失败时返回 undefined，调用方继续走无仓库上下文路径；
 * - 结果不缓存（避免过期数据），每次调用都重新抓取。
 */

import type { BlueprintLogger } from "./context.js";

/** 仓库上下文抓取结果。 */
export interface RepoContextResult {
  /** 仓库目录结构摘要（已截断）。 */
  treeDigest: string;
  /** 关键文件内容（package.json / README 等）。 */
  keyFiles: Array<{ path: string; content: string }>;
  /** 用于注入 prompt 的完整摘要文本。 */
  promptSummary: string;
}

/** 解析 GitHub URL 为 owner/repo。 */
function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const match = /github\.com[/:]([^/]+)\/([^/?#]+?)(?:\.git|\/.*|#.*|\?.*)?$/i.exec(url.trim());
  if (!match || !match[1] || !match[2]) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * 通过 GitHub REST API 抓取仓库上下文。
 *
 * 不依赖 MCP bridge，直接调用 GitHub public API：
 * - GET /repos/{owner}/{repo} — 仓库基本信息
 * - GET /repos/{owner}/{repo}/contents — 根目录文件列表
 * - GET /repos/{owner}/{repo}/contents/package.json — 关键配置文件
 *
 * @param githubUrl 仓库 URL
 * @param logger 日志
 * @param timeoutMs 超时（默认 15000ms）
 * @returns 仓库上下文，失败返回 undefined
 */
export async function fetchRepoContext(
  _mcpToolAdapter: unknown, // 保留参数签名兼容性，实际不使用
  githubUrl: string,
  logger: BlueprintLogger,
  timeoutMs = 15000,
): Promise<RepoContextResult | undefined> {
  const parsed = parseGithubUrl(githubUrl);
  if (!parsed) return undefined;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "whybuddy-blueprint",
    };
    // 如果有 GitHub token 可以提高 rate limit
    const ghToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (ghToken) {
      headers["Authorization"] = `Bearer ${ghToken}`;
    }

    // 1. 获取仓库基本信息
    const repoResp = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
      { headers, signal: controller.signal },
    );

    if (!repoResp.ok) {
      clearTimeout(timer);
      logger.debug("[repo-context] GitHub API failed", { status: repoResp.status });
      return undefined;
    }

    const repoData = await repoResp.json() as Record<string, unknown>;

    // 2. 获取根目录文件列表
    const contentsResp = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents`,
      { headers, signal: controller.signal },
    );

    let fileTree = "（无法获取目录结构）";
    if (contentsResp.ok) {
      const contents = await contentsResp.json() as Array<{ name: string; type: string; size?: number }>;
      fileTree = contents.map(f => `${f.type === "dir" ? "📁" : "📄"} ${f.name}`).join("\n");
    }

    // 3. 尝试获取 package.json
    let packageJson = "";
    try {
      const pkgResp = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/package.json`,
        { headers, signal: controller.signal },
      );
      if (pkgResp.ok) {
        const pkgData = await pkgResp.json() as { content?: string; encoding?: string };
        if (pkgData.content && pkgData.encoding === "base64") {
          packageJson = Buffer.from(pkgData.content, "base64").toString("utf-8");
        }
      }
    } catch {
      // package.json 不存在或获取失败，不影响主流程
    }

    clearTimeout(timer);

    // 构造摘要
    const repoInfo = [
      `仓库：${parsed.owner}/${parsed.repo}`,
      `描述：${repoData.description ?? "无"}`,
      `语言：${repoData.language ?? "未知"}`,
      `Stars：${repoData.stargazers_count ?? 0}`,
      `默认分支：${repoData.default_branch ?? "main"}`,
      `最近更新：${repoData.updated_at ?? "未知"}`,
    ].join("\n");

    const sections = [repoInfo, `\n### 根目录结构\n${fileTree}`];
    if (packageJson) {
      // 截断 package.json 到 2000 字符
      sections.push(`\n### package.json\n\`\`\`json\n${packageJson.slice(0, 2000)}\n\`\`\``);
    }

    const treeDigest = sections.join("\n");
    const promptSummary = `## 仓库分析结果（${parsed.owner}/${parsed.repo}）\n\n${treeDigest}`;

    logger.debug("[repo-context] GitHub API fetch succeeded", {
      owner: parsed.owner,
      repo: parsed.repo,
      length: promptSummary.length,
    });

    return {
      treeDigest,
      keyFiles: packageJson ? [{ path: "package.json", content: packageJson.slice(0, 2000) }] : [],
      promptSummary,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug("[repo-context] fetch failed", { error: msg });
    return undefined;
  }
}
