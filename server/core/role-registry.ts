/**
 * RoleRegistry — 角色模板注册表（全局单例）
 *
 * 管理角色模板的 CRUD、继承解析、变更审计和持久化。
 *
 * @see Requirements 1.2, 1.3, 1.4, 1.5
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RoleTemplate, RoleChangeLogEntry } from '../../shared/role-schema.js';

const __rr_filename = fileURLToPath(import.meta.url);
const __rr_dirname = dirname(__rr_filename);

function shouldPersistRoleRegistryByDefault(): boolean {
  if (
    process.env.WHYBUDDY_DISABLE_ROLE_PERSISTENCE === '1' ||
    process.env["CUBE_" + "PETS_DISABLE_ROLE_PERSISTENCE"] === '1'
  ) {
    return false;
  }

  if (process.env.NODE_ENV === 'test') {
    return false;
  }

  if (
    process.env.VITEST === 'true' ||
    process.env.VITEST_WORKER_ID !== undefined ||
    process.env.VITEST_POOL_ID !== undefined
  ) {
    return false;
  }

  return true;
}

const DEFAULT_STORE_PATH = shouldPersistRoleRegistryByDefault()
  ? resolve(__rr_dirname, '../../data/role-templates.json')
  : null;

/** Persistence file schema */
interface RoleTemplateStore {
  templates: RoleTemplate[];
  changeLog: RoleChangeLogEntry[];
}

class RoleRegistry {
  private templates: Map<string, RoleTemplate> = new Map();
  private changeLog: RoleChangeLogEntry[] = [];
  private storePath: string | null;

  constructor(storePath?: string | null) {
    this.storePath = storePath === undefined ? DEFAULT_STORE_PATH : storePath;
    this.load();
  }

  /**
   * Register a role template. If the roleId already exists, treat as modification.
   */
  register(template: RoleTemplate, changedBy = 'system'): void {
    const existing = this.templates.get(template.roleId);

    if (existing) {
      // Modification — compute diff
      const diff = this.computeDiff(existing, template);
      this.templates.set(template.roleId, template);
      this.appendLog({
        roleId: template.roleId,
        changedBy,
        changedAt: new Date().toISOString(),
        action: 'modified',
        diff,
      });
    } else {
      // Creation
      this.templates.set(template.roleId, template);
      this.appendLog({
        roleId: template.roleId,
        changedBy,
        changedAt: new Date().toISOString(),
        action: 'created',
        diff: {},
      });
    }

    this.persist();
  }

  /**
   * Get a role template by roleId (raw, without inheritance resolution).
   */
  get(roleId: string): RoleTemplate | undefined {
    return this.templates.get(roleId);
  }

  /**
   * List all registered role templates.
   */
  list(): RoleTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Unregister (deprecate) a role template.
   */
  unregister(roleId: string, changedBy = 'system'): void {
    const existing = this.templates.get(roleId);
    if (!existing) return;

    this.templates.delete(roleId);
    this.appendLog({
      roleId,
      changedBy,
      changedAt: new Date().toISOString(),
      action: 'deprecated',
      diff: {},
    });

    this.persist();
  }

  /**
   * Resolve a role template with full inheritance chain merged.
   *
   * - responsibilityPrompt = parent prompt + "\n\n" + child prompt
   * - requiredSkillIds = union(parent, child)
   * - mcpIds = union(parent, child)
   * - Other fields (authorityLevel, defaultModelConfig) use child values
   * - Detects circular inheritance and throws error
   */
  resolve(roleId: string): RoleTemplate {
    const visited = new Set<string>();
    return this.resolveRecursive(roleId, visited);
  }

  private resolveRecursive(roleId: string, visited: Set<string>): RoleTemplate {
    if (visited.has(roleId)) {
      throw new Error(
        `[RoleRegistry] Circular inheritance detected: ${[...Array.from(visited), roleId].join(' -> ')}`
      );
    }

    const template = this.templates.get(roleId);
    if (!template) {
      throw new Error(`[RoleRegistry] Role not found: ${roleId}`);
    }

    if (!template.extends) {
      return { ...template };
    }

    visited.add(roleId);
    const parent = this.resolveRecursive(template.extends, visited);

    return {
      ...template,
      responsibilityPrompt: parent.responsibilityPrompt + '\n\n' + template.responsibilityPrompt,
      requiredSkillIds: Array.from(new Set([...parent.requiredSkillIds, ...template.requiredSkillIds])),
      mcpIds: Array.from(new Set([...parent.mcpIds, ...template.mcpIds])),
    };
  }

  /**
   * Get change log entries, optionally filtered by roleId.
   */
  getChangeLog(roleId?: string): RoleChangeLogEntry[] {
    if (roleId) {
      return this.changeLog.filter((entry) => entry.roleId === roleId);
    }
    return [...this.changeLog];
  }

  // ── Private helpers ──────────────────────────────────────────────

  private appendLog(entry: RoleChangeLogEntry): void {
    this.changeLog.push(entry);
  }

  /**
   * Compute a shallow diff between two role templates.
   * Only tracks fields that actually changed.
   */
  private computeDiff(
    oldT: RoleTemplate,
    newT: RoleTemplate
  ): Record<string, { old: unknown; new: unknown }> {
    const diff: Record<string, { old: unknown; new: unknown }> = {};
    const keys: (keyof RoleTemplate)[] = [
      'roleName',
      'responsibilityPrompt',
      'requiredSkillIds',
      'mcpIds',
      'defaultModelConfig',
      'authorityLevel',
      'source',
      'extends',
      'compatibleRoles',
      'incompatibleRoles',
    ];

    for (const key of keys) {
      const oldVal = oldT[key];
      const newVal = newT[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        diff[key] = { old: oldVal, new: newVal };
      }
    }

    return diff;
  }

  // ── Persistence ──────────────────────────────────────────────────

  private load(): void {
    if (!this.storePath) {
      return;
    }

    if (!existsSync(this.storePath)) {
      console.log(`[RoleRegistry] No persistence file found, starting empty: ${this.storePath}`);
      return;
    }

    try {
      const raw = readFileSync(this.storePath, 'utf-8');
      const parsed = JSON.parse(raw) as RoleTemplateStore;

      if (Array.isArray(parsed.templates)) {
        for (const t of parsed.templates) {
          this.templates.set(t.roleId, t);
        }
      }

      if (Array.isArray(parsed.changeLog)) {
        this.changeLog = parsed.changeLog;
      }

      console.log(
        `[RoleRegistry] Loaded ${this.templates.size} templates, ${this.changeLog.length} log entries`
      );
    } catch {
      console.warn(`[RoleRegistry] Persistence file corrupted, starting empty: ${this.storePath}`);
    }
  }

  private persist(): void {
    if (!this.storePath) {
      return;
    }

    const data: RoleTemplateStore = {
      templates: Array.from(this.templates.values()),
      changeLog: this.changeLog,
    };

    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[RoleRegistry] Persistence write failed:', err);
    }
  }
}

export const roleRegistry = new RoleRegistry();

/** 导出类型供测试使用 */
export { RoleRegistry };
