// Better Auth catch-all route handler (sign-in, sign-up, session, org, etc.).

import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const { POST, GET } = toNextJsHandler(auth);
