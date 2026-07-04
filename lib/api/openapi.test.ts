import { describe, it, expect } from "vitest";
import openapi from "../../openapi.json";

describe("openapi.json", () => {
  it("is an OpenAPI 3.1 document", () => {
    expect((openapi as { openapi: string }).openapi).toMatch(/^3\.1/);
  });
  it("declares exactly the implemented paths", () => {
    expect(Object.keys((openapi as { paths: Record<string, unknown> }).paths).sort()).toEqual(
      ["/devices/{deviceId}/trigger", "/usage"],
    );
  });
  it("documents the trigger endpoint as a POST with a required JSON body", () => {
    const doc = openapi as {
      paths: Record<string, { post?: { requestBody?: { required?: boolean } } }>;
    };
    const op = doc.paths["/devices/{deviceId}/trigger"].post;
    expect(op).toBeDefined();
    expect(op?.requestBody?.required).toBe(true);
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
