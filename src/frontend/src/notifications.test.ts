import { describe, expect, it } from "vitest";
import { applicationNotificationUrl, decodeVapidKey } from "./ui";

describe("notification browser helpers", () => {
  it("keeps notification links within known application routes", () => {
    expect(applicationNotificationUrl("/bookings/4b731f4b-7962-40ab-bd18-84bbf12fc419")).toBe(
      "/bookings/4b731f4b-7962-40ab-bd18-84bbf12fc419",
    );
    expect(applicationNotificationUrl("/dashboard")).toBe("/dashboard");
    expect(applicationNotificationUrl("https://example.com/phishing")).toBe("/dashboard");
    expect(applicationNotificationUrl("/account?next=https://example.com")).toBe("/dashboard");
  });

  it("decodes URL-safe VAPID public keys for PushManager", () => {
    expect(Array.from(decodeVapidKey("AQID-_8"))).toEqual([1, 2, 3, 251, 255]);
  });
});
