import { randomUUID } from "node:crypto";

import type { QueryExecutor } from "./mysql.js";

export type ProjectStatus = "active" | "archived";
export type ProjectSource = "user" | "imported_local" | "demo";
export type ProjectResourceType =
  | "message"
  | "clarification_question"
  | "spec"
  | "route"
  | "mission"
  | "artifact"
  | "evidence";

export interface RepositoryDeps {
  now?: () => Date;
  id?: () => string;
}

export interface ProjectRecord {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  source: ProjectSource;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface ProjectResourceRecord<TPayload = Record<string, unknown>> {
  id: string;
  projectId: string;
  resourceType: ProjectResourceType;
  payload: TPayload;
  createdAt: Date;
  updatedAt: Date;
}

interface ProjectRow {
  id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  source: ProjectSource;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
}

interface ProjectResourceRow {
  id: string;
  project_id: string;
  resource_type: ProjectResourceType;
  payload_json: string | Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toNullableDate(value: Date | string | null): Date | null {
  return value == null ? null : toDate(value);
}

function defaultDeps(deps: RepositoryDeps = {}): Required<RepositoryDeps> {
  return {
    now: deps.now ?? (() => new Date()),
    id: deps.id ?? randomUUID,
  };
}

function mapProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    status: row.status,
    source: row.source,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    archivedAt: toNullableDate(row.archived_at),
  };
}

function parseProjectResourcePayload(
  value: string | Record<string, unknown>,
): Record<string, unknown> {
  if (typeof value !== "string") return value;
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}

function mapProjectResource(row: ProjectResourceRow): ProjectResourceRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    resourceType: row.resource_type,
    payload: parseProjectResourcePayload(row.payload_json),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export function createProjectsRepository(db: QueryExecutor, deps?: RepositoryDeps) {
  const helpers = defaultDeps(deps);

  return {
    async create(input: {
      ownerUserId: string;
      name: string;
      description?: string | null;
      source?: ProjectSource;
    }): Promise<ProjectRecord> {
      const now = helpers.now();
      const id = helpers.id();
      await db.query(
        `INSERT INTO projects
          (id, owner_user_id, name, description, status, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
        [id, input.ownerUserId, input.name, input.description ?? null, input.source ?? "user", now, now],
      );
      return {
        id,
        ownerUserId: input.ownerUserId,
        name: input.name,
        description: input.description ?? null,
        status: "active",
        source: input.source ?? "user",
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
    },

    async listForOwner(ownerUserId: string): Promise<ProjectRecord[]> {
      const rows = await db.query<ProjectRow>(
        `SELECT id, owner_user_id, name, description, status, source, created_at, updated_at, archived_at
         FROM projects
         WHERE owner_user_id = ?
         ORDER BY updated_at DESC`,
        [ownerUserId],
      );
      return rows.map(mapProject);
    },

    async list(): Promise<ProjectRecord[]> {
      const rows = await db.query<ProjectRow>(
        `SELECT id, owner_user_id, name, description, status, source, created_at, updated_at, archived_at
         FROM projects
         ORDER BY updated_at DESC`,
      );
      return rows.map(mapProject);
    },

    async findById(projectId: string): Promise<ProjectRecord | null> {
      const rows = await db.query<ProjectRow>(
        `SELECT id, owner_user_id, name, description, status, source, created_at, updated_at, archived_at
         FROM projects
         WHERE id = ?
         LIMIT 1`,
        [projectId],
      );
      return rows[0] ? mapProject(rows[0]) : null;
    },

    async findByIdForOwner(projectId: string, ownerUserId: string): Promise<ProjectRecord | null> {
      const rows = await db.query<ProjectRow>(
        `SELECT id, owner_user_id, name, description, status, source, created_at, updated_at, archived_at
         FROM projects
         WHERE id = ?
           AND owner_user_id = ?
         LIMIT 1`,
        [projectId, ownerUserId],
      );
      return rows[0] ? mapProject(rows[0]) : null;
    },

    async updateForOwner(
      projectId: string,
      ownerUserId: string,
      patch: {
        name?: string;
        description?: string | null;
        status?: ProjectStatus;
      },
    ): Promise<ProjectRecord | null> {
      const assignments: string[] = [];
      const params: unknown[] = [];

      if (patch.name !== undefined) {
        assignments.push("name = ?");
        params.push(patch.name);
      }
      if (patch.description !== undefined) {
        assignments.push("description = ?");
        params.push(patch.description);
      }
      if (patch.status !== undefined) {
        assignments.push("status = ?");
        params.push(patch.status);
        assignments.push("archived_at = ?");
        params.push(patch.status === "archived" ? helpers.now() : null);
      }

      if (assignments.length > 0) {
        const now = helpers.now();
        await db.query(
          `UPDATE projects
           SET ${assignments.join(", ")}, updated_at = ?
           WHERE id = ?
             AND owner_user_id = ?`,
          [...params, now, projectId, ownerUserId],
        );
      }

      return this.findByIdForOwner(projectId, ownerUserId);
    },

    async archiveForOwner(projectId: string, ownerUserId: string): Promise<void> {
      const now = helpers.now();
      await db.query(
        `UPDATE projects
         SET status = 'archived', archived_at = ?, updated_at = ?
         WHERE id = ?
           AND owner_user_id = ?`,
        [now, now, projectId, ownerUserId],
      );
    },
  };
}

export function createProjectResourcesRepository(
  db: QueryExecutor,
  deps?: RepositoryDeps,
) {
  const helpers = defaultDeps(deps);

  return {
    async listForProject(
      projectId: string,
    ): Promise<ProjectResourceRecord[]> {
      const rows = await db.query<ProjectResourceRow>(
        `SELECT id, project_id, resource_type, payload_json, created_at, updated_at
         FROM project_resources
         WHERE project_id = ?
         ORDER BY created_at ASC`,
        [projectId],
      );
      return rows.map(mapProjectResource);
    },

    async create<TPayload extends Record<string, unknown>>(input: {
      projectId: string;
      resourceType: ProjectResourceType;
      payload: TPayload;
    }): Promise<ProjectResourceRecord<TPayload>> {
      const now = helpers.now();
      const id = helpers.id();
      await db.query(
        `INSERT INTO project_resources
          (id, project_id, resource_type, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.projectId,
          input.resourceType,
          JSON.stringify(input.payload),
          now,
          now,
        ],
      );
      return {
        id,
        projectId: input.projectId,
        resourceType: input.resourceType,
        payload: input.payload,
        createdAt: now,
        updatedAt: now,
      };
    },
  };
}
