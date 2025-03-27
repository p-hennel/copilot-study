import { eq, and, inArray } from "drizzle-orm";
import { db } from ".";
import { account } from "./auth-schema";
import { area, job, type JobInsert, type Job as JobType } from "./base-schema";
import { AreaType, CrawlCommand } from "$lib/utils";
import type { AreaInformation, AuthorizationScopesResult } from "../utils";
import type { ResultSet } from "@libsql/client";
import { ulid } from "ulid";
import { getLogger } from "@logtape/logtape";
import path from "node:path";
import { JobStatus, type TokenProvider } from "$lib/utils";
import { env } from "$env/dynamic/private";

const logger = getLogger(["server", "jobFactory"]);

export type JobSearchResults = {
  id: string;
  provider: string;
  token: string | null;
  refreshToken: string | null;
  idToken: string | null;
  status: JobStatus;
  command: CrawlCommand;
  full_path: string | null;
}[];

export async function jobSearch(userId: string): Promise<JobSearchResults>;
export async function jobSearch(
  provider: TokenProvider,
  fullPaths: string[]
): Promise<JobSearchResults>;
export async function jobSearch(
  userId_Provider: TokenProvider | string,
  fullPaths?: string[]
): Promise<JobSearchResults> {
  const query = [];
  if (!!fullPaths) {
    userId_Provider = userId_Provider as TokenProvider;
    fullPaths = fullPaths!;
    if (fullPaths.length <= 0) return [];
    query.push(inArray(job.full_path, fullPaths));
    query.push(eq(account.providerId, userId_Provider));
  } else {
    userId_Provider = userId_Provider as string;
    query.push(eq(job.command, CrawlCommand.authorizationScope));
    query.push(eq(account.userId, userId_Provider));
  }

  const results = await db
    .select({
      id: job.id,
      provider: account.providerId,
      token: account.accessToken,
      refreshToken: account.refreshToken,
      idToken: account.idToken,
      status: job.status,
      command: job.command,
      full_path: job.full_path
    })
    .from(job)
    .innerJoin(account, eq(job.accountId, account.id))
    .where(and(...query));
  return results;
}

const _toJobLookup = (
  provider: TokenProvider,
  full_path: string | undefined | null,
  command: CrawlCommand,
  id: string,
  status: JobStatus
) => {
  return {
    [provider]: {
      [full_path ?? ""]: {
        [command]: {
          id,
          status
        }
      }
    }
  } as ExistingJobLookup;
};

export const toJobLookup = (jobs: JobSearchResults): ExistingJobLookup => {
  return jobs
    .map((x) => _toJobLookup(x.provider as TokenProvider, x.full_path, x.command, x.id, x.status))
    .reduce(merge, {} as ExistingJobLookup);
};

const merge = <T extends { [key: string]: any }>(objA: T, objB: T) => {
  for (const keyB in objB) {
    const valueB = objB[keyB as keyof typeof objB];
    const keyA = keyB as keyof typeof objA;
    const valueA = keyB in objA ? objA[keyA] : undefined;
    if (!valueA) {
      objA = Object.assign(objA, { [keyB]: [valueB] as any[] });
    } else if (Array.isArray(objA[keyA])) {
      objA[keyA].push(valueB);
    } else {
      if (typeof objA[keyA] === "object") {
        objA[keyA] = merge(objA[keyA], objB[keyB]);
      } else {
        logger.warn("Attempting strange object merge with keys A ({keyA}) and B ({keyB})", {
          objA,
          objB,
          keyA,
          keyB
        });
      }
    }
  }

  for (const keyB in objB) {
    const valueB = objB[keyB as keyof typeof objB];
    const valueA = keyB in objA ? objA[keyB as keyof typeof objA] : undefined;
    if (!valueA) {
      objA = Object.assign(objA, { [keyB]: [valueB] as any[] });
    } else if (Array.isArray(objA[keyB as keyof typeof objA])) {
      objA[keyB as keyof typeof objA].push(valueB);
    } else {
      const valueA = objA[keyB as keyof typeof objA];
      objA = Object.assign(objA, { [keyB]: [valueA, valueB] as any[] });
    }
  }
  return objA;
};

export const newJob = (
  accountId: string,
  command: CrawlCommand,
  previousJobId?: string,
  fullPath?: string
) => {
  return {
    accountId: accountId,
    full_path: fullPath,
    command: command,
    spawned_from: previousJobId
  };
};

export const jobFromAreaFactory =
  (command: CrawlCommand, previousJob: { accountId: string; id: string }) =>
  (area: AreaInformation) =>
    newJob(previousJob.accountId, command, previousJob.id, area.fullPath);

export const prepareNewArea = (provider: TokenProvider, type: AreaType, area: AreaInformation) => {
  return {
    provider,
    full_path: area.fullPath,
    gitlab_id: area.id,
    name: area.name,
    type: type
  };
};

export const prepareNewAreas = (
  provider: TokenProvider,
  type: AreaType,
  areas: AreaInformation[]
) => {
  return areas.map((area) => prepareNewArea(provider, type, area));
};

export const ensureAreasExist = async (
  provider: TokenProvider,
  scopes: AuthorizationScopesResult
) => {
  await db
    .insert(area)
    .values([
      ...prepareNewAreas(provider, AreaType.group, scopes.groups),
      ...prepareNewAreas(provider, AreaType.project, scopes.projects)
    ])
    .onConflictDoNothing();
  return [
    ...new Set([...scopes.groups.map((x) => x.fullPath), ...scopes.projects.map((x) => x.fullPath)])
  ];
};

export const prepareNewJobsAfterScoping = (
  previousJob: { accountId: string; id: string },
  groups: AuthorizationScopesResult["groups"],
  projects: AuthorizationScopesResult["projects"]
) => {
  // 3: Now we prepare new Jobs...
  const newJobs = [];
  // 3.1: For Groups
  newJobs.push(...groups.map(jobFromAreaFactory(CrawlCommand.group, previousJob)));
  // 3.2: For Projects
  newJobs.push(...projects.map(jobFromAreaFactory(CrawlCommand.project, previousJob)));
  // 3.3: For Users
  newJobs.push(newJob(previousJob.accountId, CrawlCommand.users, previousJob.id));
  // 3.4: For Vulnerabilities
  newJobs.push(newJob(previousJob.accountId, CrawlCommand.vulnerabilities, previousJob.id));
  // 3.5: For Timelogs
  newJobs.push(newJob(previousJob.accountId, CrawlCommand.timelogs, previousJob.id));

  return newJobs;
};

const checkJobOperationResults = (jobs: any[], result: ResultSet, action: "update" | "insert") => {
  // Check that all new Jobs are actually inserted
  if (result.rowsAffected < jobs.length) {
    handleIncident("Could not {action} Jobs!", jobs, action);
  }
};

export const handleIncident = (message: string, mainData: any, ...context: any[]) => {
  const incidentID = ulid();
  logger.error(`\nINCIDENT {incidentID}\n\t${message}`, { ...context, mainData, incidentID });
  Bun.write(
    path.join("logs", "incidents", `${incidentID}.data`),
    `${message}\n${Bun.inspect(context)}\n\n${Bun.inspect(mainData)}`
  );
};

export const ensureJobSync = async (inserts: JobInsert[], resetJobIDs: string[]) => {
  // 5: If we need to insert new jobs
  if (inserts.length > 0) {
    // do so and check the results
    await db.insert(job).values(inserts).onConflictDoNothing();
    /*
    checkJobOperationResults(
      inserts,
      await db.insert(job).values(inserts).onConflictDoNothing(),
      "insert")
    */
  }

  // 6: If we need to update some jobs
  if (resetJobIDs.length > 0) {
    // do so and check the result again
    checkJobOperationResults(
      resetJobIDs,
      await db
        .update(job)
        .set({
          status: JobStatus.queued,
          started_at: null,
          finished_at: null
        })
        .where(inArray(job.id, resetJobIDs)),
      "update"
    );
  }
};

export type ExistingJobLookup = {
  [provider in TokenProvider]: {
    // or full_path.command
    [key: string]: {
      [subkey in CrawlCommand]?: {
        id: string;
        status: JobStatus;
      };
    };
  };
};

export const prepareJobInsertsAndResets = (
  newJobs: any[],
  existingJobs: ExistingJobLookup,
  provider?: TokenProvider
) => {
  // 4: Only to now filter all potential new Jobs into those we need to update...
  const updateJobs = [] as string[];
  // 4.1: ... and those we need to insert
  const insertJobs = newJobs.filter((x) => {
    if (
      !x.command ||
      x.command.length <= 0 ||
      (!provider && (!x.provider || x.provider.length <= 0))
    )
      return false;

    const providerJobs: ExistingJobLookup[keyof ExistingJobLookup] =
      existingJobs[(x.provider as TokenProvider) ?? provider];
    const jobsLookup =
      !!x.full_path && x.full_path.length > 0 ? providerJobs[x.full_path] : providerJobs[""];
    const jobInfo =
      (x.command as CrawlCommand) in jobsLookup ? jobsLookup[x.command as CrawlCommand] : undefined;
    // If the key does not exist, it's truly a new job and gets inserted
    if (!jobInfo) return true;

    // If the key for this job exists and is an actual value...
    // we can only make use if the job has failed before...
    if (jobInfo.status === JobStatus.failed) {
      // ... and reset its status
      updateJobs.push(jobInfo.id);
    }
    // anyway, we will discard it as a new job.
    return false;
  });

  return {
    inserts: insertJobs,
    resets: updateJobs
  };
};

export const spawnNewJobs = async (
  provider: TokenProvider,
  scopes: AuthorizationScopesResult,
  currentJob: { accountId: string; id: string }
) => {
  try {
    // 1: insert areas (groups, projects), if they do not already exist
    // 2: To check if jobs already exist (are done or running even?), we collect all path information
    const fullPaths = await ensureAreasExist(provider, scopes);

    // 3: Then we fetch jobs that exist form the database
    const existingJobs = toJobLookup(await jobSearch(provider, fullPaths));

    // 4: Now we need to actually build the potential new jobs
    const newJobs = prepareNewJobsAfterScoping(currentJob, scopes.groups, scopes.projects);

    // 5: We can now filter those candidates into those to insert, those to reset, and some discarded ones
    const preparedJobs = prepareJobInsertsAndResets(newJobs, existingJobs);

    // 6: Now it is time to sync this to the DB
    await ensureJobSync(preparedJobs.inserts, preparedJobs.resets);
  } catch (error: any) {
    handleIncident("Could not create Jobs!", currentJob, error);
  }
};

export const getAccounts = async (userId: string) => {
  return await db
    .selectDistinct({
      id: account.id,
      provider: account.providerId,
      token: account.accessToken,
      refreshToken: account.refreshToken
    })
    .from(account)
    .where(eq(account.userId, userId));
};

export const isResettable = (obj: Partial<JobType>) => {
  return !obj.status || obj.status !== JobStatus.failed;
};

export async function scopingJobsFromAccounts(
  accounts: Awaited<ReturnType<typeof getAccounts>>,
  userId: string
): Promise<void>;
export async function scopingJobsFromAccounts(
  accounts: Awaited<ReturnType<typeof getAccounts>>,
  existingJobs: ExistingJobLookup
): Promise<void>;
export async function scopingJobsFromAccounts(
  accounts: Awaited<ReturnType<typeof getAccounts>>,
  existingJobs: ExistingJobLookup | string
): Promise<void> {
  if (typeof existingJobs === "string") existingJobs = toJobLookup(await jobSearch(existingJobs));
  const mappedObjs: (undefined | string | ReturnType<typeof newJob>)[] = accounts.map((x) => {
    let obj = x.provider in existingJobs ? existingJobs[x.provider as TokenProvider] : undefined;
    if (!!obj && !isResettable(obj)) return undefined;
    else if (!!obj && !!obj.status) {
      return obj.id as string;
    } else {
      return newJob(x.id, CrawlCommand.authorizationScope);
    }
  });
  const scopingJobs = mappedObjs.reduce(
    (z, x) => {
      if (!x) return z;
      if (typeof x === "string") {
        z.updates.push(x);
      } else {
        z.inserts.push(x);
      }
      return z;
    },
    { inserts: [] as JobInsert[], updates: [] as string[] }
  );
  await ensureJobSync(scopingJobs.inserts, scopingJobs.updates);
}

export const getAvailableJobs = async (
  status: JobStatus = JobStatus.queued,
  cursor: string | null = null,
  perPage: number = 10
) => {
  perPage = Math.min(Math.max(perPage, 0), 50);
  const filter = [eq(job.status, status)];
  if (!!cursor) {
    filter.push(gt(job.id, cursor));
  }
  const jobResults = (
    await db.query.job.findMany({
      columns: {
        id: true,
        status: true,
        command: true,
        full_path: true,
        branch: true,
        from: true,
        to: true
      },
      with: {
        usingAccount: {
          columns: {
            providerId: true,
            accessToken: true,
            accessTokenExpiresAt: true,
            refreshToken: true,
            refreshTokenExpiresAt: true
          }
        }
      },
      where: (_, { and }) => and(...filter),
      orderBy: (table, { asc }) => asc(table.id),
      limit: perPage
    })
  ).map((x) => {
    const { usingAccount, full_path, command, ...rest } = x;
    const { providerId, ...accountRest } = usingAccount;
    return {
      ...rest,
      command: command as CrawlCommand,
      fullPath: full_path,
      ...accountRest,
      baseURL: providerToBaseURL(providerId),
      provider: providerId as TokenProvider
    };
  });
  return jobResults;
};

export const providerToBaseURL = (provider: TokenProvider | string) => {
  return env[`${provider.toUpperCase()}_BASE_URL`];
};
