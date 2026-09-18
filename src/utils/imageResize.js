/**
 * Resize + compress an image File entirely client-side, before upload.
 *
 * Why: profile photos are displayed at ≤300px in the UI. Storing
 * original 12MP uploads (3–6 MB) costs ~20x the needed storage and
 * bandwidth. Resizing at the upload boundary caps storage growth at
 * ~150 KB/photo regardless of camera resolution.
 *
 * Longest edge is capped at `maxEdge` (aspect preserved), output is
 * JPEG q0.85 (widely compatible, good compression). If the source is
 * already within bounds the image is still re-encoded to JPEG for a
 * consistent, compressed format.
 */
export async function resizeImage(file, maxEdge = 1200, quality = 0.85) {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, w, h)

    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))),
        'image/jpeg',
        quality
      )
    )
    return new File([blob], 'photo.jpg', { type: 'image/jpeg' })
  } finally {
    bitmap.close?.()
  }
}
