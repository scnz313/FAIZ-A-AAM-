/**
 * Byte-level image type detection for the public job-application profile
 * photo. Storage metadata and browser-declared MIME types are never trusted:
 * the route reads the stored bytes and compares this result against the
 * authorized type. JPEG, PNG, and WebP only.
 */
export function detectImageMimeType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8
    && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12
    && String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === "RIFF"
    && String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
