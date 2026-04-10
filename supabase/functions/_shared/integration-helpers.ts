import { createClient } from "jsr:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export type Provider = "mal" | "anilist";

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function envOrThrow(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Variable d'environnement manquante: ${name}`);
  }
  return value;
}

export function createUserSupabaseClient(req: Request) {
  const supabaseUrl = envOrThrow("SUPABASE_URL");
  const supabaseAnonKey = envOrThrow("SUPABASE_ANON_KEY");
  const authHeader = req.headers.get("Authorization") ?? "";
  const apiKeyHeader = req.headers.get("apikey") ?? supabaseAnonKey;
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader,
        apikey: apiKeyHeader,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function requireUserId(req: Request): Promise<string> {
  const supabase = createUserSupabaseClient(req);
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  if (!token) {
    throw new Error("Utilisateur non authentifié (token absent).");
  }
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    throw new Error("Utilisateur non authentifié.");
  }
  return user.id;
}

function base64UrlEncode(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomBase64Url(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64UrlEncode(bytes);
}

export async function sha256Base64Url(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncode(new Uint8Array(hashBuffer));
}

export function resolveRedirectUri(
  provider: Provider,
  req: Request,
  callbackFunctionName = "integration-oauth-callback"
): string {
  const explicit = Deno.env.get(`INTEGRATION_${provider.toUpperCase()}_REDIRECT_URI`);
  if (explicit) {
    return explicit;
  }
  const base = Deno.env.get("INTEGRATION_REDIRECT_BASE_URL");
  if (base) {
    return `${base.replace(/\/+$/, "")}/functions/v1/${callbackFunctionName}/${provider}`;
  }
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;
  return `${origin}/functions/v1/${callbackFunctionName}/${provider}`;
}

export function resolveFrontendReturnUrl(): string {
  const explicit = Deno.env.get("INTEGRATION_FRONTEND_RETURN_URL");
  if (explicit) {
    return explicit;
  }
  const fallback = Deno.env.get("INTEGRATION_REDIRECT_BASE_URL");
  if (fallback) {
    return `${fallback.replace(/\/+$/, "")}/`;
  }
  return "/";
}
