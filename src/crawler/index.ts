// src/crawler/index.ts
// Main entry point for the crawler

import { startCrawler } from './crawler';

async function main() {
  console.log('Starting crawler...');
  await startCrawler();
  console.log('Crawler finished.');
}

main().catch(err => {
  console.error('Crawler error:', err);
  process.exit(1);
});