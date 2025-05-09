// See https://svelte.dev/docs/kit/types#app.d.ts

import type { Session } from "better-auth";
import { user } from "./lib/server/db/schema";

// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      session?: Session;
      user?: user;
      locale: "en";
      requestSource: string;
      isSocketRequest: boolean;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
