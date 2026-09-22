import { describe, expect, it } from "vitest";

import {
  createProjectResourcesRepository,
  createProjectsRepository,
} from "../persistence/repositories.js";

class RecordingDb {
  queries: Array<{ sql: string; params: readonly unknown[] }> = [];
  nextRows: unknown[][] = [];

  async query<T = unknown>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    this.queries.push({ sql, params });
    if (/^\s*select\b/i.test(sql)) {
      return (this.nextRows.shift() ?? []) as T[];
    }
    return [];
  }
}

describe("persistence repositories", () => {
  it("filters project lookups by owner_user_id for ordinary users", async () => {
    const db = new RecordingDb();
    db.nextRows.push([
      {
        id: "project-1",
        owner_user_id: "user-1",
        name: "Owned Project",
        description: null,
        status: "active",
        source: "user",
        created_at: new Date("2026-04-30T00:00:00.000Z"),
        updated_at: new Date("2026-04-30T00:00:00.000Z"),
        archived_at: null,
      },
    ]);
    const projects = createProjectsRepository(db);

    const project = await projects.findByIdForOwner("project-1", "user-1");

    expect(project?.id).toBe("project-1");
    expect(project?.ownerUserId).toBe("user-1");
    expect(db.queries[0].sql).toMatch(/where\s+id\s+=\s+\?/i);
    expect(db.queries[0].sql).toMatch(/owner_user_id\s+=\s+\?/i);
    expect(db.queries[0].params).toEqual(["project-1", "user-1"]);
  });

  it("updates projects only through owner_user_id filters", async () => {
    const db = new RecordingDb();
    db.nextRows.push([
      {
        id: "project-1",
        owner_user_id: "user-1",
        name: "Renamed",
        description: null,
        status: "archived",
        source: "user",
        created_at: new Date("2026-04-30T00:00:00.000Z"),
        updated_at: new Date("2026-04-30T00:05:00.000Z"),
        archived_at: new Date("2026-04-30T00:05:00.000Z"),
      },
    ]);
    const projects = createProjectsRepository(db, {
      now: () => new Date("2026-04-30T00:05:00.000Z"),
    });

    const project = await projects.updateForOwner("project-1", "user-1", {
      name: "Renamed",
      description: null,
      status: "archived",
    });

    expect(project).toMatchObject({
      id: "project-1",
      ownerUserId: "user-1",
      name: "Renamed",
      status: "archived",
    });
    expect(db.queries[0].sql).toMatch(/update\s+projects/i);
    expect(db.queries[0].sql).toMatch(/owner_user_id\s+=\s+\?/i);
    expect(db.queries[0].params).toEqual([
      "Renamed",
      null,
      "archived",
      new Date("2026-04-30T00:05:00.000Z"),
      new Date("2026-04-30T00:05:00.000Z"),
      "project-1",
      "user-1",
    ]);
  });

  it("supports admin read-only project lookups without owner filters", async () => {
    // 用户列表已经不在 MySQL 了（旧账号体系整套下掉，身份改由 Python 的
    // Neon `sliderule_user` 持有），这里只剩项目这一半。
    const db = new RecordingDb();
    db.nextRows.push([
      {
        id: "project-1",
        owner_user_id: "user-1",
        name: "Project",
        description: null,
        status: "active",
        source: "user",
        created_at: new Date("2026-04-30T00:00:00.000Z"),
        updated_at: new Date("2026-04-30T00:00:00.000Z"),
        archived_at: null,
      },
    ]);
    const projects = createProjectsRepository(db);

    await projects.findById("project-1");

    expect(db.queries[0].sql).toMatch(/where\s+id\s+=\s+\?/i);
    expect(db.queries[0].sql).not.toMatch(/owner_user_id\s+=\s+\?/i);
    expect(db.queries[0].params).toEqual(["project-1"]);
  });

  it("stores project scoped resources under a project id", async () => {
    const db = new RecordingDb();
    db.nextRows.push([
      {
        id: "resource-1",
        project_id: "project-1",
        resource_type: "message",
        payload_json: JSON.stringify({
          id: "message-1",
          projectId: "project-1",
          content: "Hello",
        }),
        created_at: new Date("2026-04-30T00:00:00.000Z"),
        updated_at: new Date("2026-04-30T00:00:00.000Z"),
      },
    ]);
    const resources = createProjectResourcesRepository(db, {
      now: () => new Date("2026-04-30T00:00:00.000Z"),
      id: () => "resource-1",
    });

    const created = await resources.create({
      projectId: "project-1",
      resourceType: "message",
      payload: {
        id: "message-1",
        projectId: "project-1",
        content: "Hello",
      },
    });
    const listed = await resources.listForProject("project-1");

    expect(created).toMatchObject({
      id: "resource-1",
      projectId: "project-1",
      resourceType: "message",
    });
    expect(db.queries[0].sql).toMatch(/insert\s+into\s+project_resources/i);
    expect(db.queries[0].params).toContain("project-1");
    expect(db.queries[0].params).toContain("message");
    expect(db.queries[1].sql).toMatch(/where\s+project_id\s+=\s+\?/i);
    expect(db.queries[1].params).toEqual(["project-1"]);
    expect(listed[0]).toMatchObject({
      id: "resource-1",
      projectId: "project-1",
      resourceType: "message",
      payload: {
        id: "message-1",
        projectId: "project-1",
        content: "Hello",
      },
    });
  });
});
