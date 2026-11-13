import { supabase } from '../supabaseClient'

// PHOTO LINKS. The user-photos bucket is private, so a stored photo_url (an old
// public-style address) cannot be shown in the browser. Who may see which file
// is decided by the database rule public.can_view_user_photos (yourself, your
// matches, the people Discover shows you). This file only asks the storage
// service for a temporary signed link; the database answers yes or no.

const BUCKET = 'user-photos'
const MARKER = '/user-photos/'
const TTL_SECONDS = 3600

// The file path inside the bucket for one of our stored addresses, or null when
// the address is not one of ours (for example seed images hosted elsewhere).
export function photoPathFromUrl(photoUrl) {
  if (typeof photoUrl !== 'string') return null
  const index = photoUrl.indexOf(MARKER)
  if (index === -1) return null
  const path = photoUrl.slice(index + MARKER.length).split('?')[0]
  if (!path) return null
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

// Takes stored photo_url values and returns a Map from each stored value to the
// address the browser should use:
//   - one of our storage files becomes a temporary signed link (1 hour);
//   - an address hosted elsewhere is returned unchanged;
//   - a file the caller may not see, or a failed request, maps to null.
export async function signPhotoUrls(photoUrls) {
  const result = new Map()
  const unique = [...new Set((photoUrls || []).filter(url => typeof url === 'string' && url))]
  const paths = []
  for (const url of unique) {
    const path = photoPathFromUrl(url)
    if (path) paths.push(path)
    else result.set(url, url)
  }
  if (paths.length > 0) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, TTL_SECONDS)
    const byPath = new Map()
    if (!error) {
      for (const item of data || []) {
        if (item.path && item.signedUrl && !item.error) byPath.set(item.path, item.signedUrl)
      }
    }
    for (const url of unique) {
      const path = photoPathFromUrl(url)
      if (path) result.set(url, byPath.get(path) || null)
    }
  }
  return result
}

// One stored address in, one usable address (or null) out.
export async function signPhotoUrl(photoUrl) {
  if (!photoUrl) return null
  const map = await signPhotoUrls([photoUrl])
  return map.get(photoUrl) ?? null
}
