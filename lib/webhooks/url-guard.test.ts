import { describe, it, expect } from "vitest";
import { isAllowedWebhookUrl, isBlockedIp } from "./url-guard";

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

describe("isBlockedIp", () => {
  it("blocks private / loopback / link-local / unspecified IPv4", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("10.0.0.5")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
    expect(isBlockedIp("0.0.0.0")).toBe(true);
  });
  it("blocks loopback / ULA / link-local IPv6", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
  });
  it("allows public IPv4 and 172.x outside 16-31", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("172.32.0.1")).toBe(false);
  });
  it("allows a normal public IPv6", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });
});
