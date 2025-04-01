import { graphql } from "../gql"

export const fPageInfo = graphql(/* GraphQL */ `
  fragment PaginationDetails on PageInfo {
    endCursor
    hasNextPage
  }
`)

export const fMemberDetails = graphql(/* GraphQL */ `
  fragment MemberDetails on MemberInterface {
    id
    expiresAt
    accessLevel {
      stringValue
      humanAccess
      integerValue
    }
    createdAt
    createdBy {
      id
    }
    updatedAt
    user {
      id
    }
  }
`)

export const fUserDetails = graphql(/* GraphQL */ `
  fragment UserDetails on User {
    id
    active
    bot
    commitEmail
    createdAt
    groupCount
    human
    jobTitle
    organization
    publicEmail
    state
    type
    username
    emails(first: 20) {
      nodes {
        id
        email
        createdAt
        updatedAt
        confirmedAt
      }
    }
  }
`)

export const fReleaseDetails = graphql(/* GraphQL */ `
  fragment ReleaseDetails on Release {
    id
    author {
      id
    }
    name
    createdAt
    releasedAt
    tagName
    tagPath
    description
    milestones(first: 20) {
      nodes {
        id
      }
    }
  }
`)

export const fNoteDetails = graphql(/* GraphQL */ `
  fragment NoteDetails on Note {
    id
    author {
      id
    }
    authorIsContributor
    createdAt
    externalAuthor
    imported
    internal
    lastEditedAt
    ...ResolvableDetails
  }
`)

export const fMilestoneDetails = graphql(/* GraphQL */ `
  fragment MilestoneDetails on Milestone {
    createdAt
    description
    dueDate
    expired
    group {
      id
    }
    groupMilestone
    id
    iid
    project {
      id
    }
    projectMilestone
    releases(first: 20) {
      nodes {
        id
      }
    }
    startDate
    state
    stats {
      closedIssuesCount
      totalIssuesCount
    }
    subgroupMilestone
    title
    upcoming
    updatedAt
  }
`)

export const fCodeQualityDegradationDetails = graphql(/* GraphQL */ `
  fragment CodeQualityDegradationDetails on CodeQualityDegradation {
    description
    engineName
    fingerprint
    line
    path
    severity
  }
`)
export const fSecurityReportFindingDetails = graphql(/* GraphQL */ `
  fragment SecurityReportFindingDetails on PipelineSecurityReportFinding {
    description
    falsePositive
    dismissedAt
    stateComment
    state
    severity
    solution
    title
    uuid
    vulnerability {
      id
    }
    dismissalReason
    identifiers {
      externalId
      externalType
      name
      url
    }
    mergeRequest {
      id
    }
    project {
      id
    }
    dismissedBy {
      id
    }
  }
`)
export const fTestSuiteSummaryDetails = graphql(/* GraphQL */ `
  fragment TestSuiteSummaryDetails on TestSuiteSummary {
    suiteError
    skippedCount
    successCount
    name
    totalTime
    totalCount
    failedCount
    successCount
    errorCount
  }
`)

export const fCommitDetails = graphql(/* GraphQL */ `
  fragment CommitDetails on Commit {
    author {
      id
    }
    authorEmail
    authorName
    authoredDate
    committedDate
    committerEmail
    committerName
    description
    fullTitle
    id
    message
    name
    sha
    shortId
    title
  }
`)

export const fPipelineDetails = graphql(/* GraphQL */ `
  fragment PipelineDetails on Pipeline {
    id
    iid
    active
    cancelable
    child
    status
    startedAt
    commit {
      id
      sha
      shortId
    }
    committedAt
    complete
    computeMinutes
    coverage
    createdAt
    duration
    failureReason
    beforeSha
    totalJobs
    finishedAt
    mergeRequest {
      id
    }
    mergeRequestEventType
    name
    project {
      id
      fullPath
    }
    queuedDuration
    ref
    refText
    retryable
    source
    trigger
    type
    updatedAt
    upstream {
      id
    }
    user {
      id
    }
    codeQualityReportSummary {
      info
      minor
      critical
      blocker
      count
      major
      unknown
    }
    stuck
    testReportSummary {
      total {
        failed
        skipped
        success
        suiteError
        time
        count
        time
      }
    }
  }
`)

export const fVulnerabilityDetails = graphql(/* GraphQL */ `
  fragment VulnerabilityDetails on Vulnerability {
    id
    primaryIdentifier {
      externalId
      externalType
      name
      url
    }
    description
    falsePositive
    detectedAt
    dismissedAt
    stateComment
    state
    severity
    solution
    dismissalReason
    identifiers {
      externalId
      externalType
      name
      url
    }
    dismissedBy {
      id
    }
    confirmedBy {
      id
    }
    confirmedAt
    resolvedAt
    resolvedBy {
      id
    }
    resolvedOnDefaultBranch
  }
`)

export const fResolvableDetails = graphql(/* GraphQL */ `
  fragment ResolvableDetails on ResolvableInterface {
    resolvedAt
    resolved
    resolvable
    resolvedBy {
      id
    }
  }
`)

export const fIterationCadenceDetails = graphql(/* GraphQL */ `
  fragment IterationCadenceDetails on IterationCadence {
    id
    title
    durationInWeeks
    automatic
    active
    description
    iterationsInAdvance
    rollOver
    startDate
  }
`)
export const fIterationDetails = graphql(/* GraphQL */ `
  fragment IterationDetails on Iteration {
    createdAt
    description
    dueDate
    id
    iid
    iterationCadence {
      id
    }
    sequence
    startDate
    state
    title
    updatedAt
    scopedPath
  }
`)
export const fDiscussionDetails = graphql(/* GraphQL */ `
  fragment DiscussionDetails on Discussion {
    id
    createdAt
    noteable {
      ... on Design {
        id
      }
      ... on Issue {
        id
      }
      ... on MergeRequest {
        id
      }
    }
    notes(after: $after, first: $limit) {
      pageInfo {
        ...PaginationDetails
      }
      nodes {
        ...NoteDetails
      }
    }
    replyId
    ...ResolvableDetails
  }
`)
export const fCodequalityErrorDetails = graphql(/* GraphQL */ `
  fragment CodequalityErrorDetails on CodequalityReportsComparerReportDegradation {
    description
    engineName
    fingerprint
    line
    severity
  }
`)
export const fTimelogDetails = graphql(/* GraphQL */ `
  fragment TimelogDetails on Timelog {
    id
    issue {
      id
    }
    mergeRequest {
      id
    }
    note {
      ...NoteDetails
    }
    project {
      id
    }
    spentAt
    summary
    timeSpent
    user {
      id
    }
  }
`)
export const fAwardEmojiDetails = graphql(/* GraphQL */ `
  fragment AwardEmojiDetails on AwardEmoji {
    description
    emoji
    name
    unicode
    unicodeVersion
    user {
      id
    }
  }
`)
export const fMergeRequestDetails = graphql(/* GraphQL */ `
  fragment MergeRequestDetails on MergeRequest {
    allowCollaboration
    allowsMultipleAssignees
    allowsMultipleReviewers
    approvalState {
      approvalRulesOverwritten
      invalidApproversRules {
        id
        name
      }
    }
    approvalsLeft
    approvalsRequired
    approved
    approvedBy(first: 20) {
      nodes {
        id
      }
    }
    assignees(first: 20) {
      nodes {
        id
      }
    }
    author {
      id
    }
    autoMergeEnabled
    autoMergeStrategy
    awardEmoji(first: 50) {
      nodes {
        ...AwardEmojiDetails
      }
    }
    closedAt
    codequalityReportsComparer {
      status
      report {
        existingErrors {
          ...CodequalityErrorDetails
        }
        newErrors {
          ...CodequalityErrorDetails
        }
        resolvedErrors {
          ...CodequalityErrorDetails
        }
        status
        summary {
          errored
          resolved
          total
        }
      }
    }
    conflicts
    createdAt
    description
    detailedMergeStatus
    diffHeadSha
    diffRefs {
      baseSha
      headSha
      startSha
    }
    diffStats {
      additions
      deletions
      path
    }
    discussionLocked
    divergedFromTargetBranch
    downvotes
    draft
    forceRemoveSourceBranch
    hasCi
    hasSecurityReports
    hidden
    humanTimeEstimate
    humanTotalTimeSpent
    id
    iid
    inProgressMergeCommitSha
    mergeAfter
    mergeCommitSha
    mergeError
    mergeOngoing
    mergeStatusEnum
    mergeUser {
      id
    }
    mergeWhenPipelineSucceeds
    mergeable
    mergeableDiscussionsState
    mergedAt
    milestone {
      id
    }
    name
    preparedAt
    project {
      id
    }
    projectId
    rebaseCommitSha
    rebaseInProgress
    resolvableDiscussionsCount
    resolvedDiscussionsCount
    retargeted
    securityReportsUpToDateOnTargetBranch
    shouldBeRebased
    shouldRemoveSourceBranch
    sourceBranch
    sourceBranchExists
    sourceBranchProtected
    sourceProject {
      id
    }
    sourceProjectId
    squash
    squashOnMerge
    squashReadOnly
    state
    supportsLockOnMerge
    targetBranch
    targetBranchExists
    targetBranchPath
    targetProject {
      id
    }
    targetProjectId
    taskCompletionStatus {
      completedCount
      count
    }
    timeEstimate
    title
    totalTimeSpent
    updatedAt
    upvotes
    userDiscussionsCount
    userNotesCount
  }
`)
export const fIssueDetails = graphql(/* GraphQL */ `
  fragment IssueDetails on Issue {
    author {
      id
    }
    blocked
    blockedByIssues(after: $after, first: $limit) {
      pageInfo {
        ...PaginationDetails
      }
      nodes {
        id
      }
    }
    closedAsDuplicateOf {
      id
    }
    closedAt
    confidential
    createdAt
    description
    discussionLocked
    downvotes
    dueDate
    hasEpic
    hidden
    humanTimeEstimate
    humanTotalTimeSpent
    id
    iid
    iteration {
      id
    }
    labels(first: 20) {
      nodes {
        id
      }
    }
    milestone {
      id
    }
    moved
    movedTo {
      id
    }
    name
    notes(after: $after, first: $limit) {
      pageInfo {
        ...PaginationDetails
      }
      nodes {
        ...NoteDetails
      }
    }
    projectId
    reference
    relatedMergeRequests(first: 50) {
      nodes {
        id
      }
    }
    relatedVulnerabilities(first: 50) {
      nodes {
        id
      }
    }
    relativePosition
    severity
    slaDueAt
    state
    statusPagePublishedIncident
    taskCompletionStatus {
      completedCount
      count
    }
    timeEstimate
    timelogs(after: $after, first: $limit) {
      pageInfo {
        ...PaginationDetails
      }
      nodes {
        id
      }
    }
    title
    type
    updatedBy {
      id
    }
    upvotes
    weight
  }
`)
export const fGroupDetails = graphql(/* GraphQL */ `
  fragment GroupDetails on Group {
    id
    createdAt
    description
    name
    fullName
    fullPath
    parent {
      id
    }
  }
`)

export const fWorkItemDetails = graphql(/* GraphQL */ `
  fragment WorkItemDetails on WorkItem {
    id
    title
    description
    state
    createdAt
    updatedAt
    author {
      id
    }
    assignees(first: 20) {
      nodes {
        id
        username
      }
    }
    labels(first: 20) {
      nodes {
        id
        title
      }
    }
  }
`)

export const qWorkItems = graphql(/* GraphQL */ `
  query ListWorkItems($FullPath: ID!, $after: String = null, $limit: Int = 50) {
    project(fullPath: $FullPath) {
      workItems(first: $limit, after: $after) {
        pageInfo {
          ...PaginationDetails
        }
        nodes {
          ...WorkItemDetails
        }
      }
    }
  }
`)

export const fProjectDetails = graphql(/* GraphQL */ `
  fragment ProjectDetails on Project {
    name
    namespace {
      id
      description
      name
      fullName
    }
    fullPath
    id
    languages {
      name
      share
    }
    group {
      id
      fullPath
      fullName
      name
    }
    starCount
    statistics {
      storageSize
      uploadsSize
      commitCount
      containerRegistrySize
      packagesSize
      buildArtifactsSize
      pipelineArtifactsSize
      snippetsSize
      wikiSize
      lfsObjectsSize
      repositorySize
    }
    topics
    webUrl
    containerRegistryEnabled
    wikiEnabled
    hasJiraVulnerabilityIssueCreationEnabled
    issuesEnabled
    jobsEnabled
    lfsEnabled
    mergeRequestsEnabled
    mergeRequestsFfOnlyEnabled
    preReceiveSecretDetectionEnabled
    preventMergeWithoutJiraIssueEnabled
    printingMergeRequestLinkEnabled
    secretPushProtectionEnabled
    serviceDeskEnabled
    sharedRunnersEnabled
    snippetsEnabled
  }
`)

export const qUser = graphql(/* GraphQL */ `
  query GetUser($userId: UserID) {
    user(id: $userId) {
      ...UserDetails
    }
  }
`)

export const qUsers = graphql(/* GraphQL */ `
  query ListUsers($after: String = null, $limit: Int! = 25) {
    users(after: $after, first: $limit) {
      pageInfo {
        ...PaginationDetails
      }
      nodes {
        ...UserDetails
      }
    }
  }
`)

export const qGroupMembers = graphql(/* GraphQL */ `
  query ListGroupMembers($FullPath: ID!, $after: String = null, $limit: Int = 100) {
    group(fullPath: $FullPath) {
      groupMembers(sort: CREATED_ASC, after: $after, first: $limit) {
        pageInfo {
          ...PaginationDetails
        }
        nodes {
          ...MemberDetails
        }
      }
    }
  }
`)

export const qGroups = graphql(/* GraphQL */ `
  query ListGroups($limit: Int = 5, $after: String = null) {
    groups(topLevelOnly: false, ownedOnly: false, allAvailable: true, after: $after, first: $limit) {
      pageInfo {
        ...PaginationDetails
      }
      nodes {
        ...GroupDetails
      }
    }
  }
`)

export const qProjects = graphql(/* GraphQL */ `
  query ListProjects($limit: Int = 50, $after: String = null) {
    projects(sort: "id_asc", after: $after, first: $limit) {
      pageInfo {
        ...PaginationDetails
      }
      nodes {
        ...ProjectDetails
      }
    }
  }
`)

export const qGroupProjects = graphql(/* GraphQL */ `
  query ListGroupProjects($FullPath: ID!, $limit: Int = 100, $after: String = null) {
    group(fullPath: $FullPath) {
      projects(includeSubgroups: false, includeArchived: true, first: $limit, after: $after) {
        pageInfo {
          ...PaginationDetails
        }
        nodes {
          id
          nameWithNamespace
          fullPath
        }
      }
    }
  }
`)

export const qDescendantGroups = graphql(/* GraphQL */ `
  query ListDescendantGroups($FullPath: ID!, $limit: Int = 100, $after: String = null) {
    group(fullPath: $FullPath) {
      descendantGroups(includeParentDescendants: false, first: $limit, after: $after) {
        pageInfo {
          ...PaginationDetails
        }
        nodes {
          id
          fullName
          fullPath
        }
      }
    }
  }
`)

export const qReleases = graphql(/* GraphQL */ `
  query ListReleases($FullPath: ID!, $limit: Int = 25, $after: String = null) {
    project(fullPath: $FullPath) {
      releases(sort: CREATED_ASC, after: $after, first: $limit) {
        pageInfo {
          ...PaginationDetails
        }
        nodes {
          ...ReleaseDetails
        }
      }
    }
  }
`)

export const qMilestones = graphql(/* GraphQL */ `
  query ListMilestones($FullPath: ID!, $limit: Int = 25, $after: String = null) {
    project(fullPath: $FullPath) {
      milestones(sort: CREATED_ASC, after: $after, first: $limit) {
        pageInfo {
          ...PaginationDetails
        }
        nodes {
          ...MilestoneDetails
        }
      }
    }
  }
`)

export const qPipelines = graphql(/* GraphQL */ `
  query ListPipelines($FullPath: ID!, $limit: Int = 25, $after: String = null) {
    project(fullPath: $FullPath) {
      pipelines(after: $after, first: $limit) {
        pageInfo {
          ...PaginationDetails
        }
        nodes {
          ...PipelineDetails
        }
      }
    }
  }
`)

export const qVulnerabilities = graphql(/* GraphQL */ `
  query ListVulnerabilities($limit: Int = 50, $after: String = null) {
    vulnerabilities(first: $limit, after: $after) {
      pageInfo {
        ...PaginationDetails
      }
      nodes {
        ...VulnerabilityDetails
      }
    }
  }
`)

export const qProject = graphql(/* GraphQL */ `
  query GetProjectDetails($FullPath: ID!) {
    project(fullPath: $FullPath) {
      ...ProjectDetails
    }
  }
`)

export const qBranches = graphql(/* GraphQL */ `
  query GetBranchNames($FullPath: ID!, $offset: Int = 0, $limit: Int = 200) {
    project(fullPath: $FullPath) {
      repository {
        branchNames(searchPattern: "*", offset: $offset, limit: $limit)
      }
    }
  }
`)

export const qVulnerabilityDiscussions = graphql(/* GraphQL */ `
  query GetVulnerabilityDiscussions($ID: VulnerabilityID!, $after: String = null, $limit: Int = 200) {
    vulnerability(id: $ID) {
      discussions(first: $limit, after: $after) {
        pageInfo {
          ...PaginationDetails
        }
        nodes {
          ...DiscussionDetails
        }
      }
    }
  }
`)

export const qIssueDiscussions = graphql(/* GraphQL */ `
  query GetIssueDiscussions($ID: IssueID!, $after: String = null, $limit: Int = 200) {
    issue(id: $ID) {
      discussions(first: $limit, after: $after) {
        pageInfo {
          ...PaginationDetails
        }
        nodes {
          ...DiscussionDetails
        }
      }
    }
  }
`)

export const qProjectMergeRequests = graphql(/* GraphQL */ `
  query GetProjectMergeRequest($FullPath: ID!, $after: String = null, $limit: Int = 20) {
    project(fullPath: $FullPath) {
      mergeRequests(sort: CREATED_ASC, first: $limit, after: $after) {
        pageInfo {
          ...PaginationDetails
        }
        nodes {
          ...MergeRequestDetails
        }
      }
    }
  }
`)

export const qMergeRequestDiscussions = graphql(/* GraphQL */ `
  query GetMergeRequestDiscussions($ID: MergeRequestID!, $after: String = null, $limit: Int = 200) {
    mergeRequest(id: $ID) {
      discussions(first: $limit, after: $after) {
        pageInfo {
          ...PaginationDetails
        }
        nodes {
          ...DiscussionDetails
        }
      }
    }
  }
`)

export const qGroupTimelogs = graphql(/* GraphQL */ `
  query GetTimelogs($FullPath: ID!, $after: String = null, $limit: Int = 50) {
    group(fullPath: $FullPath) {
      timelogs(after: $after, first: $limit) {
        pageInfo {
          ...PaginationDetails
        }
        nodes {
          ...TimelogDetails
        }
      }
    }
  }
`)

export const qPipelineCodeQualityReports = graphql(/* GraphQL */ `
  query GetPipelineCodeQualityReports($FullPath: ID!, $ID: CiPipelineID!, $after: String = null, $limit: Int = 50) {
    project(fullPath: $FullPath) {
      pipeline(id: $ID) {
        codeQualityReports(after: $after, first: $limit) {
          pageInfo {
            ...PaginationDetails
          }
          nodes {
            ...CodeQualityDegradationDetails
          }
        }
      }
    }
  }
`)

export const qPipelineSecurityReportFindings = graphql(/* GraphQL */ `
  query GetPipelineSecurityReportFindings($FullPath: ID!, $ID: CiPipelineID!, $after: String = null, $limit: Int = 50) {
    project(fullPath: $FullPath) {
      pipeline(id: $ID) {
        securityReportFindings(after: $after, first: $limit) {
          pageInfo {
            ...PaginationDetails
          }
          nodes {
            ...SecurityReportFindingDetails
          }
        }
      }
    }
  }
`)

export const qPipelineTestSuites = graphql(/* GraphQL */ `
  query GetPipelineTestSuites($FullPath: ID!, $ID: CiPipelineID!, $after: String = null, $limit: Int = 50) {
    project(fullPath: $FullPath) {
      pipeline(id: $ID) {
        testReportSummary {
          testSuites(after: $after, first: $limit) {
            pageInfo {
              ...PaginationDetails
            }
            nodes {
              ...TestSuiteSummaryDetails
            }
          }
        }
      }
    }
  }
`)

export const qGroupIssues = graphql(/* GraphQL */ `
  query GetGroupIssues($FullPath: ID!, $after: String = null, $limit: Int = 50) {
    group(fullPath: $FullPath) {
      issues(sort: created_asc, after: $after, first: $limit) {
        pageInfo {
          ...PaginationDetails
        }
        nodes {
          ...IssueDetails
        }
      }
    }
  }
`)
