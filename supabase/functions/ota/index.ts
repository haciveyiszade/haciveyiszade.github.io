import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-ota-admin-key, x-device-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const sha256 = async (value: string | ArrayBuffer) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const action = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) ?? "";

  const authorize = async (kind: "admin" | "device", header: string) => {
    const supplied = request.headers.get(header);
    if (!supplied) return false;
    const { data } = await supabase
      .from("ota_secrets")
      .select("secret_hash")
      .eq("key", kind)
      .maybeSingle();
    return Boolean(data?.secret_hash && (await sha256(supplied)) === data.secret_hash);
  };

  try {
    if (action === "upload" && request.method === "POST") {
      if (!(await authorize("admin", "x-ota-admin-key"))) {
        return json({ error: "Yetkisiz OTA yüklemesi." }, 401);
      }

      const form = await request.formData();
      const file = form.get("firmware");
      const version = String(form.get("version") ?? "").trim();
      const notes = String(form.get("notes") ?? "").trim().slice(0, 1000);

      if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".bin")) {
        return json({ error: "ESP32 .bin firmware dosyası seçin." }, 400);
      }
      if (!/^\d+\.\d+\.\d+$/.test(version)) {
        return json({ error: "Sürüm 1.0.0 biçiminde olmalıdır." }, 400);
      }
      if (file.size < 1024 || file.size > 8 * 1024 * 1024) {
        return json({ error: "Firmware boyutu 1 KB–8 MB arasında olmalıdır." }, 400);
      }

      const bytes = await file.arrayBuffer();
      const digest = await sha256(bytes);
      const path = `releases/${version}-${crypto.randomUUID()}.bin`;
      const { error: uploadError } = await supabase.storage
        .from("firmware")
        .upload(path, bytes, { contentType: "application/octet-stream", upsert: false });
      if (uploadError) return json({ error: uploadError.message }, 400);

      const { data: release, error: insertError } = await supabase
        .from("ota_releases")
        .insert({
          version,
          file_path: path,
          file_size: file.size,
          sha256: digest,
          notes,
        })
        .select()
        .single();
      if (insertError) {
        await supabase.storage.from("firmware").remove([path]);
        return json({
          error: insertError.code === "23505"
            ? "Bu sürüm daha önce yüklenmiş."
            : insertError.message,
        }, 400);
      }

      await supabase
        .from("ota_releases")
        .update({ active: false, activated_at: null })
        .eq("active", true);
      const activatedAt = new Date().toISOString();
      const { error: activateError } = await supabase
        .from("ota_releases")
        .update({ active: true, activated_at: activatedAt })
        .eq("id", release.id);
      if (activateError) return json({ error: activateError.message }, 500);
      await supabase
        .from("ota_devices")
        .update({
          target_version: version,
          status: "idle",
          last_error: null,
          updated_at: activatedAt,
        })
        .eq("id", "door-controller");
      return json({
        success: true,
        release: { ...release, active: true, activated_at: activatedAt },
      });
    }

    if (action === "status" && request.method === "GET") {
      if (!(await authorize("admin", "x-ota-admin-key"))) {
        return json({ error: "Yetkisiz." }, 401);
      }
      const [{ data: releases, error: releasesError }, {
        data: device,
        error: deviceError,
      }] = await Promise.all([
        supabase
          .from("ota_releases")
          .select("id,version,file_size,sha256,notes,active,created_at,activated_at")
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("ota_devices")
          .select("*")
          .eq("id", "door-controller")
          .maybeSingle(),
      ]);
      if (releasesError || deviceError) {
        return json({ error: releasesError?.message ?? deviceError?.message }, 500);
      }
      return json({ releases, device });
    }

    if (action === "manifest" && request.method === "GET") {
      if (!(await authorize("device", "x-device-token"))) {
        return json({ error: "Yetkisiz cihaz." }, 401);
      }
      const currentVersion =
        new URL(request.url).searchParams.get("version") ?? "unknown";
      const now = new Date().toISOString();
      await supabase
        .from("ota_devices")
        .update({
          current_version: currentVersion,
          last_seen: now,
          status: "idle",
          updated_at: now,
        })
        .eq("id", "door-controller");

      const { data: release, error } = await supabase
        .from("ota_releases")
        .select("id,version,file_path,file_size,sha256")
        .eq("active", true)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!release || release.version === currentVersion) {
        return json({ update: false });
      }

      const { data: signed, error: signedError } = await supabase.storage
        .from("firmware")
        .createSignedUrl(release.file_path, 600);
      if (signedError || !signed) {
        return json({
          error: signedError?.message ?? "İndirme bağlantısı oluşturulamadı.",
        }, 500);
      }
      return json({
        update: true,
        version: release.version,
        size: release.file_size,
        sha256: release.sha256,
        url: signed.signedUrl,
      });
    }

    if (action === "report" && request.method === "POST") {
      if (!(await authorize("device", "x-device-token"))) {
        return json({ error: "Yetkisiz cihaz." }, 401);
      }
      const body = await request.json();
      const allowed = ["idle", "downloading", "installing", "success", "failed"];
      const status = allowed.includes(body.status) ? body.status : "failed";
      const now = new Date().toISOString();
      await supabase
        .from("ota_devices")
        .update({
          status,
          current_version: typeof body.version === "string"
            ? body.version
            : undefined,
          last_error: status === "failed"
            ? String(body.error ?? "Bilinmeyen OTA hatası").slice(0, 500)
            : null,
          last_seen: now,
          updated_at: now,
        })
        .eq("id", "door-controller");
      return json({ success: true });
    }

    return json({ error: "Bulunamadı." }, 404);
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Beklenmeyen hata",
    }, 500);
  }
});
