import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAdminStore } from "./admin-store";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("admin-store", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    useAdminStore.getState().resetForTest();
  });

  it("loads users with the cookie session included", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        items: [
          {
            id: "user-1",
            email: "admin@example.com",
            displayName: "Admin",
            avatarUrl: null,
            isSuperuser: true,
            isVerified: true,
            isActive: true,
            lastLoginAt: null,
            createdAt: "2026-05-01T00:00:00.000Z",
            sessions: 2,
            estimatedTokens: 120,
            estimatedCostUsd: 0.01,
          },
        ],
      })
    );

    await useAdminStore.getState().loadUsers();

    expect(fetchMock).toHaveBeenCalledWith("/api/sliderule/account/admin/users", {
      credentials: "include",
    });
    expect(useAdminStore.getState().users).toHaveLength(1);
    expect(useAdminStore.getState().users[0].email).toBe("admin@example.com");
    expect(useAdminStore.getState().users[0].sessions).toBe(2);
    expect(useAdminStore.getState().users[0].status).toBe("active");
  });

  it("停用走 PATCH 同一条身份接口，不写旧 /api/admin", async () => {
    useAdminStore.setState({
      users: [
        {
          id: "user-2",
          email: "alice@example.com",
          displayName: "Alice",
          avatarUrl: null,
          role: "user",
          status: "active",
          isActive: true,
          isSuperuser: false,
          createdAt: "2026-05-01T00:00:00.000Z",
          sessions: 1,
          estimatedTokens: 10,
          estimatedCostUsd: 0,
        },
      ],
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        user: {
          id: "user-2",
          email: "alice@example.com",
          displayName: "Alice",
          isSuperuser: false,
          isVerified: true,
          isActive: false,
          createdAt: "2026-05-01T00:00:00.000Z",
          sessions: 1,
          estimatedTokens: 10,
        },
      })
    );

    await useAdminStore.getState().setUserActive("user-2", false);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sliderule/account/admin/users/user-2",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        body: JSON.stringify({ isActive: false }),
      })
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain("/api/admin/users");
    expect(useAdminStore.getState().users[0].status).toBe("disabled");
    expect(useAdminStore.getState().users[0].isActive).toBe(false);
  });

  it("项目清单是增强类：应用接口拒绝时空表，不报红", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "需要管理员权限" }, 403)
    );

    await useAdminStore.getState().loadProjects();

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/sliderule/account/admin/apps"
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain("/api/admin/projects");
    expect(useAdminStore.getState().projects).toEqual([]);
    expect(useAdminStore.getState().error).toBeNull();
    expect(useAdminStore.getState().loading).toBe(false);
  });

  it("总览人数来自身份名单；应用/话题挂了不挡", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/sliderule/account/admin/users")) {
        return jsonResponse({
          ok: true,
          items: [
            {
              id: "user-1",
              email: "root@example.com",
              isSuperuser: true,
              isActive: true,
              createdAt: "2026-08-21T00:00:00.000Z",
            },
          ],
        });
      }
      return jsonResponse({ detail: "down" }, 500);
    });

    await useAdminStore.getState().loadOverview();

    expect(fetchMock.mock.calls.map(call => call[0])).not.toContain(
      "/api/admin/summary"
    );
    expect(fetchMock.mock.calls.map(call => call[0])).not.toContain(
      "/api/admin/projects"
    );
    expect(fetchMock.mock.calls.map(call => call[0])).toContain(
      "/api/sliderule/account/admin/users"
    );
    expect(useAdminStore.getState().error).toBeNull();
    expect(useAdminStore.getState().users).toHaveLength(1);
    expect(useAdminStore.getState().summary?.users).toBe(1);
    expect(useAdminStore.getState().summary?.projects).toBe(0);
  });

  it("身份名单读不到时总览才红", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/sliderule/account/admin/users")) {
        return jsonResponse({ detail: "未登录" }, 401);
      }
      return jsonResponse({ ok: true, items: [] });
    });

    await useAdminStore.getState().loadOverview();

    expect(useAdminStore.getState().users).toEqual([]);
    expect(useAdminStore.getState().error).toBeTruthy();
    expect(useAdminStore.getState().summary).toBeNull();
  });

  it("总览并行打身份/应用/话题，失败从 phase 筛", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          items: [
            {
              id: "user-1",
              email: "admin@example.com",
              isSuperuser: true,
              isActive: true,
              createdAt: "2026-05-01T00:00:00.000Z",
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          items: [
            {
              id: "app-1",
              productName: "古籍数字化",
              goal: "把县志做成检索",
              ownerId: "user-1",
              visibility: "private",
              isOfficial: false,
              createdAt: "2026-08-21T00:00:00.000Z",
              updatedAt: "2026-08-21T00:00:00.000Z",
              pageCount: 4,
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          items: [
            {
              id: "sess-ok",
              goal: "正常话题",
              ownerId: "user-1",
              phase: "done",
              createdAt: "2026-08-21T00:00:00.000Z",
              lastActive: "2026-08-21T01:00:00.000Z",
              artifactCount: 2,
            },
            {
              id: "sess-fail",
              goal: "炸掉的",
              ownerId: "user-1",
              phase: "failed",
              createdAt: "2026-08-21T00:00:00.000Z",
              lastActive: "2026-08-21T01:00:00.000Z",
              artifactCount: 0,
            },
          ],
        })
      );

    await useAdminStore.getState().loadOverview();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toEqual({ credentials: "include" });
    }
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      "/api/sliderule/account/admin/users",
      "/api/sliderule/account/admin/apps",
      "/api/sliderule/account/admin/sessions",
    ]);
    expect(fetchMock.mock.calls.map(call => call[0])).not.toContain(
      "/api/admin/users"
    );
    expect(fetchMock.mock.calls.map(call => call[0])).not.toContain(
      "/api/admin/summary"
    );
    expect(useAdminStore.getState().summary?.users).toBe(1);
    expect(useAdminStore.getState().summary?.projects).toBe(1);
    expect(useAdminStore.getState().summary?.runs).toBe(2);
    expect(useAdminStore.getState().summary?.failures).toBe(1);
    expect(useAdminStore.getState().projects[0].name).toBe("古籍数字化");
    expect(useAdminStore.getState().failures[0].id).toBe("sess-fail");
  });
});
