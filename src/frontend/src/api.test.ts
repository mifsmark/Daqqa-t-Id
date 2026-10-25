import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setCsrf } from "./api";
afterEach(() => {
  vi.restoreAllMocks();
  setCsrf("");
});
describe("same-origin API helper", () => {
  it("sends the CSRF token and same-origin credentials with mutations", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    setCsrf("fresh-token");
    await api("/api/me", {
      method: "PUT",
      body: JSON.stringify({ name: "A" }),
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.credentials).toBe("same-origin");
    expect(new Headers(init?.headers).get("X-CSRF-TOKEN")).toBe("fresh-token");
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/json",
    );
  });
  it("surfaces useful server ProblemDetails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"title":"Not allowed","detail":"Please sign in."}', {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(api("/api/me")).rejects.toThrow("Please sign in.");
  });
  it("supports successful no-content mutations", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    await expect(
      api("/api/auth/logout", { method: "POST", body: "{}" }),
    ).resolves.toBeUndefined();
  });
  it("leaves multipart content type to the browser", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('{"id":"media-1"}', { status: 200 }));
    const body = new FormData();
    body.append("purpose", "avatar");
    await api("/api/media", { method: "POST", body });
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  });
});
