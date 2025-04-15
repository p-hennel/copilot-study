import { json } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { eq, desc } from "drizzle-orm";
import { job } from "$lib/server/db/base-schema";

export async function GET({ locals }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  const jobs = await getJobs();
  return json(jobs);
}

const getJobs = async () => {
  const result = (
    await db.query.job.findMany({
      // Explicitly select all columns or list required ones including resumeState
      // For now, let's assume findMany without 'columns' gets all, including resumeState.
      // If resumeState is missing later, add: columns: { resumeState: true, /* other needed columns */ },
      with: {
        usingAccount: {
          columns: {
            providerId: true
          }
        },
        forArea: true,
        fromJob: {
          columns: {
            id: true,
            command: true,
            status: true,
            started_at: true,
            finished_at: true
          }
        }
      },
      extras: {
        childrenCount: db.$count(job, eq(job.spawned_from, job.id)).as("childrenCount")
      },
      orderBy: [desc(job.id)]
    })
  ).map((x) => {
    const { usingAccount, ...rest } = x;
    return {
      ...rest,
      provider: usingAccount?.providerId ?? undefined
    };
  });

  return result;
};
