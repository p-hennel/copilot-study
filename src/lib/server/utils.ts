import pm2, { type Proc } from "@socket.io/pm2";
import { json } from "@sveltejs/kit"; // Keep json import
import path from "node:path";

import { getDb } from "$lib/server/db"; // Import getDb
import { user as userSchema } from "$lib/server/db/schema"; // Import user schema
import { inArray, isNull, not, or } from "drizzle-orm"; // Import needed operators
// Removed incorrect import attempts for App

export enum CollectionTypes {
  User = "users",
  Group = "groups",
  Project = "projects",
  Timelog = "timelogs",
  Vulnerability = "vulnerabilities",
  Pipeline = "pipelines",
  Issue = "issues",
  Mergerequest = "mergerequests",
  Milestone = "milestones",
  Branch = "branches",
  Release = "releases",
  Discussion = "discussions",
  Commit = "commits",
  WorkItem = "workitems",
  Label = "labels" // Added Label
}

export async function getMD(
  slug: string,
  depends: (dep: string) => void,
  locals: App.Locals
): Promise<string> {
  depends("paraglide:lang");
  const selectedLanguage = locals.locale ?? "en";
  const content = await import(`$content/${selectedLanguage}/${slug}.md?raw`);
  return content.default as string;
}

export async function isAdmin(locals: App.Locals | undefined) {
  return locals && locals.session && locals.user && locals.user.role === "admin";
}

export async function unauthorizedResponse() {
  return json({ error: "unauthorized" }, { status: 401 });
}

export type AreaInformation = {
  id: string;
  fullPath: string;
  name?: string;
};

export type AuthorizationScopesResult = {
  groups: AreaInformation[];
  projects: AreaInformation[];
};

export const ensureUserIsAuthenticated = (locals: App.Locals) => {
  return (
    !!locals.session &&
    !!locals.user &&
    !!locals.user.id &&
    !!locals.user.email &&
    locals.user.email.length > 0
  );
};

const pm2Connect = async (): Promise<Error | undefined> => {
  return new Promise((resolve, reject) => {
    pm2.connect((err: Error) => {
      if (err) reject(err);
      else resolve(undefined);
    });
  });
};
export const pm2List = (): Promise<pm2.ProcessDescription[] | undefined> => {
  // Remove async from signature
  return new Promise((resolve, reject) => {
    // Remove async from executor
    // IIAFE to handle async operations
    (async () => {
      try {
        const err = await pm2Connect();
        if (err) return reject(err); // Use return reject
        pm2.list((listErr: Error, procDesc: pm2.ProcessDescription[]) => {
          if (listErr) return reject(listErr); // Use return reject
          resolve(procDesc);
        });
      } catch (e) {
        reject(e); // Catch potential errors from pm2Connect
      }
    })(); // Immediately invoke
  });
};

export async function pm2Start(
  process: string | number | undefined,
  startOptions?: pm2.StartOptions
) {
  return pm2Handle("start", process, startOptions);
}

export async function pm2Stop(process: string | number | "all") {
  return pm2Handle("stop", process);
}

export async function pm2Restart(process: string | number | "all") {
  return pm2Handle("restart", process);
}

type PM2ErrCB = (err: Error, proc: Proc) => void;
type PM2StartFN = (options: pm2.StartOptions, errback: PM2ErrCB) => void;
type PM2ActionFN = (process: string | number, errback: PM2ErrCB) => void;
type PM2Function = PM2StartFN | PM2ActionFN;

async function pm2Handle(
  action: "start" | "stop" | "restart" = "restart",
  process: "all" | string | number | undefined = "all",
  startOptions?: pm2.StartOptions
): Promise<pm2.Proc | undefined> {
  return new Promise((resolve, reject) => {
    // Remove async
    (async () => {
      // IIAFE
      try {
        const err = await pm2Connect();
        if (err) return reject(err);
        let fnAction: PM2Function; // Keep Function type for now, complex to replace
        if (action === "start") fnAction = pm2.start.bind(pm2);
        else if (action === "stop") fnAction = pm2.stop.bind(pm2);
        else if (action === "restart") fnAction = pm2.restart.bind(pm2);
        else return reject();

        const cb = (err: Error, proc: pm2.Proc) => {
          if (err) return reject(err);
          resolve(proc);
        };

        if (action === "start" && !!startOptions) {
          (fnAction as PM2StartFN)(startOptions, cb);
        } else {
          (fnAction as PM2ActionFN)(process, cb);
        }
      } catch (e) {
        reject(e);
      }
    })(); // Invoke IIAFE
  });
}

export const pm2Send = async <S extends object = object, R extends object = object>(
  procId: number,
  msg: S
): Promise<R | undefined> => {
  return new Promise((resolve, reject) => {
    // Remove async
    (async () => {
      // IIAFE
      try {
        const err = await pm2Connect();
        if (err) return reject(err);
        // Assuming types for err/result are fixed by @types/pm2
        pm2.sendDataToProcessId(procId, msg, (sendErr, result) => {
          if (sendErr) return reject(sendErr);
          resolve(result as R);
        });
      } catch (e) {
        reject(e);
      }
    })(); // Invoke IIAFE
  });
};

import { auth } from "$lib/auth";
import { JobStatus } from "$lib/types";
import * as Bun from "bun";
import { and, count, eq } from "drizzle-orm";
import { db } from "./db";
import { account, apikey, area_authorization, job } from "./db/schema";
import AppSettings from "./settings";
import { getLogger } from "nodemailer/lib/shared";

export const getApiToken = async (userId: string): Promise<string | undefined> => {
  const oldKey = await db.select().from(apikey).where(eq(apikey.userId, userId)).limit(1);
  if (oldKey.length > 0 && !!oldKey.at(0)) return oldKey.at(0)?.key;
  else {
    // Add type assertion to inform TS about the expected method
    const api = auth.api as typeof auth.api & {
      createApiKey: (args: {
        body: { userId: string; enabled: boolean; rateLimitEnabled: boolean; permissions: any };
      }) => Promise<{ key: string }>;
    };
    const newKey = await api.createApiKey({
      body: {
        userId: userId,
        enabled: true,
        rateLimitEnabled: false,
        permissions: {
          repository: ["read", "write"],
          branch: ["read", "write"]
        }
      }
    });
    return newKey.key;
  }
};

export const canAccessAreaFiles = async (fullPath: string, userId: string | undefined) => {
  if (!userId) return false;
  return await db
    .select({
      count: count()
    })
    .from(area_authorization)
    .innerJoin(account, eq(area_authorization.accountId, account.id)) // Corrected join condition (assuming account PK is 'id')
    .where(and(eq(area_authorization.area_id, fullPath), eq(account.userId, userId)))
    .then((val) => (val && val[0] ? val[0].count >= 1 : false)); // More explicit check and default
};

export const areAreaJobsFinished = async (fullPath: string) => {
  const total = await db.$count(job, eq(job.full_path, fullPath));
  const finished =
    total < 0
      ? 0
      : await db.$count(job, and(eq(job.full_path, fullPath), eq(job.status, JobStatus.finished)));
  return finished < total || total <= 0;
};

export const fileForAreaPart = async (
  fullPath: string | string[],
  type: CollectionTypes | string
) => {
  if (!Array.isArray(fullPath)) fullPath = fullPath.split("/");
  if (typeof type === "string") {
    const tmp = fileToCollectionType(type);
    if (!tmp) return undefined;
    type = tmp;
  }

  const filePath = path.resolve(path.join(AppSettings().paths.dataRoot, ...fullPath));
  const file = Bun.file(filePath);
  if (!(await file.exists)) return undefined;
  else return file;
};

export const fileToCollectionType = (file: string): CollectionTypes | undefined => {
  const keys = Object.keys(CollectionTypes);
  const fileName = path.basename(file, path.extname(file));
  if (keys.includes(fileName)) return fileName as CollectionTypes;
  else return undefined;
};
function getEnvVar(key: string, fallback = "") {
  if (Object.prototype.hasOwnProperty.call(Bun.env, key)) {
    return Bun.env[key];
  } else {
    return fallback;
  }
}
type Valuable<T> = {
  [K in keyof T as T[K] extends null | undefined ? never : K]: T[K];
};
function getValuable<
  T extends object,
  V = Valuable<T>
>(obj: T): V {
  return Object.fromEntries(
    Object.entries(obj).filter(
      ([, v]) => !(
        (typeof v === 'string' && !v.length) ||
        v === null ||
        typeof v === 'undefined'
      )
    )
  ) as V;
}

export const syncAdminRoles = async () => {
  const logger = getLogger(["AdminSync"])
  const settings = AppSettings()
  // Use optional chaining within this function as well
  logger.info("Synchronizing admin roles...")
  if (!settings?.auth?.admins) {
    logger?.warn("No admin emails defined in settings. Skipping admin sync.")
    return
  }

  const adminEmails = settings.auth.admins.map((admin) => admin.email).filter(Boolean)

  if (adminEmails.length === 0) {
    logger?.info("Settings contain an empty admin list. Demoting all current admins.")
  } else {
    logger?.info("Admin emails from settings:", { adminEmails })
  }

  const db = getDb()

  try {
    logger?.info(`[AdminSync] Starting sync.`, { adminEmails })

    // 1. Find users to demote
    logger?.info("[AdminSync] Querying for users to demote...")
    const usersToDemote = await db
      .select({ id: userSchema.id, email: userSchema.email })
      .from(userSchema)
      .where(
        and(
          eq(userSchema.role, "admin"),
          adminEmails.length > 0 ? not(inArray(userSchema.email, adminEmails)) : undefined
        )
      )

    if (usersToDemote.length > 0) {
      const emailsToDemote = usersToDemote.map((u) => u.email)
      const idsToDemote = usersToDemote.map((u) => u.id)
      logger?.info(`[AdminSync] Found ${usersToDemote.length} users to demote`, { emailsToDemote })
      try {
        await db.update(userSchema).set({ role: null }).where(inArray(userSchema.id, idsToDemote))
        logger?.info(`[AdminSync] Successfully demoted ${usersToDemote.length} users.`)
      } catch (updateError) {
        logger?.error(`[AdminSync] Error demoting users`, { emailsToDemote, error: updateError })
      }
    } else {
      logger?.info("[AdminSync] No users found to demote.")
    }

    // 2. Find users to promote
    if (adminEmails.length > 0) {
      logger?.info("[AdminSync] Querying for users to promote...")
      const usersToPromote = await db
        .select({ id: userSchema.id, email: userSchema.email })
        .from(userSchema)
        .where(
          and(inArray(userSchema.email, adminEmails), or(not(eq(userSchema.role, "admin")), isNull(userSchema.role)))
        )

      if (usersToPromote.length > 0) {
        const emailsToPromote = usersToPromote.map((u) => u.email)
        const idsToPromote = usersToPromote.map((u) => u.id)
        logger?.info(`[AdminSync] Found ${usersToPromote.length} users to promote`, { emailsToPromote })
        try {
          await db.update(userSchema).set({ role: "admin" }).where(inArray(userSchema.id, idsToPromote))
          logger?.info(`[AdminSync] Successfully promoted ${usersToPromote.length} users.`)
        } catch (updateError) {
          logger?.error(`[AdminSync] Error promoting users`, { emailsToPromote, error: updateError })
        }
      } else {
        logger?.info("[AdminSync] No users found to promote.")
      }
    } else {
      logger?.info("[AdminSync] Skipping promotion step as admin email list in settings is empty.")
    }

    logger?.info("[AdminSync] Admin role synchronization complete.")
  } catch (dbError) {
    logger?.error("Error during admin role synchronization:", { error: dbError })
  }
}