/**
 * Utility to proxy Firebase Storage images through the dev server
 * to bypass CORS restrictions in development.
 *
 * In production, Firebase Storage should have CORS configured properly.
 */

const FIREBASE_STORAGE_HOST = 'firebasestorage.googleapis.com'

/**
 * Converts a Firebase Storage URL to a proxy URL.
 * @param {string} url - Original Firebase Storage URL
 * @returns {string} Proxied URL for development, original URL for production
 */
export function getProxiedImageUrl(url) {
  if (!url || typeof url !== 'string') return url

  // Only proxy in development
  if (process.env.NODE_ENV !== 'development') return url

  // Only proxy Firebase Storage URLs
  if (!url.includes(FIREBASE_STORAGE_HOST)) return url

  // Convert to proxy URL
  return url.replace(
    `https://${FIREBASE_STORAGE_HOST}`,
    '/storage-proxy',
  )
}

/**
 * Check if a URL is a Firebase Storage URL that needs proxying.
 * @param {string} url - URL to check
 * @returns {boolean}
 */
export function isFirebaseStorageUrl(url) {
  return url && typeof url === 'string' && url.includes(FIREBASE_STORAGE_HOST)
}
