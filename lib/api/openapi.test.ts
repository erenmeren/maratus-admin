import { describe, it, expect } from "vitest";
import openapi from "../../openapi.json";

describe("openapi.json", () => {
  it("is an OpenAPI 3.1 document", () => {
    expect((openapi as { openapi: string }).openapi).toMatch(/^3\.1/);
  });
  it("declares exactly the implemented paths", () => {
    expect(Object.keys((openapi as { paths: Record<string, unknown> }).paths).sort()).toEqual(
      ["/devices/{deviceId}/pin", "/devices/{deviceId}/trigger", "/org/pin", "/stores/{storeId}/pin", "/usage"],
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

type Operation = { operationId?: string; tags?: string[] };
const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"] as const;

describe("openapi.json — docs-site readiness", () => {
  const doc = openapi as unknown as {
    servers: Array<{ url: string }>;
    tags: Array<{ name: string }>;
    paths: Record<string, Record<string, unknown>>;
  };

  it("uses absolute https server URLs", () => {
    expect(doc.servers.length).toBeGreaterThan(0);
    for (const s of doc.servers) {
      expect(new URL(s.url).protocol).toBe("https:");
    }
  });

  it("gives every operation a unique operationId and at least one declared tag", () => {
    const declaredTags = new Set(doc.tags.map((t) => t.name));
    const ids: string[] = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const method of HTTP_METHODS) {
        const op = item[method] as Operation | undefined;
        if (!op) continue;
        expect(op.operationId, `${method.toUpperCase()} ${path} operationId`).toBeTruthy();
        expect(op.tags?.length, `${method.toUpperCase()} ${path} tags`).toBeGreaterThan(0);
        for (const t of op.tags ?? []) expect(declaredTags.has(t), `tag ${t} declared`).toBe(true);
        ids.push(op.operationId!);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves every $ref", () => {
    const refs: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "$ref" && typeof v === "string") refs.push(v);
          else walk(v);
        }
      }
    };
    walk(openapi);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith("#/"), ref).toBe(true);
      const target = ref
        .slice(2)
        .split("/")
        .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"))
        .reduce<unknown>((acc, seg) => (acc as Record<string, unknown> | undefined)?.[seg], openapi);
      expect(target, `unresolved ${ref}`).toBeDefined();
    }
  });
});
