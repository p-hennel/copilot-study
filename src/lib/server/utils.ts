import path from "node:path";
import { json } from "@sveltejs/kit";
import pm2 from "pm2";

export async function getMD(slug: string, depends: any, locals: any): Promise<string> {
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
      if (!!err) reject(err);
      else resolve(undefined);
    });
  });
};

export const pm2List = async (): Promise<pm2.ProcessDescription[] | undefined> => {
  return new Promise(async (resolve, reject) => {
    const err = await pm2Connect();
    if (!!err) return reject(err);
    pm2.list((err: Error, procDesc: pm2.ProcessDescription[]) => {
      if (!!err) return reject(err);
      resolve(procDesc);
    });
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

async function pm2Handle(
  action: "start" | "stop" | "restart" = "restart",
  process: "all" | string | number | undefined = "all",
  startOptions?: pm2.StartOptions
): Promise<pm2.Proc | undefined> {
  return new Promise(async (resolve, reject) => {
    const err = await pm2Connect();
    if (!!err) return reject(err);
    let fnAction: Function;
    if (action === "start") fnAction = pm2.start.bind(pm2);
    else if (action === "stop") fnAction = pm2.stop.bind(pm2);
    else if (action === "restart") fnAction = pm2.restart.bind(pm2);
    else return reject();

    const cb = (err: Error, proc: pm2.Proc) => {
      if (!!err) return reject(err);
      resolve(proc);
    };

    let args: any[] = [process];
    if (action === "start" && !!startOptions) args.push(startOptions);
    args.push(cb);

    fnAction(...args);
  });
}

export const pm2Send = async <S extends object = object, R extends object = object>(
  procId: number,
  msg: S
): Promise<R | undefined> => {
  return new Promise(async (resolve, reject) => {
    const err = await pm2Connect();
    if (!!err) return reject(err);
    pm2.sendDataToProcessId(procId, msg, (err, result) => {
      if (!!err) return reject(err);
      resolve(result as R);
    });
  });
};

import { and, count, eq } from "drizzle-orm";
import { account, apikey, area_authorization, job } from "./db/schema";
import { db } from "./db";
import { auth } from "$lib/auth";
import { JobStatus } from "$lib/utils";
import { CollectionTypes } from "../crawler/utils/datastorage";
import AppSettings from "./settings/index";

export const getApiToken = async (userId: string): Promise<string | undefined> => {
  const oldKey = await db.select().from(apikey).where(eq(apikey.userId, userId)).limit(1);
  if (oldKey.length > 0 && !!oldKey.at(0)) return oldKey.at(0)?.key;
  else {
    const newKey = await auth.api.createApiKey({
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
    .innerJoin(account, eq(area_authorization.accountId, account.accountId))
    .where(and(eq(area_authorization.area_id, fullPath), eq(account.userId, userId)))
    .then((val) => !!val && val.length > 0 && val[0].count >= 1);
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

  const filePath = path.resolve(path.join(AppSettings.paths.dataRoot, ...fullPath));
  const file = Bun.file(filePath);
  if (!(await file.exists)) return undefined;
  else return file;
};

export const fileToCollectionType = (file: string): CollectionTypes | undefined => {
  const keys = Object.keys(CollectionTypes);
  let fileName = path.basename(file, path.extname(file));
  if (keys.includes(fileName)) return fileName as CollectionTypes;
  else return undefined;
};
