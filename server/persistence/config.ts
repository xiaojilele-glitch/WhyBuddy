export type EnvSource = Record<string, string | undefined>;

export type DatabaseProvider = "mysql" | "json";

export interface MysqlPoolConfig {
  connectionLimit: number;
  waitForConnections: boolean;
  queueLimit: number;
  connectTimeoutMs: number;
}

export interface MysqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  pool: MysqlPoolConfig;
}

export interface DatabaseConfig {
  provider: DatabaseProvider;
  mysql: MysqlConfig;
}

export interface SessionConfig {
  secret: string;
  cookieName: string;
  ttlDays: number;
}

export interface RedisConfig {
  enabled: boolean;
  host: string;
  port: number;
  password: string;
  db: number;
  keyPrefix: string;
  connectTimeoutMs: number;
}

export interface PersistenceConfig {
  database: DatabaseConfig;
  session: SessionConfig;
  redis: RedisConfig;
  queueRedis: RedisConfig;
}

function readString(env: EnvSource, key: string, fallback: string): string {
  const value = env[key];
  return value?.trim() ? value.trim() : fallback;
}

function readOptionalString(env: EnvSource, key: string): string {
  return env[key]?.trim() ?? "";
}

function readInteger(env: EnvSource, key: string, fallback: number, options?: { min?: number }): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (options?.min != null && parsed < options.min) return fallback;
  return parsed;
}

function readBoolean(env: EnvSource, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function readProvider(env: EnvSource): DatabaseProvider {
  const provider = readString(env, "DATABASE_PROVIDER", "mysql").toLowerCase();
  return provider === "json" ? "json" : "mysql";
}

function normalizeKeyPrefix(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.endsWith(":") ? trimmed : `${trimmed}:`;
}

export function readPersistenceConfig(env: EnvSource = process.env): PersistenceConfig {
  const mysqlPool: MysqlPoolConfig = {
    connectionLimit: readInteger(env, "DB_POOL_CONNECTION_LIMIT", 10, { min: 1 }),
    waitForConnections: readBoolean(env, "DB_POOL_WAIT_FOR_CONNECTIONS", true),
    queueLimit: readInteger(env, "DB_POOL_QUEUE_LIMIT", 0, { min: 0 }),
    connectTimeoutMs: readInteger(env, "DB_CONNECT_TIMEOUT_MS", 10_000, { min: 1 }),
  };

  const redis: RedisConfig = {
    enabled: readBoolean(env, "REDIS_ENABLED", false),
    host: readString(env, "REDIS_HOST", "localhost"),
    port: readInteger(env, "REDIS_PORT", 6379, { min: 1 }),
    password: readOptionalString(env, "REDIS_PASSWORD"),
    db: readInteger(env, "REDIS_DB", 2, { min: 0 }),
    keyPrefix: normalizeKeyPrefix(readString(env, "REDIS_KEY_PREFIX", "cube:pets:office:"), "cube:pets:office:"),
    connectTimeoutMs: readInteger(env, "REDIS_CONNECT_TIMEOUT_MS", 1_000, { min: 1 }),
  };

  const queueRedis: RedisConfig = {
    enabled: readBoolean(env, "QUEUE_REDIS_ENABLED", false),
    host: readString(env, "QUEUE_REDIS_HOST", redis.host),
    port: readInteger(env, "QUEUE_REDIS_PORT", redis.port, { min: 1 }),
    password: readOptionalString(env, "QUEUE_REDIS_PASSWORD") || redis.password,
    db: readInteger(env, "QUEUE_REDIS_DB", 3, { min: 0 }),
    keyPrefix: normalizeKeyPrefix(
      readString(env, "QUEUE_REDIS_KEY_PREFIX", "cube:pets:office:queue:"),
      "cube:pets:office:queue:",
    ),
    connectTimeoutMs: readInteger(env, "QUEUE_REDIS_CONNECT_TIMEOUT_MS", redis.connectTimeoutMs, {
      min: 1,
    }),
  };

  return {
    database: {
      provider: readProvider(env),
      mysql: {
        host: readString(env, "DB_HOST", "localhost"),
        port: readInteger(env, "DB_PORT", 3306, { min: 1 }),
        database: readString(env, "DB_NAME", "whybuddy"),
        user: readString(env, "DB_USER", "root"),
        password: readOptionalString(env, "DB_PASSWORD"),
        pool: mysqlPool,
      },
    },
    session: {
      secret: readOptionalString(env, "SESSION_SECRET"),
      cookieName: readString(env, "SESSION_COOKIE_NAME", "cube_office_session"),
      ttlDays: readInteger(env, "SESSION_TTL_DAYS", 30, { min: 1 }),
    },
    redis,
    queueRedis,
  };
}

function redactSecret(value: string): string {
  return value ? "[redacted]" : "";
}

export function redactPersistenceConfig(config: PersistenceConfig): PersistenceConfig {
  return {
    database: {
      ...config.database,
      mysql: {
        ...config.database.mysql,
        password: redactSecret(config.database.mysql.password),
      },
    },
    session: {
      ...config.session,
      secret: redactSecret(config.session.secret),
    },
    redis: {
      ...config.redis,
      password: redactSecret(config.redis.password),
    },
    queueRedis: {
      ...config.queueRedis,
      password: redactSecret(config.queueRedis.password),
    },
  };
}
