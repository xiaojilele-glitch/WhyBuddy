import { describe, expect, it, beforeEach } from "vitest";
import {
  loadSelectedSkillSlugs,
  saveSelectedSkillSlugs,
  selectedSkillsDrivePayload,
} from "../skill-store-client";

const mem: Record<string, string> = {};
const fake = {
  getItem: (key: string) => mem[key] ?? null,
  setItem: (key: string, value: string) => {
    mem[key] = value;
  },
  removeItem: (key: string) => {
    delete mem[key];
  },
  clear: () => {
    for (const key of Object.keys(mem)) delete mem[key];
  },
};

describe("selectedSkills", () => {
  beforeEach(() => {
    fake.clear();
    (globalThis as { sessionStorage?: typeof fake }).sessionStorage = fake;
  });

  it("勾选已撤：即使 storage 里还有旧名单，勾选载荷也不带 selectedSkills", () => {
    expect(selectedSkillsDrivePayload()).toBeUndefined();
    saveSelectedSkillSlugs(["sliderule"]);
    expect(loadSelectedSkillSlugs()).toEqual(["sliderule"]);
    expect(selectedSkillsDrivePayload()).toBeUndefined();
  });
});
