import { json } from "@sveltejs/kit";
import pm2 from "@socket.io/pm2";
import { pm2Restart, pm2Start, pm2Stop } from "$lib/server/utils";

export async function POST({ request, locals }: { request: Request, locals: any }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  const data: any = await request.json();
  if (!data.pid) return json({ error: "Invalid request" }, { status: 400 });

  let result: pm2.Proc | undefined;

  if (
    !!data.action &&
    typeof data.action === "string" &&
    (data.action as string).toLowerCase() !== "restart"
  ) {
    const action = (data.action as string).toLowerCase();
    if (action === "start") {
      const startOptions: pm2.StartOptions = data.options;
      result = await pm2Start(
        data.pid,
        !!startOptions && Object.keys(startOptions).length > 0 ? startOptions : undefined
      );
    } else if (action === "stop") {
      result = await pm2Stop(data.pid);
    } else {
      return json({ error: "Invalid request" }, { status: 400 });
    }
  } else {
    result = await pm2Restart(data.pid);
  }

  //Bun.spawn(["kill", "-9", data.pid]);

  return json({
    success: true,
    result
  });
}
