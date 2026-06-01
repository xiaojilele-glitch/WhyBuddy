/**
 * RoleAnalyticsService — 角色使用率分析与告警（全局单例）
 *
 * 收集角色加载/卸载/切换/匹配评分指标，提供：
 * - Prometheus 风格的内存指标（role_load_total、role_active_duration_seconds、role_switch_total、role_match_score_histogram）
 * - 告警检查：ROLE_UNUSED（7 天无加载）和 AGENT_ROLE_THRASHING（24 小时内 > 20 次切换）
 * - 聚合查询：getRoleUsageSummary() 和 getAgentRoleDistribution()
 * - 持久化到 data/role-analytics.json
 *
 * @see Requirements 7.1, 7.2, 7.3, 7.4, 7.5
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RoleUsageSummary, AgentRoleDistribution } from '../../shared/role-schema.js';
import { roleRegistry, RoleRegistry } from './role-registry.js';

const __ra_filename = fileURLToPath(import.meta.url);
const __ra_dirname = dirname(__ra_filename);

function shouldPersistRoleAnalyticsByDefault(): boolean {
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

const DEFAULT_STORE_PATH = shouldPersistRoleAnalyticsByDefault()
  ? resolve(__ra_dirname, '../../data/role-analytics.json')
  : null;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const THRASHING_THRESHOLD = 20;

/** Persistence file schema */
interface RoleAnalyticsStore {
  roleLoadCounts: Record<string, number>;
  roleActiveDurations: Record<string, number>;
  agentSwitchCounts: Record<string, number>;
  matchScoreHistogram: number[];
  lastUpdated: string;
  /** roleId -> ISO timestamp of last load */
  roleLastLoadAt: Record<string, string>;
  /** agentId -> array of ISO timestamps */
  agentSwitchTimestamps: Record<string, string[]>;
  /** agentId -> roleId -> load count (for distribution) */
  agentRoleLoads: Record<string, Record<string, number>>;
}

export interface RoleAlert {
  type: 'ROLE_UNUSED' | 'AGENT_ROLE_THRASHING';
  detail: string;
}

class RoleAnalyticsService {
  // ── In-memory metrics (Prometheus-style counters) ──────────────

  /** role_load_total: grouped by roleId */
  private roleLoadCounts: Record<string, number> = {};
  /** role_active_duration_seconds: grouped by roleId */
  private roleActiveDurations: Record<string, number> = {};
  /** role_switch_total: grouped by agentId */
  private agentSwitchCounts: Record<string, number> = {};
  /** role_match_score_histogram: distribution of match scores */
  private matchScoreHistogram: number[] = [];

  // ── Alert detection data ──────────────────────────────────────

  /** roleId -> ISO timestamp of last load */
  private roleLastLoadAt: Record<string, string> = {};
  /** agentId -> array of ISO timestamps for switch events */
  private agentSwitchTimestamps: Record<string, string[]> = {};

  // ── Distribution tracking ─────────────────────────────────────

  /** agentId -> roleId -> load count */
  private agentRoleLoads: Record<string, Record<string, number>> = {};

  private storePath: string | null;
  private _getNow: () => Date;
  private _registry: RoleRegistry;

  constructor(storePath?: string | null, getNow?: () => Date, registry?: RoleRegistry) {
    this.storePath = storePath === undefined ? DEFAULT_STORE_PATH : storePath;
    this._getNow = getNow ?? (() => new Date());
    this._registry = registry ?? roleRegistry;
    this.load();
  }

  // ── Metric collection ─────────────────────────────────────────

  /**
   * Record a role load event.
   * Increments role_load_total and updates roleLastLoadAt.
   */
  recordRoleLoad(roleId: string, agentId?: string): void {
    this.roleLoadCounts[roleId] = (this.roleLoadCounts[roleId] ?? 0) + 1;
    this.roleLastLoadAt[roleId] = this._getNow().toISOString();

    // Track agent-role distribution
    if (agentId) {
      if (!this.agentRoleLoads[agentId]) {
        this.agentRoleLoads[agentId] = {};
      }
      this.agentRoleLoads[agentId][roleId] =
        (this.agentRoleLoads[agentId][roleId] ?? 0) + 1;
    }

    this.persist();
  }

  /**
   * Record a role unload event.
   * Accumulates role_active_duration_seconds.
   */
  recordRoleUnload(roleId: string, durationSeconds: number): void {
    this.roleActiveDurations[roleId] =
      (this.roleActiveDurations[roleId] ?? 0) + durationSeconds;
    this.persist();
  }

  /**
   * Record a role switch event for an agent.
   * Increments role_switch_total and stores timestamp for thrashing detection.
   */
  recordRoleSwitch(agentId: string): void {
    this.agentSwitchCounts[agentId] =
      (this.agentSwitchCounts[agentId] ?? 0) + 1;

    if (!this.agentSwitchTimestamps[agentId]) {
      this.agentSwitchTimestamps[agentId] = [];
    }
    this.agentSwitchTimestamps[agentId].push(this._getNow().toISOString());

    this.persist();
  }

  /**
   * Record a match score for histogram tracking.
   */
  recordMatchScore(score: number): void {
    this.matchScoreHistogram.push(score);
    this.persist();
  }

  // ── Alert checking ────────────────────────────────────────────

  /**
   * Check for active alerts.
   *
   * ROLE_UNUSED: role has roleLoadCounts > 0 but roleLastLoadAt is more than
   *   7 days ago, OR role is registered but has 0 loads for 7+ days.
   * AGENT_ROLE_THRASHING: agent has more than 20 switch timestamps within
   *   the last 24 hours.
   */
  checkAlerts(): RoleAlert[] {
    const alerts: RoleAlert[] = [];
    const now = this._getNow().getTime();

    // ── ROLE_UNUSED ─────────────────────────────────────────────
    // Check all registered roles
    const registeredRoles = this._registry.list();
    for (const role of registeredRoles) {
      const lastLoadStr = this.roleLastLoadAt[role.roleId];
      if (lastLoadStr) {
        // Role has been loaded before — check if last load was > 7 days ago
        const lastLoadTime = new Date(lastLoadStr).getTime();
        if (now - lastLoadTime > SEVEN_DAYS_MS) {
          alerts.push({
            type: 'ROLE_UNUSED',
            detail: `Role "${role.roleName}" (${role.roleId}) has not been loaded for over 7 days (last load: ${lastLoadStr})`,
          });
        }
      } else {
        // Role is registered but has never been loaded (0 loads)
        // Consider it unused if it was created more than 7 days ago
        const createdTime = new Date(role.createdAt).getTime();
        if (now - createdTime > SEVEN_DAYS_MS) {
          alerts.push({
            type: 'ROLE_UNUSED',
            detail: `Role "${role.roleName}" (${role.roleId}) is registered but has never been loaded (created: ${role.createdAt})`,
          });
        }
      }
    }

    // Also check roles that have load counts but are no longer registered
    for (const roleId of Object.keys(this.roleLoadCounts)) {
      if (this.roleLoadCounts[roleId] > 0 && this.roleLastLoadAt[roleId]) {
        const alreadyCovered = registeredRoles.some((r) => r.roleId === roleId);
        if (!alreadyCovered) {
          const lastLoadTime = new Date(this.roleLastLoadAt[roleId]).getTime();
          if (now - lastLoadTime > SEVEN_DAYS_MS) {
            alerts.push({
              type: 'ROLE_UNUSED',
              detail: `Role "${roleId}" has not been loaded for over 7 days (last load: ${this.roleLastLoadAt[roleId]})`,
            });
          }
        }
      }
    }

    // ── AGENT_ROLE_THRASHING ────────────────────────────────────
    for (const [agentId, timestamps] of Object.entries(this.agentSwitchTimestamps)) {
      const cutoff = now - TWENTY_FOUR_HOURS_MS;
      const recentCount = timestamps.filter(
        (ts) => new Date(ts).getTime() > cutoff
      ).length;

      if (recentCount > THRASHING_THRESHOLD) {
        alerts.push({
          type: 'AGENT_ROLE_THRASHING',
          detail: `Agent "${agentId}" has switched roles ${recentCount} times in the last 24 hours (threshold: ${THRASHING_THRESHOLD})`,
        });
      }
    }

    return alerts;
  }

  // ── Aggregation queries ───────────────────────────────────────

  /**
   * Get usage summary for all roles with recorded metrics.
   * Aggregates from roleLoadCounts, roleActiveDurations, and matchScoreHistogram.
   * Uses roleRegistry to resolve roleName.
   */
  getRoleUsageSummary(): RoleUsageSummary[] {
    const roleIds = new Set<string>(
      [...Object.keys(this.roleLoadCounts), ...Object.keys(this.roleActiveDurations)]
    );

    const avgMatchScore = this.matchScoreHistogram.length > 0
      ? this.matchScoreHistogram.reduce((sum, s) => sum + s, 0) / this.matchScoreHistogram.length
      : 0;

    const summaries: RoleUsageSummary[] = [];

    for (const roleId of Array.from(roleIds)) {
      const template = this._registry.get(roleId);
      summaries.push({
        roleId,
        roleName: template?.roleName ?? roleId,
        loadTotal: this.roleLoadCounts[roleId] ?? 0,
        activeDurationSeconds: this.roleActiveDurations[roleId] ?? 0,
        avgMatchScore,
      });
    }

    return summaries;
  }

  /**
   * Get role distribution per agent.
   * Uses agentRoleLoads to compute percentage breakdown.
   */
  getAgentRoleDistribution(): AgentRoleDistribution[] {
    const distributions: AgentRoleDistribution[] = [];

    for (const [agentId, roleLoads] of Object.entries(this.agentRoleLoads)) {
      const totalLoads = Object.values(roleLoads).reduce((sum, c) => sum + c, 0);
      if (totalLoads === 0) continue;

      const roles = Object.entries(roleLoads).map(([roleId, count]) => {
        const template = this._registry.get(roleId);
        return {
          roleId,
          roleName: template?.roleName ?? roleId,
          percentage: (count / totalLoads) * 100,
        };
      });

      distributions.push({
        agentId,
        agentName: agentId, // Agent name resolution deferred to API layer
        roles,
      });
    }

    return distributions;
  }

  // ── Prometheus-style metrics exposure ─────────────────────────

  /**
   * Return metrics in a simple text format suitable for a /metrics endpoint.
   * Since prom-client is not installed, we track data internally and expose
   * it as plain text counters/histograms.
   */
  getMetricsText(): string {
    const lines: string[] = [];

    // role_load_total
    lines.push('# HELP role_load_total Total number of role loads');
    lines.push('# TYPE role_load_total counter');
    for (const [roleId, count] of Object.entries(this.roleLoadCounts)) {
      lines.push(`role_load_total{roleId="${roleId}"} ${count}`);
    }

    // role_active_duration_seconds
    lines.push('# HELP role_active_duration_seconds Total active duration per role');
    lines.push('# TYPE role_active_duration_seconds counter');
    for (const [roleId, duration] of Object.entries(this.roleActiveDurations)) {
      lines.push(`role_active_duration_seconds{roleId="${roleId}"} ${duration}`);
    }

    // role_switch_total
    lines.push('# HELP role_switch_total Total number of role switches per agent');
    lines.push('# TYPE role_switch_total counter');
    for (const [agentId, count] of Object.entries(this.agentSwitchCounts)) {
      lines.push(`role_switch_total{agentId="${agentId}"} ${count}`);
    }

    // role_match_score_histogram
    lines.push('# HELP role_match_score_histogram Distribution of role match scores');
    lines.push('# TYPE role_match_score_histogram histogram');
    if (this.matchScoreHistogram.length > 0) {
      const sum = this.matchScoreHistogram.reduce((a, b) => a + b, 0);
      lines.push(`role_match_score_histogram_count ${this.matchScoreHistogram.length}`);
      lines.push(`role_match_score_histogram_sum ${sum}`);
      // Buckets: 0.1, 0.2, ..., 1.0
      for (let bucket = 0.1; bucket <= 1.0; bucket = Math.round((bucket + 0.1) * 10) / 10) {
        const count = this.matchScoreHistogram.filter((s) => s <= bucket).length;
        lines.push(`role_match_score_histogram_bucket{le="${bucket}"} ${count}`);
      }
      lines.push(`role_match_score_histogram_bucket{le="+Inf"} ${this.matchScoreHistogram.length}`);
    }

    return lines.join('\n');
  }

  // ── Persistence ───────────────────────────────────────────────

  private load(): void {
    if (!this.storePath) {
      return;
    }

    if (!existsSync(this.storePath)) {
      return;
    }

    try {
      const raw = readFileSync(this.storePath, 'utf-8');
      const parsed = JSON.parse(raw) as RoleAnalyticsStore;

      this.roleLoadCounts = parsed.roleLoadCounts ?? {};
      this.roleActiveDurations = parsed.roleActiveDurations ?? {};
      this.agentSwitchCounts = parsed.agentSwitchCounts ?? {};
      this.matchScoreHistogram = parsed.matchScoreHistogram ?? [];
      this.roleLastLoadAt = parsed.roleLastLoadAt ?? {};
      this.agentSwitchTimestamps = parsed.agentSwitchTimestamps ?? {};
      this.agentRoleLoads = parsed.agentRoleLoads ?? {};
    } catch {
      console.warn(
        `[RoleAnalyticsService] Persistence file corrupted, starting empty: ${this.storePath}`
      );
    }
  }

  private persist(): void {
    if (!this.storePath) {
      return;
    }

    const data: RoleAnalyticsStore = {
      roleLoadCounts: this.roleLoadCounts,
      roleActiveDurations: this.roleActiveDurations,
      agentSwitchCounts: this.agentSwitchCounts,
      matchScoreHistogram: this.matchScoreHistogram,
      lastUpdated: this._getNow().toISOString(),
      roleLastLoadAt: this.roleLastLoadAt,
      agentSwitchTimestamps: this.agentSwitchTimestamps,
      agentRoleLoads: this.agentRoleLoads,
    };

    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[RoleAnalyticsService] Persistence write failed:', err);
    }
  }
}

export const roleAnalyticsService = new RoleAnalyticsService();

/** Export class for testing */
export { RoleAnalyticsService };
