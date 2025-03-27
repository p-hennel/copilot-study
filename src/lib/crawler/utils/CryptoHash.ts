import type { SupportedCryptoAlgorithms } from "bun";

// Global cache for computed hashes.
const hashCache = new Map<string, string>();

/**
 * Computes an HMAC hash of the given value using Bun.CryptoHasher.
 * Caches the result based on a composite key (algorithm, key, value) to avoid re-computation.
 * Defaults to SHA256 if not specified.
 *
 * @param value - The string to hash.
 * @param key - The secret key for HMAC.
 * @param algorithm - The cryptographic algorithm (defaults to "sha256").
 * @returns The hexadecimal hash digest.
 */

    // TODO FETCH HMAC KEY
export function computeHash(
  value: string,
  key: string = process.env.HMAC_KEY,
  algorithm: SupportedCryptoAlgorithms = "sha256"
): string {
  const cacheKey = `${algorithm}:${key}:${value}`;
  if (hashCache.has(cacheKey)) {
    return hashCache.get(cacheKey)!;
  }
  const hasher = new Bun.CryptoHasher(algorithm, key);
  hasher.update(value);
  const digest = hasher.digest("hex");
  hashCache.set(cacheKey, digest);
  return digest;
}

/**
 * Loads previously computed hash mappings from a text file content.
 * Each line should be formatted as "value[TAB]hash".
 *
 * @param content - The file content to load.
 * @param key - The secret key used to generate the hashes.
 * @param algorithm - The cryptographic algorithm.
 */
export function loadHashes(content: string, key: string, algorithm: SupportedCryptoAlgorithms = "sha256") {
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const [value, hash] = line.split("\t");
    if (value && hash) {
      const cacheKey = `${algorithm}:${key}:${value}`;
      hashCache.set(cacheKey, hash.trim());
    }
  }
}

/**
 * Expose the cache (for testing or inspection if needed)
 */
export function getCache() {
  return hashCache;
}