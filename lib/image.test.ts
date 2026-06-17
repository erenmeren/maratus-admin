import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { normalizeUploadImage, MAX_IMAGE_DIM } from "./image";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngDims(buf: Buffer) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// A solid-color raster of the given size, in the given format.
function raster(width: number, height: number, format: "png" | "jpeg") {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })[format]().toBuffer();
}

describe("normalizeUploadImage", () => {
  it("downscales a large image so the longest side is <= MAX_IMAGE_DIM, preserving aspect and PNG output", async () => {
    const input = await raster(2000, 1000, "png");
    const out = await normalizeUploadImage(input);
    expect(out.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    const { w, h } = pngDims(out);
    expect(Math.max(w, h)).toBeLessThanOrEqual(MAX_IMAGE_DIM);
    expect(w).toBe(512); // 2000x1000 fit into 512 box -> 512x256
    expect(h).toBe(256);
  });

  it("does not upscale an image already smaller than the cap", async () => {
    const input = await raster(100, 80, "png");
    const out = await normalizeUploadImage(input);
    const { w, h } = pngDims(out);
    expect(w).toBe(100);
    expect(h).toBe(80);
  });

  it("re-encodes a non-PNG raster (JPEG) to PNG", async () => {
    const input = await raster(300, 300, "jpeg");
    const out = await normalizeUploadImage(input);
    expect(out.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it("rasterizes an SVG to a PNG", async () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#10A765"/></svg>`,
    );
    const out = await normalizeUploadImage(svg);
    expect(out.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    const { w, h } = pngDims(out);
    expect(Math.max(w, h)).toBeLessThanOrEqual(MAX_IMAGE_DIM);
    expect(w).toBe(512); // 800x400 -> 512x256
  });

  it("upscales a small SVG via density to fill the cap", async () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="red"/></svg>`,
    );
    const out = await normalizeUploadImage(svg);
    expect(out.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    const { w, h } = pngDims(out);
    expect(w).toBe(512);
    expect(h).toBe(256);
  });

  it("throws on undecodable input", async () => {
    await expect(normalizeUploadImage(Buffer.from("not an image at all"))).rejects.toThrow();
  });
});
