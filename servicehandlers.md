# GitLab Service Handlers Summary

This document describes the GitLab service handlers supported by the task processor. Each handler processes specific types of GitLab data through the GitLab API.

## CI/CD Services
- **Pipelines**: Project-specific CI/CD pipelines
- **PipelineSchedules**: Scheduled pipeline runs for projects
- **Jobs**: Individual CI/CD jobs within pipelines
- **Runners**: GitLab CI/CD runners (instance-level)
- **ProjectRunners**: Runners specific to projects
- **GroupRunners**: Runners specific to groups
- **Deployments**: Project deployment records
- **Environments**: Project environments for deployments
- **PipelineScheduleVariables**: Variables used in scheduled pipelines
- **PipelineTriggers**: Triggers for CI/CD pipelines

## Container Services
- **ContainerRegistryRepositories**: Project-specific container registry repositories
- **Packages**: Project packages (NPM, Maven, etc.)

## Group Services
- **Groups**: GitLab groups
- **GroupMembers**: Members of specific groups
- **Subgroups**: Child groups within parent groups
- **Epics**: Group-level epics (higher-level work items)
- **GroupCustomAttributes**: Custom attributes for groups
- **GroupAccessRequests**: Access requests for groups
- **GroupVariables**: CI/CD variables at group level
- **GroupLabels**: Labels defined at group level
- **GroupBadges**: Badges displayed on group pages
- **GroupDeployTokens**: Deploy tokens for groups
- **GroupIssueBoards**: Issue boards at group level
- **GroupMilestones**: Milestones at group level
- **EpicIssues**: Issues linked to specific epics
- **EpicNotes**: Comments on epics
- **EpicDiscussions**: Threaded discussions on epics

## Instance Services
- **Events**: System-wide events
- **BroadcastMessages**: Instance-wide broadcast messages
- **Search**: Search functionality across instance
- **Namespaces**: Namespace definitions across instance

## Project Services
- **Projects**: GitLab projects
- **ProjectVariables**: CI/CD variables at project level
- **ProjectMembers**: Members of specific projects
- **Issues**: Project issues
- **PagesDomains**: GitLab Pages domains for projects
- **ProjectCustomAttributes**: Custom attributes for projects
- **ProjectStatistics**: Statistical data about projects
- **ProjectBadges**: Badges displayed on project pages
- **ProjectTemplates**: Project templates
- **ProjectAccessRequests**: Access requests for projects
- **ProjectHooks**: Webhook configurations for projects
- **ProjectIssueBoards**: Issue boards at project level
- **FreezePeriods**: Deployment freeze periods

## Repository Services
- **Repositories**: Source code repositories
- **Commits**: Repository commits
- **CommitDiscussions**: Discussions on specific commits
- **Branches**: Git branches in repositories
- **Tags**: Git tags in repositories

## Security Services
- **ProtectedBranches**: Branch protection rules
- **ProtectedTags**: Tag protection rules
- **DeployKeys**: SSH keys for deployment

## User Services
- **Users**: GitLab users
- **UserEmails**: Email addresses associated with users
- **UserImpersonationTokens**: Admin-created tokens for users
- **Keys**: SSH keys for user authentication

## Work Items Services
- **Issues**: Project-specific issues
- **IssuesStatistics**: Statistical data about issues
- **IssueNotes**: Comments on issues
- **IssueDiscussions**: Threaded discussions on issues
- **IssueAwardEmojis**: Emoji reactions on issues
- **MergeRequests**: Project merge/pull requests
- **MergeRequestNotes**: Comments on merge requests
- **MergeRequestDiscussions**: Threaded discussions on merge requests
- **MergeRequestAwardEmojis**: Emoji reactions on merge requests
- **ProjectSnippets**: Code snippets in projects
- **Snippets**: Personal code snippets

Each service handler implements a consistent interface for fetching data, handling pagination, and processing results, with appropriate handling for instance-level vs project/group-specific resources.