import { json } from "@sveltejs/kit";
import { $ } from "bun";
import { pm2List } from "$lib/server/utils";

export async function GET({ request, locals }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  const pm2Processes = await pm2List();
  if (!pm2Processes) return json([]);
  return json(pm2Processes);
}

const getProcesses = async () => {
  let bunPids = undefined;
  let rawProcInf = undefined;
  let procInf = undefined;
  try {
    bunPids = await Array.fromAsync($`pgrep bun`.lines());
    bunPids = bunPids.filter((x) => !!x && x.length > 0);
  } catch (e) {
  } finally {
    if (!bunPids || bunPids.length <= 0) return [];
  }
  try {
    rawProcInf = await Promise.all(
      bunPids.map(async (x) => {
        const processInformation = await Array.fromAsync(await $`ps -p ${x}`.lines());
        return processInformation.length > 1 ? processInformation.slice(1) : undefined;
      })
    );
  } catch (e) {
  } finally {
    if (!rawProcInf || rawProcInf.length <= 0) return [];
  }
  try {
    procInf = rawProcInf
      .flat()
      .map((y) => {
        if (!y) return undefined;
        const columns = ["pid", "tty", "cpuTime", "cmd"];
        const info = y.split(/\s+/);
        const result = info.reduce(
          (target, value) => {
            if (!value || value.length <= 0) return target;
            const col = columns.shift();
            if (!col) {
              if (!Array.isArray(target.args)) target.args = [] as string[];
              target.args.push(value);
              return target;
            }
            if (col === "cmd") {
              const short = value.split("/").pop();
              if (!!short) target["cmdShort"] = short;
            }
            target[col] = value;
            return target;
          },
          { args: [] } as Record<string, string | string[]>
        );
        return result;
      })
      .reduce((col, cur) => {
        if (!cur) return col;
        col.push(cur);
        return col;
      }, [] as any[]);
  } catch (e) {}
  return procInf;
};
