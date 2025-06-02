import { json } from "@sveltejs/kit";
import { computeHash } from "$lib/server/CryptoHash";

export async function POST({ locals, request }: { request: Request, locals: any }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    // No need to log unauthorized attempts unless debugging specific issues
    return json({ error: "Unauthorized!" }, { status: 401 });
  }
  const data: any = await request.json();
  const hash = computeHash(data.value ?? locals.user?.email);
  return json({ success: true, hashedValue: hash });
}
