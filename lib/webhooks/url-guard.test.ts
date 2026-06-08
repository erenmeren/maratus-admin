import { describe, it, expect } from "vitest";
import { isAllowedWebhookUrl } from "./url-guard";

const ok = (u: string) => isAllowedWebhookUrl(u).ok;

describe("isAllowedWebhookUrl", () => {
  it("allows public https urls", () => {
    expect(ok("https://example.com/hook")).toBe(true);
    expect(ok("https://api.acme.io:8443/x")).toBe(true);
  });
  it("rejects non-https", () => {
    expect(ok("http://example.com")).toBe(false);
    expect(ok("ftp://example.com")).toBe(false);
  });
  it("rejects invalid urls", () => {
    expect(ok("not a url")).toBe(false);
  });
  it("rejects localhost and .local", () => {
    expect(ok("https://localhost/x")).toBe(false);
    expect(ok("https://foo.local/x")).toBe(false);
  });
  it("rejects private / loopback / link-local IPv4", () => {
    expect(ok("https://127.0.0.1/x")).toBe(false);
    expect(ok("https://10.0.0.5/x")).toBe(false);
    expect(ok("https://172.16.0.1/x")).toBe(false);
    expect(ok("https://172.31.255.1/x")).toBe(false);
    expect(ok("https://192.168.1.1/x")).toBe(false);
    expect(ok("https://169.254.169.254/x")).toBe(false);
    expect(ok("https://0.0.0.0/x")).toBe(false);
  });
  it("allows public IPv4 and rejects 172.x outside 16-31", () => {
    expect(ok("https://172.32.0.1/x")).toBe(true);
    expect(ok("https://8.8.8.8/x")).toBe(true);
  });
  it("rejects IPv6 loopback / ULA / link-local", () => {
    expect(ok("https://[::1]/x")).toBe(false);
    expect(ok("https://[fc00::1]/x")).toBe(false);
    expect(ok("https://[fe80::1]/x")).toBe(false);
  });
});
