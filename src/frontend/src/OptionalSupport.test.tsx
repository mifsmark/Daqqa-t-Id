import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OptionalSupportCard, SupportPage } from "./OptionalSupport";
import { api } from "./api";

vi.mock("./api", () => ({ api: vi.fn() }));
const request = vi.mocked(api);
beforeEach(() => request.mockReset());
afterEach(cleanup);
function show(children: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>);
}

it("keeps checkout unavailable in the demo and offers a way back to services", async () => {
  request.mockResolvedValue({ enabled: false, checkoutUrl: null });
  show(<SupportPage />);
  expect((await screen.findByRole("status")).textContent).toContain("Checking");
  await screen.findByText(/Optional payments are not connected/);
  expect(screen.queryByRole("link", { name: /Stripe/ })).toBeNull();
  expect(screen.getByRole("link", { name: "Keep exploring services" })).toBeTruthy();
});

it("shows an optional external checkout without claiming payment success", async () => {
  request.mockResolvedValue({ enabled: true, checkoutUrl: "https://buy.stripe.com/abc123" });
  show(<SupportPage />);
  const checkout = await screen.findByRole("link", { name: "Choose an amount on Stripe" });
  expect(checkout.getAttribute("href")).toBe("https://buy.stripe.com/abc123");
  expect(screen.getByText(/It does not change your access/).textContent).toContain("helper’s response");
  expect(screen.getByText(/Stripe shows the final amount/).textContent).toContain("returning here does not confirm a payment");
});

it("never shows a checkout when its configuration cannot be verified", async () => {
  request.mockResolvedValue({ enabled: true, checkoutUrl: "https://buy.stripe.com.attacker.example/payment" });
  show(<SupportPage />);
  await screen.findByText(/Optional payments are not connected/);
  expect(screen.queryByRole("link", { name: /Stripe/ })).toBeNull();
});

it("leaves optional support out of completed bookings when unavailable", async () => {
  request.mockResolvedValue({ enabled: false, checkoutUrl: null });
  const view = show(<OptionalSupportCard />);
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(view.container.textContent).toBe("");
});
