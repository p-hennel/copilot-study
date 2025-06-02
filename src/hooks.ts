import { deLocalizeUrl } from "$lib/paraglide/runtime";

export const reroute = (request: Request) => deLocalizeUrl(request.url).pathname;
export const transport = {};
