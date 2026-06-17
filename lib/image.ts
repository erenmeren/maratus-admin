import sharp from "sharp";

/** Longest-side ceiling for stored branding images (logo + icons). The printer
 *  device decodes PNGs to a width*height*4 ARGB bitmap in PSRAM, so native
 *  pixel size — not the on-screen box — drives memory use. 512px ≈ 1 MB decode,
 *  comfortably within the board's PSRAM and ample for the ~524px logo box. */
export const MAX_IMAGE_DIM = 512;

/**
 * Decode any supported image (PNG/JPEG/WebP/SVG), fit it within
 * MAX_IMAGE_DIM x MAX_IMAGE_DIM preserving aspect ratio, never upscale, and
 * re-encode to PNG so the printer device (lodepng, PNG-only) can always decode
 * it. Throws if the bytes cannot be decoded as an image.
 */
export async function normalizeUploadImage(bytes: Buffer): Promise<Buffer> {
  const probe = sharp(bytes);
  const meta = await probe.metadata();

  // SVG is vector: resizing after a default-density rasterization blurs. Render
  // it at a density that targets ~MAX_IMAGE_DIM on the long side up front.
  let pipeline = probe;
  if (meta.format === "svg") {
    const longSide = Math.max(meta.width ?? MAX_IMAGE_DIM, meta.height ?? MAX_IMAGE_DIM);
    const density = Math.min(2400, Math.max(72, Math.round((72 * MAX_IMAGE_DIM) / longSide)));
    pipeline = sharp(bytes, { density });
  }

  return pipeline
    .resize(MAX_IMAGE_DIM, MAX_IMAGE_DIM, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer() as Promise<Buffer>;
}
