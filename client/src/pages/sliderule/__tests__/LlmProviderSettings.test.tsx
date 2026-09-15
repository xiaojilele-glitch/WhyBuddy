/**
 * LlmProviderSettings（极简版）组件回归测试。
 *
 * 定位：浏览器直连是备用通道，UI 收敛到功能骨架——选厂商/启用/密钥/
 * Base URL/模型/测试连接。本文件同时守住"重装饰不回潮"的负向断言
 * （无模型 CRUD、无能力标签、无调度策略）。
 *
 * 本仓库 React 组件测试约定：react-dom/server renderToStaticMarkup，
 * 只断言初始静态渲染；交互逻辑测纯函数（providerStatus 等）。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LlmProviderSettings, TestConnectionResult } from "../LlmProviderSettings";
import {
  compileToByokPool,
  defaultProvidersConfig,
  isEnabledProviderReady,
  modelSuggestionsFor,
  providerStatus,
  validateProviderConfig,
  type LlmProvidersConfig,
} from "@/lib/sliderule-llm-providers";

describe("Atlas Cloud preset", () => {
  it("seeds a disabled OpenAI-compatible provider with current model suggestions", () => {
    const atlas = defaultProvidersConfig().providers.find((p) => p.presetId === "atlascloud");

    expect(atlas).toMatchObject({
      name: "Atlas Cloud",
      protocol: "openai",
      baseUrl: "https://api.atlascloud.ai/v1",
      enabled: false,
    });
    expect(atlas?.models[0].id).toBe("openai/gpt-5.6-luna");
    expect(modelSuggestionsFor("atlascloud")).toContain("anthropic/claude-sonnet-4.6");
  });

  it("compiles the enabled preset to the Atlas chat-completions endpoint", () => {
    const config = defaultProvidersConfig();
    const atlas = config.providers.find((p) => p.presetId === "atlascloud");
    expect(atlas).toBeDefined();
    if (!atlas) return;

    atlas.enabled = true;
    atlas.apiKey = "atlas-test-key";

    expect(compileToByokPool(config).entries).toContainEqual(
      expect.objectContaining({
        presetId: "atlascloud",
        endpoint: "https://api.atlascloud.ai/v1/chat/completions",
        model: "openai/gpt-5.6-luna",
      })
    );
  });
});

function makeDraft(over?: Partial<LlmProvidersConfig>): LlmProvidersConfig {
  return {
    version: 1,
    dispatch: "least-busy",
    raceMode: false,
    providers: [
      {
        id: "openai",
        presetId: "openai",
        name: "OpenAI",
        protocol: "openai",
        apiKey: "sk-live-123",
        requiresApiKey: true,
        baseUrl: "https://api.openai.com/v1",
        enabled: true,
        models: [{ id: "gpt-4o-mini", capabilities: ["tools", "stream"], enabled: true }],
      },
      {
        id: "anthropic",
        presetId: "anthropic",
        name: "Claude",
        protocol: "anthropic",
        apiKey: "",
        requiresApiKey: true,
        baseUrl: "https://api.anthropic.com/v1",
        enabled: false,
        models: [{ id: "claude-3-5-sonnet-20241022", capabilities: ["tools", "stream"], enabled: true }],
      },
    ],
    ...over,
  };
}

const noop = () => {};

describe("providerStatus（状态点派生）", () => {
  const base = makeDraft().providers[0];
  it("enabled + 有 key → ready", () => {
    expect(providerStatus({ ...base, enabled: true, apiKey: "sk-x" })).toBe("ready");
  });
  it("requiresApiKey 但 key 空 → needs-key（即便 enabled）", () => {
    expect(providerStatus({ ...base, enabled: true, apiKey: "  " })).toBe("needs-key");
  });
  it("有 key 但未启用 → configured", () => {
    expect(providerStatus({ ...base, enabled: false, apiKey: "sk-x" })).toBe("configured");
  });
  it("本地服务（不需 key）未启用 → configured", () => {
    expect(providerStatus({ ...base, enabled: false, requiresApiKey: false, apiKey: "" })).toBe("configured");
  });
});

describe("校验纯函数（保存守卫复用）", () => {
  const p = makeDraft().providers[0];
  it("validateProviderConfig：缺密钥 / 非 http(s) Base URL", () => {
    expect(validateProviderConfig({ ...p, apiKey: "" }).keyError).toContain("密钥");
    expect(validateProviderConfig({ ...p, baseUrl: "ftp://x" }).baseUrlError).toContain("http");
    expect(validateProviderConfig(p)).toEqual({ keyError: null, baseUrlError: null });
  });
  it("isEnabledProviderReady：空 Base URL 的启用厂商不可保存", () => {
    expect(isEnabledProviderReady({ ...p, baseUrl: "" })).toBe(false);
    expect(isEnabledProviderReady(p)).toBe(true);
  });
});

describe("LlmProviderSettings 极简面板", () => {
  it("功能骨架都在：厂商列表 / 启用 / 密钥 / Base URL / 模型 / 测试连接", () => {
    const html = renderToStaticMarkup(<LlmProviderSettings draft={makeDraft()} setDraft={noop} />);
    expect(html).toContain('data-testid="sliderule-provider-list"');
    expect(html).toContain("OpenAI");
    expect(html).toContain("Claude");
    expect(html).toContain('data-testid="sliderule-provider-enabled"');
    expect(html).toContain('data-testid="sliderule-provider-key"');
    expect(html).toContain('data-testid="sliderule-provider-baseurl"');
    expect(html).toContain('data-testid="sliderule-provider-model"');
    expect(html).toContain('data-testid="sliderule-provider-test"');
    // 模型输入预填当前启用模型
    expect(html).toContain("gpt-4o-mini");
    // 密钥安全承诺文案保留
    expect(html).toContain("仅存本机浏览器");
  });

  it("首个厂商默认选中（aria-current），启用厂商带状态点", () => {
    const html = renderToStaticMarkup(<LlmProviderSettings draft={makeDraft()} setDraft={noop} />);
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('data-status="ready"'); // OpenAI: enabled + key
  });

  it("重装饰不回潮：无模型 CRUD / 能力标签 / 调度策略 / 排序控件", () => {
    const html = renderToStaticMarkup(<LlmProviderSettings draft={makeDraft()} setDraft={noop} />);
    expect(html).not.toContain("新建模型");
    expect(html).not.toContain("拉取模型列表");
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("分发策略");
    expect(html).not.toContain("raceMode");
    expect(html).not.toContain("上移");
  });

  it("启用但缺密钥时行内标红提示", () => {
    const draft = makeDraft();
    draft.providers[0].apiKey = "";
    const html = renderToStaticMarkup(<LlmProviderSettings draft={draft} setDraft={noop} />);
    expect(html).toContain("请填写密钥");
  });

  it("自定义厂商：列表带添加按钮；custom-* 项可改名/选协议/删除，预设项不可", () => {
    const draft = makeDraft();
    draft.providers.unshift({
      id: "custom-abc123",
      presetId: "custom",
      name: "我的中转",
      protocol: "openai",
      apiKey: "sk-relay",
      requiresApiKey: true,
      baseUrl: "https://relay.example.com/v1",
      enabled: true,
      models: [{ id: "gpt-4o", capabilities: ["tools", "stream"], enabled: true }],
    });
    const html = renderToStaticMarkup(<LlmProviderSettings draft={draft} setDraft={noop} />);
    expect(html).toContain('data-testid="sliderule-provider-add-custom"');
    // 首项（自定义）默认选中 → 改名输入框 + 协议选择 + 删除按钮
    expect(html).toContain('data-testid="sliderule-provider-name"');
    expect(html).toContain('data-testid="sliderule-provider-protocol"');
    expect(html).toContain('data-testid="sliderule-provider-remove"');
    expect(html).toContain("我的中转");
    // 预设厂商渲染（未选中态）无删除入口——只有一处 remove testid
    expect(html.match(/sliderule-provider-remove/g)?.length).toBe(1);
  });

  it("预设厂商选中时不渲染改名/协议/删除控件", () => {
    const html = renderToStaticMarkup(<LlmProviderSettings draft={makeDraft()} setDraft={noop} />);
    expect(html).not.toContain('data-testid="sliderule-provider-name"');
    expect(html).not.toContain('data-testid="sliderule-provider-protocol"');
    expect(html).not.toContain('data-testid="sliderule-provider-remove"');
  });
});

describe("TestConnectionResult 三态", () => {
  it("idle 不渲染 / 成功带模型+延迟 / 失败带原因", () => {
    expect(renderToStaticMarkup(<TestConnectionResult state={{ kind: "idle" }} />)).toBe("");
    const ok = renderToStaticMarkup(
      <TestConnectionResult state={{ kind: "ok", model: "gpt-4o-mini", latencyMs: 820 }} />
    );
    expect(ok).toContain("连接成功");
    expect(ok).toContain("gpt-4o-mini");
    expect(ok).toContain("820ms");
    const err = renderToStaticMarkup(
      <TestConnectionResult state={{ kind: "error", message: "401 未授权（密钥无效）" }} />
    );
    expect(err).toContain('data-state="error"');
    expect(err).toContain("401");
  });
});
