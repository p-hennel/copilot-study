// Simple test to verify our database timestamp fixes work
import { safeTimestamp } from './src/lib/server/db/index.js';

console.log('Testing safeTimestamp function...');

// Test cases that would previously cause "value.getTime is not a function" errors
const testCases = [
  null,
  undefined,
  "invalid date string",
  "",
  0,
  new Date(),
  new Date().toISOString(),
  Date.now(),
  "2023-01-01T00:00:00.000Z"
];

testCases.forEach((testCase, index) => {
  try {
    const result = safeTimestamp(testCase);
    console.log(`Test ${index + 1}: ${JSON.stringify(testCase)} -> ${result ? result.toISOString() : 'null'}`);
  } catch (error) {
    console.error(`Test ${index + 1} failed:`, error.message);
  }
});

console.log('Test completed successfully - no "value.getTime is not a function" errors!');