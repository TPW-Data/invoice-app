// Admin-only user management: list users, create users, set roles, reset passwords.
// Deploy as an Edge Function named "manage-users" (JWT verification ON).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ROLES = ["admin", "accounting", "management"];
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");

    // Who is calling? Must be signed in and have the admin role
    const caller = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: { user: me }, error: meErr } = await caller.auth.getUser(token);
    if (meErr || !me) return json({ error: "Not signed in" }, 401);
    if (me.app_metadata?.role !== "admin") return json({ error: "Admins only" }, 403);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json();

    if (body.action === "list") {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw error;
      return json({
        users: data.users.map((u) => ({
          id: u.id,
          email: u.email,
          role: u.app_metadata?.role ?? "",
          last_sign_in: u.last_sign_in_at ?? null,
        })),
      });
    }

    if (body.action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      if (!email.includes("@")) return json({ error: "Enter a valid email" }, 400);
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      if (!ROLES.includes(body.role)) return json({ error: "Choose a role" }, 400);
      const { error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { role: body.role },
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "set_role") {
      const role = body.role === "" ? null : body.role;
      if (role !== null && !ROLES.includes(role)) return json({ error: "Unknown role" }, 400);
      if (body.user_id === me.id && role !== "admin") {
        return json({ error: "You cannot remove your own admin role" }, 400);
      }
      const { data: target, error: getErr } = await admin.auth.admin.getUserById(body.user_id);
      if (getErr) return json({ error: getErr.message }, 400);
      const meta = { ...(target.user.app_metadata ?? {}) };
      if (role) meta.role = role;
      else delete meta.role;
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { app_metadata: meta });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "set_password") {
      const password = String(body.password ?? "");
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message ?? "Server error" }, 500);
  }
});
