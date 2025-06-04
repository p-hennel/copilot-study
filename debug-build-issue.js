#!/usr/bin/env node

// Debug script to identify the Zod validation issue during build
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

console.log('=== Build Issue Diagnostic ===');
console.log('Environment variables:');
console.log('- HOME:', process.env.HOME);
console.log('- DATA_ROOT:', process.env.DATA_ROOT);
console.log('- SETTINGS_FILE:', process.env.SETTINGS_FILE);
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log();

// Simulate the settings file path resolution logic
const getLocalSettingsFilePath = () => {
  const basePath = process.cwd();
  let candidate = path.resolve(basePath, "config", "settings.yaml");
  if (fs.existsSync(candidate)) {
    return candidate;
  } else {
    candidate = path.resolve(basePath, "settings.yaml");
    return fs.existsSync(candidate) ? candidate : undefined;
  }
};

const getHomeSettingsFilePath = () => {
  const base = path.resolve(path.join(process.env.HOME ?? "~", "data"));
  let candidate = path.resolve(base, "config", "settings.yaml");
  if (fs.existsSync(candidate)) {
    return candidate;
  } else {
    candidate = path.resolve(base, "settings.yaml");
    if (fs.existsSync(candidate)) {
      return candidate;
    } else {
      return path.join(base, "config", "settings.yaml");
    }
  }
};

const getSettingsFilePath = () => {
  const settingsFilePath = process.env.SETTINGS_FILE;
  if (!!settingsFilePath && settingsFilePath.length > 0 && fs.existsSync(settingsFilePath)) {
    return settingsFilePath;
  }
  const homeSettingsFilePath = getHomeSettingsFilePath();
  if (fs.existsSync(homeSettingsFilePath)) {
    return homeSettingsFilePath;
  }
  return getLocalSettingsFilePath() ?? homeSettingsFilePath;
};

const settingsPath = getSettingsFilePath();
console.log('Resolved settings file path:', settingsPath);
console.log('Settings file exists:', fs.existsSync(settingsPath));

if (fs.existsSync(settingsPath)) {
  try {
    const content = fs.readFileSync(settingsPath, 'utf8');
    console.log('Settings file content length:', content.length);
    
    const parsed = yaml.load(content);
    console.log('YAML parsed successfully');
    console.log('Parsed structure keys:', Object.keys(parsed || {}));
    
    // Check for common validation issues
    if (!parsed) {
      console.log('⚠️  ISSUE: Settings file is empty or invalid YAML');
    } else {
      console.log('Settings validation would occur here with Zod...');
    }
  } catch (error) {
    console.log('❌ ISSUE: Error reading/parsing settings file:', error.message);
  }
} else {
  console.log('⚠️  ISSUE: Settings file does not exist at resolved path');
  
  // Check what directories exist
  const settingsDir = path.dirname(settingsPath);
  console.log('Settings directory:', settingsDir);
  console.log('Settings directory exists:', fs.existsSync(settingsDir));
  
  if (fs.existsSync(settingsDir)) {
    console.log('Contents of settings directory:');
    try {
      const contents = fs.readdirSync(settingsDir);
      contents.forEach(item => console.log('  -', item));
    } catch (error) {
      console.log('Error reading directory:', error.message);
    }
  }
}

console.log('\n=== Checking current working directory ===');
console.log('Current working directory:', process.cwd());
console.log('Contents:');
try {
  const contents = fs.readdirSync(process.cwd());
  contents.forEach(item => {
    const itemPath = path.join(process.cwd(), item);
    const stats = fs.statSync(itemPath);
    console.log(`  ${stats.isDirectory() ? 'DIR ' : 'FILE'} ${item}`);
  });
} catch (error) {
  console.log('Error reading current directory:', error.message);
}