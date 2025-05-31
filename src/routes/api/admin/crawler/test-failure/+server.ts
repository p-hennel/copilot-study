import { json, type RequestHandler } from "@sveltejs/kit";
import { isAdmin } from "$lib/server/utils";
import messageBusClient from "$lib/messaging/MessageBusClient";
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["routes","api","admin","crawler","test-failure"]);

/**
 * POST /api/admin/crawler/test-failure - Trigger a test failure for demonstration
 */
export const POST: RequestHandler = async ({ locals }) => {
  // Check admin access
  const adminCheck = await isAdmin(locals);
  if (!adminCheck) {
    return json({ error: "Admin access required" }, { status: 401 });
  }

  if (!messageBusClient) {
    return json({ error: "MessageBusClient not available" }, { status: 503 });
  }

  try {
    // Simulate a job failure log directly
    const testFailureData = {
      jobId: `test_failure_${Date.now()}`,
      taskType: 'GROUP_PROJECT_DISCOVERY',
      error: 'Test failure triggered from admin dashboard',
      stackTrace: `Error: Test failure triggered from admin dashboard
    at TestHandler.simulateFailure (/api/admin/crawler/test-failure:25:15)
    at Object.POST (/api/admin/crawler/test-failure:30:20)`,
      timestamp: new Date().toISOString(),
      context: {
        reason: 'Manual test trigger from admin dashboard',
        triggeredBy: 'admin',
        testMode: true
      }
    };

    // Emit the job failure event directly
    messageBusClient.emit('jobFailure', testFailureData);

    return json({ 
      success: true, 
      message: "Test failure log sent",
      testData: testFailureData
    });
  } catch (error) {
    logger.error("Error triggering test failure:", {error});
    return json({ 
      error: "Failed to trigger test failure",
      details: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
};