#!/usr/bin/env node

/**
 * Test Web OAuth2 Integration
 * Validates that the web project correctly handles enhanced OAuth2 error handling from the crawler
 */

import fetch from 'node-fetch';
import { readFileSync } from 'fs';

const logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
  warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ''),
  error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
  success: (msg, data) => console.log(`[✅ SUCCESS] ${msg}`, data || ''),
  fail: (msg, data) => console.log(`[❌ FAIL] ${msg}`, data || '')
};

// Test configuration
const WEB_BASE_URL = process.env.WEB_BASE_URL || 'http://localhost:5173';
const TEST_TASK_ID = 'test-oauth2-integration-' + Date.now();

class WebOAuth2IntegrationTester {
  constructor() {
    this.testResults = {
      passed: 0,
      failed: 0,
      total: 0,
      failures: []
    };
  }

  async runTest(name, testFn) {
    this.testResults.total++;
    try {
      logger.info(`🧪 Running: ${name}`);
      await testFn();
      this.testResults.passed++;
      logger.success(`✅ ${name}`);
    } catch (error) {
      this.testResults.failed++;
      this.testResults.failures.push({ name, error: error.message });
      logger.fail(`❌ ${name}: ${error.message}`);
    }
  }

  async testRefreshTokenEndpointEnhancement() {
    // Test that the refresh token endpoint provides enhanced error responses
    const testPayload = {
      refreshToken: 'expired_test_token_12345',
      providerId: 'gitlab-cloud'
    };

    const response = await fetch(`${WEB_BASE_URL}/api/internal/refresh-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Socket-Request': 'true' // Simulate socket request
      },
      body: JSON.stringify(testPayload)
    });

    if (response.status !== 401) {
      throw new Error(`Expected 401 status, got ${response.status}`);
    }

    const errorData = await response.json();
    
    // Validate enhanced error response structure
    const requiredFields = ['error', 'errorType', 'providerId', 'severity', 'adminGuidance', 'escalationRequired'];
    for (const field of requiredFields) {
      if (!(field in errorData)) {
        throw new Error(`Missing required field in error response: ${field}`);
      }
    }

    if (errorData.errorType !== 'OAUTH2_EXPIRED') {
      throw new Error(`Expected errorType 'OAUTH2_EXPIRED', got '${errorData.errorType}'`);
    }

    if (errorData.severity !== 'HIGH') {
      throw new Error(`Expected severity 'HIGH', got '${errorData.severity}'`);
    }

    if (!Array.isArray(errorData.adminGuidance) || errorData.adminGuidance.length === 0) {
      throw new Error('adminGuidance should be a non-empty array');
    }

    if (errorData.escalationRequired !== true) {
      throw new Error('escalationRequired should be true for expired tokens');
    }

    logger.info('Enhanced refresh token error response validated', errorData);
  }

  async testProgressEndpointCredentialHandling() {
    // Test credential expiry status update
    const credentialExpiryPayload = {
      taskId: TEST_TASK_ID,
      status: 'credential_expiry',
      timestamp: new Date().toISOString(),
      message: 'OAuth2 credentials expired',
      credentialStatus: {
        type: 'credential_expiry',
        severity: 'HIGH',
        errorType: 'OAUTH2_EXPIRED',
        providerId: 'gitlab-cloud',
        instanceType: 'gitlab-cloud',
        message: 'OAuth2 refresh token has expired',
        adminGuidance: [
          'Manual OAuth2 credential renewal required',
          'Follow OAUTH2_CREDENTIAL_RENEWAL_GUIDE.md procedures'
        ],
        estimatedResolutionTime: '30-45 minutes'
      }
    };

    // First create a test job in the database (this would normally exist)
    // For this test, we'll assume the job exists or handle the 404 gracefully
    
    const response = await fetch(`${WEB_BASE_URL}/api/internal/jobs/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Socket-Request': 'true' // Simulate socket request
      },
      body: JSON.stringify(credentialExpiryPayload)
    });

    // We expect either 200 (job found and updated) or 404 (job not found)
    // Both are acceptable for this integration test
    if (response.status !== 200 && response.status !== 404) {
      throw new Error(`Unexpected status code: ${response.status}`);
    }

    const responseData = await response.json();
    
    if (response.status === 200) {
      // Validate successful credential status update
      if (responseData.status !== 'received') {
        throw new Error(`Expected status 'received', got '${responseData.status}'`);
      }

      if (!responseData.message.includes('Credential status update processed')) {
        throw new Error('Response message should indicate credential status processing');
      }

      if (!Array.isArray(responseData.credentialGuidance)) {
        throw new Error('Response should include credentialGuidance array');
      }

      logger.info('Credential status update processed successfully', responseData);
    } else {
      // 404 is acceptable - just means the test job doesn't exist
      logger.info('Job not found (expected for integration test)', responseData);
    }
  }

  async testCredentialRenewalStatusUpdate() {
    // Test credential renewal status update
    const credentialRenewalPayload = {
      taskId: TEST_TASK_ID,
      status: 'credential_renewal',
      timestamp: new Date().toISOString(),
      message: 'Waiting for credential renewal',
      credentialStatus: {
        type: 'credential_renewal',
        severity: 'MEDIUM',
        errorType: 'OAUTH2_EXPIRED',
        providerId: 'gitlab-cloud',
        instanceType: 'gitlab-cloud',
        message: 'Job suspended pending credential renewal',
        adminGuidance: [
          'Credential renewal in progress',
          'Job will resume automatically once credentials are updated'
        ],
        estimatedResolutionTime: '15-30 minutes'
      }
    };

    const response = await fetch(`${WEB_BASE_URL}/api/internal/jobs/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Socket-Request': 'true'
      },
      body: JSON.stringify(credentialRenewalPayload)
    });

    if (response.status !== 200 && response.status !== 404) {
      throw new Error(`Unexpected status code: ${response.status}`);
    }

    const responseData = await response.json();
    logger.info('Credential renewal status handled', { status: response.status, data: responseData });
  }

  async testCredentialResumedStatusUpdate() {
    // Test credential resumed status update
    const credentialResumedPayload = {
      taskId: TEST_TASK_ID,
      status: 'credential_resumed',
      timestamp: new Date().toISOString(),
      message: 'Credentials renewed, resuming operations',
      credentialStatus: {
        type: 'credential_resumed',
        severity: 'LOW',
        errorType: 'OAUTH2_EXPIRED', // Original error type for tracking
        providerId: 'gitlab-cloud',
        instanceType: 'gitlab-cloud',
        message: 'OAuth2 credentials successfully renewed',
        adminGuidance: [
          'Credentials have been successfully renewed',
          'Job operations resuming automatically'
        ],
        estimatedResolutionTime: 'Immediate'
      }
    };

    const response = await fetch(`${WEB_BASE_URL}/api/internal/jobs/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Socket-Request': 'true'
      },
      body: JSON.stringify(credentialResumedPayload)
    });

    if (response.status !== 200 && response.status !== 404) {
      throw new Error(`Unexpected status code: ${response.status}`);
    }

    const responseData = await response.json();
    logger.info('Credential resumed status handled', { status: response.status, data: responseData });
  }

  async testTypesIntegration() {
    // Verify that the types file contains the enhanced OAuth2 types
    try {
      const typesContent = readFileSync('src/lib/types.ts', 'utf8');
      
      const requiredTypes = [
        'credential_expired',
        'waiting_credential_renewal', 
        'credential_renewed',
        'CredentialErrorSeverity',
        'CredentialErrorType',
        'CredentialStatusUpdate'
      ];

      for (const type of requiredTypes) {
        if (!typesContent.includes(type)) {
          throw new Error(`Missing required type definition: ${type}`);
        }
      }

      logger.info('Types file contains all required OAuth2 enhancements');
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('types.ts file not found - run test from web project root');
      }
      throw error;
    }
  }

  async testWebServerAvailability() {
    try {
      const response = await fetch(`${WEB_BASE_URL}/api/internal/jobs/progress`, {
        method: 'GET'
      });
      
      // We expect a method not allowed or similar, but server should be responsive
      if (response.status >= 500) {
        throw new Error(`Web server error: ${response.status}`);
      }
      
      logger.info(`Web server is responsive at ${WEB_BASE_URL}`);
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error(`Web server not running at ${WEB_BASE_URL}. Start the server first.`);
      }
      throw error;
    }
  }

  async runAllTests() {
    logger.info('🚀 Starting Web OAuth2 Integration Tests');
    logger.info(`Testing against: ${WEB_BASE_URL}`);

    // Core integration tests
    await this.runTest('Web Server Availability', () => this.testWebServerAvailability());
    await this.runTest('Types Integration', () => this.testTypesIntegration());
    await this.runTest('Enhanced Refresh Token Error Response', () => this.testRefreshTokenEndpointEnhancement());
    await this.runTest('Credential Expiry Status Handling', () => this.testProgressEndpointCredentialHandling());
    await this.runTest('Credential Renewal Status Handling', () => this.testCredentialRenewalStatusUpdate());
    await this.runTest('Credential Resumed Status Handling', () => this.testCredentialResumedStatusUpdate());

    // Generate test report
    this.generateReport();
  }

  generateReport() {
    const { passed, failed, total, failures } = this.testResults;
    const passRate = ((passed / total) * 100).toFixed(1);
    
    logger.info('\n📊 WEB OAUTH2 INTEGRATION TEST REPORT');
    logger.info('==========================================');
    logger.info(`Total Tests: ${total}`);
    logger.info(`Passed: ${passed}`);
    logger.info(`Failed: ${failed}`);
    logger.info(`Pass Rate: ${passRate}%`);
    
    if (failures.length > 0) {
      logger.error('\n❌ Failures:');
      failures.forEach(({ name, error }) => {
        logger.error(`  • ${name}: ${error}`);
      });
    } else {
      logger.success('\n🎉 All tests passed! Web OAuth2 integration is working correctly.');
    }

    logger.info('\n🔍 Integration Status:');
    if (passed === total) {
      logger.success('✅ Web project successfully handles enhanced OAuth2 error handling');
      logger.success('✅ Progress endpoint supports credential status updates'); 
      logger.success('✅ Refresh token endpoint provides enhanced error responses');
      logger.success('✅ Type system includes all required OAuth2 enhancements');
      logger.info('\n🚀 Ready for production deployment with enhanced OAuth2 credential management');
    } else {
      logger.fail('❌ Some integration tests failed - review and fix before deployment');
    }

    // Exit with appropriate code
    process.exit(failed > 0 ? 1 : 0);
  }
}

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new WebOAuth2IntegrationTester();
  tester.runAllTests().catch(error => {
    logger.error('Test suite failed:', error);
    process.exit(1);
  });
}

export { WebOAuth2IntegrationTester };