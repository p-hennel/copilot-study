import type { RequestHandler } from "./$types";
import { getBackup } from "$lib/server/db/exporter";

export const GET: RequestHandler = async () => {
  const csv = await getBackup()
  const filename = `backup-${new Date().toISOString()}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Length': Buffer.byteLength(csv).toString(),
      'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    }
  })
}