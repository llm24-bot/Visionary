// Shared security helpers for Visionary edge functions.
// - Origin allowlist (CORS lock-down + CSRF-style origin check)
// - Request size limits
// - Authenticated user resolution (a valid *user* JWT, not just the anon key)
// - Security event logging (service role only)

import { createClient, type SupabaseClient, type User } from "jsr:@supabase/supabase-js@2";

const DEFAULT_ORIGINS = [
  "https://visionary-llm24-bots-projects.vercel.app",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

export function allowedOrigins(): string[] {
  const fromEnv = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ORIGINS;
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return allowedOrigins().includes(origin.replace(/\/$/, ""));
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };
  if (origin && isAllowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

export class HttpError extends Error {
  constructor(public status: number, public publicMessage: string, public event?: string) {
    super(publicMessage);
  }
}

/** Reads the body as JSON while enforcing a hard byte limit (Content-Length can lie). */
export async function readJsonLimited(req: Request, maxBytes: number): Promise<any> {
  const declared = Number(req.headers.get("content-length") || "0");
  if (declared > maxBytes) throw new HttpError(413, "Request is too large.", "request_too_large");
  if (!req.body) throw new HttpError(400, "Missing request body.");

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "Request is too large.", "request_too_large");
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new HttpError(400, "Malformed JSON.");
  }
}

let adminClient: SupabaseClient | null = null;
export function admin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

/** Resolves the calling user from their access token. Rejects anon-key-only calls. */
export async function requireUser(req: Request): Promise<User> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in required.", "unauthenticated_call");
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Sign in required.", "unauthenticated_call");
  return data.user;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Writes to public.security_events. IPs are stored as salted hashes, never in the clear. */
export async function logSecurityEvent(
  req: Request,
  event: string,
  userId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    const salt = Deno.env.get("LOG_SALT") || "visionary";
    await admin().from("security_events").insert({
      event,
      user_id: userId,
      ip_hash: ip ? (await sha256(salt + ip)).slice(0, 32) : null,
      origin: req.headers.get("origin"),
      detail,
    });
  } catch (e) {
    console.error("security log failed", e);
  }
}

/** Strips control characters and caps length. Used on every string that reaches a prompt. */
export function cleanText(value: unknown, max: number): string {
  return String(value ?? "")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
