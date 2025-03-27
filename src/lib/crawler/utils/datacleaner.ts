import { Hasher } from "./Hasher";

export interface SensitiveFieldHasherOptions {
  outputDir?: string;
  key: string;
  algorithm?: string;
}

/**
 * SensitiveFieldHasher cleans objects by replacing name and email fields with their hashed values.
 * It uses the Hasher class (which implements caching, buffered file writing, and HMAC hashing via Bun.CryptoHasher) internally.
 */
export class SensitiveFieldHasher {
  private hasher: Hasher;

  constructor(options: SensitiveFieldHasherOptions) {
    // Initialize the internal Hasher with the provided options
    this.hasher = new Hasher({
      outputDir: options.outputDir || "./hashlogs",
      key: options.key,
      algorithm: (options.algorithm as any) || "sha256",
      hashColumn: "mailHash"
    });
  }

  /**
   * Cleans the input object by hashing sensitive fields (names and emails).
   * @param input The object (or array of objects) to clean.
   * @returns A new object with sensitive fields replaced by hashed values.
   */
  public clean<T>(input: T): T {
    return this._clean(input) as T;
  }

  /**
   * Flushes any buffered writes to disk.
   */
  public async close(): Promise<void> {
    await this.hasher.flush();
  }

  private _clean(input: unknown): unknown {
    if (Array.isArray(input)) {
      return input.map(item => this._clean(item));
    }

    if (input !== null && typeof input === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input)) {
        if (key === '__typename' || value === undefined) continue;
        if (typeof value === 'string') {
          if (this.isNameKey(key)) {
            result[key] = this.hashName(value);
            continue;
          }
          if (this.isEmailKey(key) || this.isEmailLike(value)) {
            const { hash, prefix } = this.hashEmail(value);
            result[key] = hash;
            result[`${key}_prefix`] = prefix;
            continue;
          }
        }
        result[key] = this._clean(value);
      }
      return result;
    }

    return input;
  }

  private hashName(value: string): string {
    const parts = [value, ...this.splitName(value)];
    // Process each part to ensure its hash is cached and logged
    parts.forEach(part => {
      this.hasher.hashValue(part);
    });
    // Return the hash for the full value
    return this.hasher.hashValue(value);
  }

  private hashEmail(value: string): { hash: string; prefix: string } {
    const [prefix = "", domain = ""] = value.split("@");
    const subparts = [...this.splitEmailPart(prefix), ...this.splitEmailPart(domain)];
    const all = [value, prefix, domain, ...subparts];
    all.forEach(part => {
      this.hasher.hashValue(part);
    });
    return { hash: this.hasher.hashValue(value), prefix };
  }

  private splitName(value: string): string[] {
    return value.split(/[\s\-_.]+/).filter(Boolean);
  }

  private splitEmailPart(part: string): string[] {
    return part.split(/[\.\-\+_]/).filter(Boolean);
  }

  private isNameKey(key: string): boolean {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    return /name|fullname|firstname|lastname|displayname|ownername|username/.test(normalized);
  }

  private isEmailKey(key: string): boolean {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    return /email|emailaddress|useremail|contactemail/.test(normalized);
  }

  private isEmailLike(value: unknown): boolean {
    return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
}