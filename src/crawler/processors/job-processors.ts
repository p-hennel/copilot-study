// src/processors/job-processors.ts
import { getLogger } from "@logtape/logtape";
import { JobType, type ProcessorMap } from "../types/job-types";
import { type BaseProcessorConfig } from "./base-processor";
import { DetailProcessor } from "./detail";
import { DiscoveryProcessor } from "./discovery";
import { GroupProcessor } from "./group";
import { ProjectProcessor } from "./project";

// Initialize logger
const logger = getLogger(["crawlib", "job-processors"]);

/**
 * Coordinator class for job processors
 */
export class JobProcessors {
  private discoveryProcessor: DiscoveryProcessor;
  private groupProcessor: GroupProcessor;
  private projectProcessor: ProjectProcessor;
  private detailProcessor: DetailProcessor;

  /**
   * Constructor
   *
   * @param config - Processor configuration
   */
  constructor(config: BaseProcessorConfig) {
    // Create instances of the specialized processors
    this.discoveryProcessor = new DiscoveryProcessor(config);
    this.groupProcessor = new GroupProcessor(config);
    this.projectProcessor = new ProjectProcessor(config);
    this.detailProcessor = new DetailProcessor(config);

    logger.debug("Job processors initialized");
  }

  /**
   * Get all job processors as a map
   */
  getProcessors(): ProcessorMap {
    return {
      // Discovery processors
      [JobType.DISCOVER_GROUPS]: this.discoveryProcessor.processDiscoverGroups.bind(
        this.discoveryProcessor
      ),
      [JobType.DISCOVER_PROJECTS]: this.discoveryProcessor.processDiscoverProjects.bind(
        this.discoveryProcessor
      ),
      [JobType.DISCOVER_SUBGROUPS]: this.discoveryProcessor.processDiscoverSubgroups.bind(
        this.discoveryProcessor
      ),

      // Group processors
      [JobType.GROUP_DETAILS]: this.groupProcessor.processGroupDetails.bind(this.groupProcessor),
      [JobType.GROUP_MEMBERS]: this.groupProcessor.processGroupMembers.bind(this.groupProcessor),
      [JobType.GROUP_PROJECTS]: this.groupProcessor.processGroupProjects.bind(this.groupProcessor),
      [JobType.GROUP_ISSUES]: this.groupProcessor.processGroupIssues.bind(this.groupProcessor),

      // Project processors
      [JobType.PROJECT_DETAILS]: this.projectProcessor.processProjectDetails.bind(
        this.projectProcessor
      ),
      [JobType.PROJECT_BRANCHES]: this.projectProcessor.processProjectBranches.bind(
        this.projectProcessor
      ),
      [JobType.PROJECT_MERGE_REQUESTS]: this.projectProcessor.processProjectMergeRequests.bind(
        this.projectProcessor
      ),
      [JobType.PROJECT_ISSUES]: this.projectProcessor.processProjectIssues.bind(
        this.projectProcessor
      ),
      [JobType.PROJECT_MILESTONES]: this.projectProcessor.processProjectMilestones.bind(
        this.projectProcessor
      ),
      [JobType.PROJECT_RELEASES]: this.projectProcessor.processProjectReleases.bind(
        this.projectProcessor
      ),
      [JobType.PROJECT_PIPELINES]: this.projectProcessor.processProjectPipelines.bind(
        this.projectProcessor
      ),
      [JobType.PROJECT_VULNERABILITIES]: this.projectProcessor.processProjectVulnerabilities.bind(
        this.projectProcessor
      ),

      // Detail processors
      [JobType.MERGE_REQUEST_DISCUSSIONS]: this.detailProcessor.processMergeRequestDiscussions.bind(
        this.detailProcessor
      ),
      [JobType.ISSUE_DISCUSSIONS]: this.detailProcessor.processIssueDiscussions.bind(
        this.detailProcessor
      ),
      [JobType.PIPELINE_DETAILS]: this.detailProcessor.processPipelineDetails.bind(
        this.detailProcessor
      ),
      [JobType.PIPELINE_TEST_REPORTS]: this.detailProcessor.processPipelineTestReports.bind(
        this.detailProcessor
      )
    };
  }
}
