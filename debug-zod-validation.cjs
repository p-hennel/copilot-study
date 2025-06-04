#!/usr/bin/env node

// Test the actual Zod validation that's failing
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

// Copy the actual Zod schema from settings.ts (simplified for testing)
const { z } = require('zod');

console.log('=== Testing Zod Validation ===');

// Read the settings file
const settingsPath = path.resolve('config/settings.yaml');
const content = fs.readFileSync(settingsPath, 'utf8');
const data = yaml.load(content);

console.log('Loaded data:', JSON.stringify(data, null, 2));

// Create a simplified version of the schema to test piece by piece
const testPathsSchema = z.object({
  dataRoot: z.string().nonempty().default('./data'),
  config: z.string().nonempty().default('./data/config'),
  database: z.string().nonempty().default('file:./data/config/main.db'),
  archive: z.string().nonempty().default('./data/archive'),
  logs: z.string().nonempty().default('./data/logs')
});

const testEmailSchema = z.object({
  encryptionPassword: z.string().nonempty().default("1234567890!?"),
  subject: z.string().optional().default("AUTOMATED BACKUP ({date})"),
  api: z.object({
    url: z.string().optional().default("http://134.102.23.170:3000/api/send-email"),
    timeout: z.number().optional().default(30000)
  }).optional(),
  smtp: z.object({
    secure: z.boolean().optional().default(true),
  }).optional(),
});

const testAuthSchema = z.object({
  initCode: z.string().nonempty(),
  trustedOrigins: z.array(z.string().nonempty()),
  trustedProviders: z.array(z.string().nonempty()),
  allowDifferentEmails: z.boolean().default(true),
  admins: z.array(z.object({
    email: z.string().email(),
    name: z.string().optional()
  })),
  providers: z.object({
    gitlab: z.object({
      type: z.enum(["oauth2", "oidc"]).default("oidc"),
      scopes: z.array(z.string()),
      redirectURI: z.string()
    }).optional(),
    gitlabCloud: z.object({
      baseUrl: z.string().nonempty(),
      scopes: z.array(z.string()),
      redirectURI: z.string()
    }).optional(),
    jiracloud: z.object({
      baseUrl: z.string().optional(),
      authorizationUrl: z.string(),
      authorizationUrlParams: z.record(z.string()),
      tokenUrl: z.string(),
      scopes: z.array(z.string()),
      redirectURI: z.string(),
      accessibleResourcesUrl: z.string()
    }).optional(),
    jira: z.object({
      authorizationUrl: z.string(),
      authorizationUrlParams: z.record(z.string()),
      tokenUrl: z.string(),
      scopes: z.array(z.string()),
      redirectURI: z.string(),
      accessibleResourcesUrl: z.string()
    }).optional()
  })
});

const testSchema = z.object({
  dev: z.boolean().default(false),
  paths: testPathsSchema.default({}),
  hashing: z.object({
    algorithm: z.string().default("sha256")
  }).default({}),
  auth: testAuthSchema,
  oauth2: z.object({}).default({}),
  app: z.object({
    CRAWLER_API_TOKEN: z.string().optional()
  }).default({}),
  email: testEmailSchema.default({})
});

// Test each section individually
console.log('\n=== Testing individual sections ===');

try {
  console.log('Testing paths...');
  testPathsSchema.parse(data.paths);
  console.log('✅ Paths validation passed');
} catch (error) {
  console.log('❌ Paths validation failed:', error.message);
  console.log('Paths data:', data.paths);
}

try {
  console.log('Testing email...');
  testEmailSchema.parse(data.email);
  console.log('✅ Email validation passed');
} catch (error) {
  console.log('❌ Email validation failed:', error.message);
  console.log('Email data:', data.email);
}

try {
  console.log('Testing auth...');
  testAuthSchema.parse(data.auth);
  console.log('✅ Auth validation passed');
} catch (error) {
  console.log('❌ Auth validation failed:', error.message);
  console.log('Auth data:', JSON.stringify(data.auth, null, 2));
}

// Test the full schema
try {
  console.log('\n=== Testing full schema ===');
  const result = testSchema.parse(data);
  console.log('✅ Full validation passed');
} catch (error) {
  console.log('❌ Full validation failed:', error.message);
  if (error.errors) {
    console.log('Validation errors:', JSON.stringify(error.errors, null, 2));
  }
}