import { describe, it, expect } from "vitest";
import { deviceOfflineEmail } from "./device-emails";

const one = {
  orgName: "Roastwell Coffee",
  devices: [{ name: "Front Counter", storeName: "Downtown", lastSeenLabel: "2026-06-28 11:40 UTC" }],
};

describe("deviceOfflineEmail", () => {
  it("singular subject for one device", () => {
    expect(deviceOfflineEmail(one).subject).toBe("A Ditto printer went offline");
  });
  it("plural subject for multiple devices", () => {
    const m = deviceOfflineEmail({
      orgName: "X",
      devices: [
        { name: "A", storeName: "S1", lastSeenLabel: "x" },
        { name: "B", storeName: "S2", lastSeenLabel: "y" },
      ],
    });
    expect(m.subject).toBe("2 Ditto printers went offline");
  });
  it("lists each device with name, store, and last-seen", () => {
    const { html } = deviceOfflineEmail(one);
    expect(html).toContain("Front Counter");
    expect(html).toContain("Downtown");
    expect(html).toContain("2026-06-28 11:40 UTC");
  });
  it("escapes a malicious org or device name", () => {
    const { html } = deviceOfflineEmail({
      orgName: "<script>alert(1)</script>",
      devices: [{ name: "<img src=x>", storeName: "S", lastSeenLabel: "x" }],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;script&gt;");
  });
});
