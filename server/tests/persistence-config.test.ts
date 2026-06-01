import { describe, expect, it } from "vitest";

import {
  readPersistenceConfig,
  redactPersistenceConfig,
} from "../persistence/config.js";

describe("persistence config", () => {
  it("reads MySQL, session, Redis, and queue Redis settings with safe defaults", () => {
    const config = readPersistenceConfig({
      DATABASE_PROVIDER: "mysql",
      DB_HOST: "db.local",
      DB_PORT: "3307",
      DB_NAME: "whybuddy",
      DB_USER: "cube_user",
      DB_PASSWORD: "db-secret",
      DB_POOL_CONNECTION_LIMIT: "12",
      SESSION_SECRET: "session-secret",
      SESSION_COOKIE_NAME: "cube_session",
      SESSION_TTL_DAYS: "45",
      REDIS_HOST: "redis.local",
      REDIS_PORT: "6380",
      REDIS_PASSWORD: "redis-secret",
      REDIS_DB: "2",
      REDIS_KEY_PREFIX: "cube:pets:office:",
      QUEUE_REDIS_ENABLED: "true",
      QUEUE_REDIS_HOST: "queue.local",
      QUEUE_REDIS_DB: "3",
      QUEUE_REDIS_KEY_PREFIX: "cube:pets:office:queue:",
    });

    expect(config.database.provider).toBe("mysql");
    expect(config.database.mysql.host).toBe("db.local");
    expect(config.database.mysql.port).toBe(3307);
    expect(config.database.mysql.database).toBe("whybuddy");
    expect(config.database.mysql.pool.connectionLimit).toBe(12);
    expect(config.session.cookieName).toBe("cube_session");
    expect(config.session.ttlDays).toBe(45);
    expect(config.redis.enabled).toBe(false);
    expect(config.redis.keyPrefix).toBe("cube:pets:office:");
    expect(config.queueRedis.enabled).toBe(true);
    expect(config.queueRedis.host).toBe("queue.local");
    expect(config.queueRedis.db).toBe(3);
  });

  it("redacts passwords and session secrets from loggable config", () => {
    const config = readPersistenceConfig({
      DB_PASSWORD: "db-secret",
      SESSION_SECRET: "session-secret",
      REDIS_PASSWORD: "redis-secret",
      QUEUE_REDIS_PASSWORD: "queue-secret",
    });

    const redacted = redactPersistenceConfig(config);
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain("db-secret");
    expect(serialized).not.toContain("session-secret");
    expect(serialized).not.toContain("redis-secret");
    expect(serialized).not.toContain("queue-secret");
    expect(redacted.database.mysql.password).toBe("[redacted]");
    expect(redacted.session.secret).toBe("[redacted]");
  });
});
