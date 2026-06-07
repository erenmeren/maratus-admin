import { describe, it, expect } from "vitest";
import openapi from "../../openapi.json";

describe("openapi.json", () => {
  it("is an OpenAPI 3.1 document", () => {
    expect((openapi as { openapi: string }).openapi).toMatch(/^3\.1/);
  });
  it("declares exactly the three implemented paths", () => {
    expect(Object.keys((openapi as { paths: Record<string, unknown> }).paths).sort()).toEqual(
      ["/receipts", "/receipts/{id}", "/usage"],
    );
  });
  it("defines a bearerAuth security scheme and applies it globally", () => {
    const doc = openapi as {
      components: { securitySchemes: Record<string, { type: string; scheme?: string }> };
      security: Array<Record<string, unknown>>;
    };
    expect(doc.components.securitySchemes.bearerAuth).toEqual({ type: "http", scheme: "bearer" });
    expect(doc.security).toContainEqual({ bearerAuth: [] });
  });
});
