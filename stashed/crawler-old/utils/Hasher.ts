import type { SupportedCryptoAlgorithms } from "bun";
import path from "node:path";
import { computeHash, loadHashes } from "./CryptoHash";
import { BufferedFileSink } from "./BufferedFileSink";

// Use Bun's filesystem API to list directories.
import { readdirSync } from "fs";
import { mkdirSync } from "node:fs";

export interface HasherOptions {
  algorithm?: SupportedCryptoAlgorithms;
  key: string;
  hashColumn?: string;
  outputDir?: string;
}

/**
 * A class that handles hashing of values (e.g. emails) with caching.
 * It writes new hash mappings to a file in buffered batches and loads
 * previously generated hashes on startup.
 */
export class Hasher {
  private algorithm: SupportedCryptoAlgorithms;
  private key: string;
  public hashColumn: string;
  private outputDir: string;
  private fileSink: BufferedFileSink;

  constructor(options: HasherOptions) {
    this.algorithm = options.algorithm || "sha256";
    this.key = options.key;
    this.hashColumn = options.hashColumn || "mailHash";
    this.outputDir = options.outputDir || "./hashlogs";

    // Ensure the output directory exists.
    mkdirSync(this.outputDir, { recursive: true });

    // Use today's date for the current hash log file.
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `hashlog-${dateStr}.txt`;
    const filePath = path.join(this.outputDir, fileName);
    this.fileSink = new BufferedFileSink(filePath);

    // Load any previously generated hashes from the output directory.
    this.loadPreviousHashes();
  }

  /**
   * Scans the output directory for previously generated hash files (with a .txt extension)
   * and loads them into the in-memory cache.
   */
  private loadPreviousHashes() {
    let files: string[] = [];
    try {
      files = readdirSync(this.outputDir);
    } catch (err) {
      console.error("Error reading output directory:", err);
      return;
    }
    for (const fileName of files) {
      const filePath = path.join(this.outputDir, fileName);
      if (path.extname(filePath) !== ".txt") continue;
      try {
        const content = Bun.read(filePath).toString();
        loadHashes(content, this.key, this.algorithm);
      } catch (err) {
        console.error("Error loading hash file:", filePath, err);
      }
    }
  }

  /**
   * Hashes a given value, writes the mapping to disk if new, and returns the hash.
   * @param value - The value to hash.
   * @returns The computed hash.
   */
  public hashValue(value: string): string {
    const hash = computeHash(value, this.key, this.algorithm);
    // Write the mapping (value[TAB]hash) to the file sink.
    this.fileSink.write(`${value}\t${hash}\n`);
    return hash;
  }

  /**
   * Hashes an email from an object record using common candidate keys.
   * Returns an object containing the hash and the email prefix.
   * @param record - An object that should contain an email field.
   */
  public hashEmail(record: { [key: string]: any }): { hash: string; prefix: string } {
    const email = this.getEmailFromRecord(record);
    const [prefix] = email.split("@");
    const hash = this.hashValue(email);
    return { hash, prefix };
  }

  /**
   * Extracts the email value from a record by checking common candidate keys.
   * @param record - The record to inspect.
   * @returns The email string.
   */
  private getEmailFromRecord(record: { [key: string]: any }): string {
    const candidates = ["email", "e-mail", "e.mail", "mail"];
    const keys = Object.keys(record);
    for (const candidate of candidates) {
      const foundKey = keys.find((key) => key.toLowerCase() === candidate);
      if (foundKey && record[foundKey]) {
        return record[foundKey];
      }
    }
    throw new Error("No valid email field found in record.");
  }

  /**
   * Flushes any buffered writes to disk.
   */
  public async flush() {
    await this.fileSink.flush();
  }
}