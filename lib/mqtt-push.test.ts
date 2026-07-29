import { describe, it, expect } from "vitest";
import { republishKindFor } from "./mqtt-push";

describe("republishKindFor", () => {
  it("regenerates config commands instead of replaying them", () => {
    // A stored config payload replayed 60s later would carry expired 300s
    // presigned R2 URLs, so the heartbeat republish must rebuild it.
    expect(republishKindFor("config-changed")).toBe("config");
  });

  it("regenerates firmware-update commands", () => {
    // The manifest url is a 600s presigned GET — same expiry problem.
    expect(republishKindFor("firmware-update")).toBe("ota");
  });

  it("replays every other command type verbatim", () => {
    for (const t of ["trigger", "pin", "reboot", "refresh", "identify"]) {
      expect(republishKindFor(t)).toBe("replay");
    }
  });

  it("replays unknown types rather than dropping them", () => {
    expect(republishKindFor("something-new")).toBe("replay");
  });
});
