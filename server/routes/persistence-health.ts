import express from "express";

import {
  readPersistenceConfig,
  redactPersistenceConfig,
  type DatabaseConfig,
  type PersistenceConfig,
  type RedisConfig,
} from "../persistence/config.js";
import { createMysqlQueryExecutor, type QueryExecutor } from "../persistence/mysql.js";
import { pingRedis } from "../persistence/redis.js";

export type PersistenceOverallStatus = "healthy" | "degraded" | "unhealthy";
export type MysqlHealthStatus = "healthy" | "unhealthy";
export type RedisHealthStatus = "healthy" | "degraded" | "disabled";

export interface MysqlHealthSnapshot {
  status: MysqlHealthStatus;
  required: true;
  latencyMs?: number;
  config?: {
    host: string;
    port: number;
    database: string;
    user: string;
    pool: {
      connectionLimit: number;
      waitForConnections: boolean;
      queueLimit: number;
      connectTimeoutMs: number;
    };
  };
  error?: string;
}

export interface RedisHealthSnapshot {
  status: RedisHealthStatus;
  enabled: boolean;
  required: false;
  latencyMs?: number;
  host?: string;
  port?: number;
  db?: number;
  keyPrefix?: string;
  error?: string;
}

export interface PersistenceHealthSnapshot {
  status: PersistenceOverallStatus;
  mysql: MysqlHealthSnapshot;
  redis: RedisHealthSnapshot;
  checkedAt: string;
}

export interface PersistenceHealthRouterDeps {
  checkHealth?: () => Promise<PersistenceHealthSnapshot>;
}

function hasClose(value: QueryExecutor): value is QueryExecutor & { close(): Promise<void> } {
  return "close" in value && typeof value.close === "function";
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mysqlConfigSummary(config: DatabaseConfig): MysqlHealthSnapshot["config"] {
  const redacted = redactPersistenceConfig({
    database: config,
    redis: {
      enabled: false,
      host: "",
      port: 0,
      password: "",
      db: 0,
      keyPrefix: "",
      connectTimeoutMs: 0,
    },
    queueRedis: {
      enabled: false,
      host: "",
      port: 0,
      password: "",
      db: 0,
      keyPrefix: "",
      connectTimeoutMs: 0,
    },
  });
  const mysql = redacted.database.mysql;
  return {
    host: mysql.host,
    port: mysql.port,
    database: mysql.database,
    user: mysql.user,
    pool: mysql.pool,
  };
}

export async function checkMysqlHealth(
  config: DatabaseConfig,
  executor?: QueryExecutor,
): Promise<MysqlHealthSnapshot> {
  const startedAt = Date.now();
  let ownedExecutor: { close(): Promise<void> } | undefined;

  try {
    if (config.provider !== "mysql") {
      return {
        status: "unhealthy",
        required: true,
        config: mysqlConfigSummary(config),
        error: `DATABASE_PROVIDER=${config.provider} does not provide the required MySQL source of truth`,
      };
    }

    const queryExecutor = executor ?? createMysqlQueryExecutor(config.mysql);
    if (hasClose(queryExecutor)) {
      ownedExecutor = queryExecutor;
    }

    await queryExecutor.query("SELECT 1 AS ok");
    return {
      status: "healthy",
      required: true,
      latencyMs: Date.now() - startedAt,
      config: mysqlConfigSummary(config),
    };
  } catch (error) {
    return {
      status: "unhealthy",
      required: true,
      latencyMs: Date.now() - startedAt,
      config: mysqlConfigSummary(config),
      error: safeErrorMessage(error),
    };
  } finally {
    await ownedExecutor?.close();
  }
}

export async function checkRedisHealth(config: RedisConfig): Promise<RedisHealthSnapshot> {
  if (!config.enabled) {
    return {
      status: "disabled",
      enabled: false,
      required: false,
      keyPrefix: config.keyPrefix,
    };
  }

  const result = await pingRedis(config);
  if (result.ok) {
    return {
      status: "healthy",
      enabled: true,
      required: false,
      latencyMs: result.latencyMs,
      host: config.host,
      port: config.port,
      db: config.db,
      keyPrefix: config.keyPrefix,
    };
  }

  return {
    status: "degraded",
    enabled: true,
    required: false,
    latencyMs: result.latencyMs,
    host: config.host,
    port: config.port,
    db: config.db,
    keyPrefix: config.keyPrefix,
    error: result.error,
  };
}

export async function checkPersistenceHealth(
  config: PersistenceConfig = readPersistenceConfig(),
): Promise<PersistenceHealthSnapshot> {
  const [mysql, redis] = await Promise.all([
    checkMysqlHealth(config.database),
    checkRedisHealth(config.redis),
  ]);

  const status: PersistenceOverallStatus =
    mysql.status === "unhealthy" ? "unhealthy" : redis.status === "degraded" ? "degraded" : "healthy";

  return {
    status,
    mysql,
    redis,
    checkedAt: new Date().toISOString(),
  };
}

export function createPersistenceHealthRouter(deps: PersistenceHealthRouterDeps = {}) {
  const router = express.Router();
  const checkHealth = deps.checkHealth ?? checkPersistenceHealth;

  router.get("/", async (_request, response) => {
    const health = await checkHealth();
    response.status(health.status === "unhealthy" ? 503 : 200).json(health);
  });

  return router;
}
