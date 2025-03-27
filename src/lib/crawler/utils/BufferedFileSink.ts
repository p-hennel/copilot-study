import type { FileSink } from "bun";

/**
 * A simple buffered file writer that accumulates data in memory
 * and flushes to disk once a high watermark is reached.
 */
export class BufferedFileSink {
  private fileWriter: FileSink;
  private buffer: string[] = [];
  private watermark: number;

  /**
   * @param filePath - The path to the file to write to.
   * @param watermark - The number of bytes to buffer before flushing (default is 64KB).
   */
  constructor(filePath: string, watermark: number = 64 * 1024) {
    const file = Bun.file(filePath);
    this.fileWriter = file.writer();
    this.watermark = watermark;
  }

  /**
   * Adds data to the buffer. Flushes if the buffered data exceeds the watermark.
   * @param data - The string data to write.
   */
  write(data: string) {
    this.buffer.push(data);
    if (this.buffer.join("").length >= this.watermark) {
      this.flush();
    }
  }

  /**
   * Flushes the current buffer to disk.
   */
  async flush() {
    if (this.buffer.length > 0) {
      const data = this.buffer.join("");
      await this.fileWriter.write(data);
      this.buffer = [];
    }
  }

  /**
   * Closes the sink by flushing any remaining data.
   */
  async close() {
    await this.flush();
    // If desired, you may explicitly close the writer here if Bun supports it.
  }
}