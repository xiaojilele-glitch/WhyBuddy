import express, { type ErrorRequestHandler, type NextFunction, type RequestHandler } from "express";

import type { AdminUsersReader } from "../auth/sliderule-admin-users.js";
import { forwardedCredentials } from "../auth/sliderule-identity.js";
import type { ProjectRecord } from "../persistence/repositories.js";

export type { AdminUsersReader };

export interface AdminProjectsReader {
  list(): Promise<ProjectRecord[]>;
  findById(projectId: string): Promise<ProjectRecord | null>;
}

export interface AdminRouterDeps {
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
  users: AdminUsersReader;
  projects: AdminProjectsReader;
}

type JsonObject = Record<string, unknown>;

export type AdminPythonRouteContract =
  | {
      outcome: "success";
      statusCode?: 200;
      body: JsonObject & { success: true };
    }
  | {
      outcome: "forbidden";
      statusCode?: number;
      body?: unknown;
      error?: unknown;
    }
  | {
      outcome: "error";
      statusCode?: number;
      body?: unknown;
      error?: unknown;
    };

export interface AdminRouteContractResponse {
  statusCode: number;
  body: JsonObject & { success: boolean };
}

const ADMIN_FORBIDDEN_ERROR = "Admin privileges required";
const ADMIN_ROUTE_FAILED_ERROR = "Admin route failed";

export function mapAdminPythonRouteContract(
  contract: AdminPythonRouteContract,
): AdminRouteContractResponse {
  if (contract.outcome === "success") {
    return {
      statusCode: 200,
      body: contract.body,
    };
  }

  if (contract.outcome === "forbidden") {
    return {
      statusCode: 403,
      body: {
        success: false,
        error: ADMIN_FORBIDDEN_ERROR,
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      success: false,
      error: ADMIN_ROUTE_FAILED_ERROR,
    },
  };
}

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next: NextFunction) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

const adminErrorHandler: ErrorRequestHandler = (_error, _request, response, next) => {
  if (response.headersSent) {
    next(_error);
    return;
  }

  const mapped = mapAdminPythonRouteContract({ outcome: "error" });
  response.status(mapped.statusCode).json(mapped.body);
};

export function createAdminRouter(deps: AdminRouterDeps) {
  const router = express.Router();

  router.use(deps.requireAuth, deps.requireAdmin);

  router.get(
    "/summary",
    asyncRoute(async (request, response) => {
      const [users, projects] = await Promise.all([
        deps.users.list(forwardedCredentials(request)),
        deps.projects.list(),
      ]);

      response.json({
        success: true,
        summary: {
          users: users.length,
          projects: projects.length,
          runs: 0,
          failures: 0,
          audit: 0,
        },
      });
    }),
  );

  router.get(
    "/users",
    asyncRoute(async (request, response) => {
      const rawQ = request.query.q;
      const q = typeof rawQ === "string" ? rawQ : "";
      const users = await deps.users.list(forwardedCredentials(request), q);
      response.json({ success: true, items: users });
    }),
  );

  router.get(
    "/users/:userId",
    asyncRoute(async (request, response) => {
      const user = await deps.users.findById(
        request.params.userId,
        forwardedCredentials(request),
      );
      if (!user) {
        response.status(404).json({ success: false, error: "User not found" });
        return;
      }

      response.json({ success: true, user });
    }),
  );

  router.patch(
    "/users/:userId",
    asyncRoute(async (request, response) => {
      const body = request.body as { isActive?: unknown };
      const user = await deps.users.setActive(
        request.params.userId,
        body?.isActive !== false,
        forwardedCredentials(request),
      );
      if (!user) {
        response.status(404).json({ success: false, error: "User not found" });
        return;
      }
      response.json({ success: true, user });
    }),
  );

  router.get(
    "/projects",
    asyncRoute(async (_request, response) => {
      const projects = await deps.projects.list();
      response.json({ success: true, items: projects });
    }),
  );

  router.get(
    "/projects/:projectId",
    asyncRoute(async (request, response) => {
      const project = await deps.projects.findById(request.params.projectId);
      if (!project) {
        response.status(404).json({ success: false, error: "Project not found" });
        return;
      }

      response.json({ success: true, project });
    }),
  );

  router.get("/runs", (_request, response) => {
    response.json({ success: true, items: [] });
  });

  router.get("/failures", (_request, response) => {
    response.json({ success: true, items: [] });
  });

  router.get("/audit", (_request, response) => {
    response.json({ success: true, items: [] });
  });

  router.use(adminErrorHandler);

  return router;
}
