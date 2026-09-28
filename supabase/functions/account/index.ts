// Visionary — account edge function
// Modes:
//   delete  → permanently deletes the caller's tasks, reflections, profile and auth user.
//
// Requires a signed-in user, an allowed Origin, and the confirmation phrase "DELETE".

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  admin, corsHeaders, HttpError, isAllowedOrigin, json, logSecurityEvent, readJsonLimited, requireUser,
} from "../_shared/security.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    if (!isAllowedOrigin(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  let userId: string | null = null;
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
    if (!isAllowedOrigin(origin)) throw new HttpError(403, "Origin not allowed.", "blocked_origin");
    const user = await requireUser(req);
    userId = user.id;

    const body = await readJsonLimited(req, 2 * 1024);
    if (body?.mode !== "delete") throw new HttpError(400, "Unknown mode.");
    if (body?.confirm !== "DELETE") throw new HttpError(400, "Confirmation phrase missing.");

    const db = admin();
    await logSecurityEvent(req, "account_deletion_requested", user.id);
    for (const [table, column] of [["tasks", "user_id"], ["reflections", "user_id"], ["ai_usage", "user_id"], ["profiles", "id"]]) {
      const { error } = await db.from(table).delete().eq(column, user.id);
      if (error) throw new Error(`delete ${table}: ${error.message}`);
    }
    const { error } = await db.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`delete auth user: ${error.message}`);
    await logSecurityEvent(req, "account_deleted", null, { user_id_hash: user.id.slice(0, 8) });

    return json({ ok: true }, 200, origin);
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.event) await logSecurityEvent(req, err.event, userId, { status: err.status });
      return json({ error: err.publicMessage }, err.status, origin);
    }
    console.error("account error", err);
    return json({ error: "Something went wrong. Please try again." }, 500, origin);
  }
});
