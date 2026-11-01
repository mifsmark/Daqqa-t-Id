import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "./ui";
import { api } from "./api";

vi.mock("./api", () => ({
  api: vi.fn(),
  json: (body: unknown) => ({ method: "POST", body: JSON.stringify(body) }),
}));

const apiMock = vi.mocked(api);
const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
function renderCenter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationCenter user={{ id: "user-1", email: "person@example.test", displayName: "Person", role: "Customer" }} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalServiceWorker) Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
  else Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("notification center failures and opt-in", () => {
  it("shows an inbox load error instead of claiming there are no updates", async () => {
    apiMock.mockRejectedValue(new Error("Network unavailable"));
    renderCenter();
    fireEvent.click(screen.getByRole("button", { name: /^Notifications/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Updates could not be loaded");
    expect(screen.queryByText("No updates yet")).toBeNull();
  });

  it("reports a failed mark-all action accessibly", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/notifications") return { items: [{ id: "n1", bookingId: null, kind: "Test", title: "A test", message: "Test update", url: "/dashboard", createdAt: "2026-01-01T00:00:00Z", readAt: null }], unreadCount: 1 } as never;
      if (path === "/api/notifications/push-config") return { enabled: false, publicKey: null, subscribed: false } as never;
      throw new Error("Read update failed");
    });
    renderCenter();
    fireEvent.click(screen.getByRole("button", { name: /^Notifications/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Read update failed"));
  });

  it("requests browser permission only after the explicit enable action", async () => {
    const requestPermission = vi.fn().mockResolvedValue("denied");
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    vi.stubGlobal("PushManager", class {});
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve({}) } });
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/notifications") return { items: [], unreadCount: 0 } as never;
      if (path === "/api/notifications/push-config") return { enabled: true, publicKey: "AQID", subscribed: false } as never;
      throw new Error("Unexpected request");
    });
    renderCenter();
    fireEvent.click(screen.getByRole("button", { name: /^Notifications/ }));
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on phone alerts" }));
    await waitFor(() => expect(requestPermission).toHaveBeenCalledOnce());
    expect((await screen.findByRole("status")).textContent).toContain("Alerts are blocked");
  });
});
