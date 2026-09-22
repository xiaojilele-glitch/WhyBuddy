/**
 * 已安装技能本地层测试。
 * 锁：幂等安装、卸载、localStorage round-trip、无存储环境静默降级。
 */
import { describe, it, expect, beforeEach } from "vitest";

const memStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage ??= {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() {
    return memStore.size;
  },
} as Storage;

import {
  installSkill,
  isInstalled,
  loadInstalledSkills,
  uninstallSkill,
} from "../installed-skills";

const SKILL = {
  repo: "github.com/x/novel-skill",
  url: "https://github.com/x/novel-skill",
  license: "MIT",
  name: "网络小说创作技能",
  description: "长篇小说大纲与章节生成",
  ioHints: ["输入：题材与设定", "输出：章节草稿"],
};

describe("installed-skills 本地层", () => {
  beforeEach(() => memStore.clear());

  it("安装→持久化→重载可见；同 repo 幂等；卸载移除", () => {
    expect(loadInstalledSkills()).toEqual([]);
    const v1 = installSkill([], SKILL);
    expect(v1).toHaveLength(1);
    expect(v1[0].installedAt).toBeTruthy();
    expect(isInstalled(v1, SKILL.repo)).toBe(true);

    // 幂等：重复安装返回原列表
    expect(installSkill(v1, SKILL)).toBe(v1);

    // round-trip
    const loaded = loadInstalledSkills();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("网络小说创作技能");

    const v2 = uninstallSkill(loaded, SKILL.repo);
    expect(v2).toEqual([]);
    expect(loadInstalledSkills()).toEqual([]);
  });
});

describe("推演注入载荷（技能库六期）", () => {
  beforeEach(() => memStore.clear());

  it("六字段仍带空数组，localStorage 安装不再冒充目录", async () => {
    const { installedSkillsDrivePayload } = await import("../installed-skills");
    expect(installedSkillsDrivePayload()).toEqual([]);
    installSkill([], {
      ...SKILL,
      repo: "github.com/x/skill-1",
      name: "不该进载荷",
    });
    expect(installedSkillsDrivePayload()).toEqual([]);
  });
});

describe("注入开关（输入条 + 菜单就地勾选）", () => {
  beforeEach(() => memStore.clear());

  it("默认注入；toggle 关掉后载荷剔除；再 toggle 恢复", async () => {
    const {
      installedSkillsDrivePayload,
      loadInjectDisabledKeys,
      toggleInjectDisabled,
    } = await import("../installed-skills");

    let list: ReturnType<typeof loadInstalledSkills> = [];
    list = installSkill(list, {
      ...SKILL,
      repo: "github.com/x/a",
      name: "技能A",
    });
    list = installSkill(list, {
      ...SKILL,
      repo: "github.com/x/b",
      name: "技能B",
    });

    expect(loadInjectDisabledKeys()).toEqual([]);
    expect(installedSkillsDrivePayload()).toEqual([]);

    toggleInjectDisabled("github.com/x/a");
    expect(loadInjectDisabledKeys()).toEqual(["github.com/x/a"]);
    expect(installedSkillsDrivePayload()).toEqual([]);

    toggleInjectDisabled("github.com/x/a");
    expect(installedSkillsDrivePayload()).toEqual([]);
  });
});
