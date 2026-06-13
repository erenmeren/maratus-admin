import { describe, it, expect } from "vitest";
import { ICON_PRESETS, DEFAULT_ICON_PRESET } from "./printer-layout";
import { resolveIconComponent, ICON_COMPONENTS } from "./printer-icons";

describe("printer-icons", () => {
  it("maps every preset to a renderable component", () => {
    for (const name of ICON_PRESETS) {
      const comp = ICON_COMPONENTS[name];
      // lucide-react 1.x exports icons as forwardRef objects ({ $$typeof, render }),
      // not plain functions — check the component is defined and renderable.
      expect(comp).toBeDefined();
      expect(comp).not.toBeNull();
      expect(
        typeof comp === "function" ||
        (typeof comp === "object" && typeof (comp as { render?: unknown }).render === "function"),
      ).toBe(true);
    }
  });
  it("falls back to the default preset's component for unknown names", () => {
    expect(resolveIconComponent("nope" as never)).toBe(ICON_COMPONENTS[DEFAULT_ICON_PRESET]);
  });
});
