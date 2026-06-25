import { createClient } from "@supabase/supabase-js";

type ChecklistPayload = {
  bwa?: string;
  extrasAdded?: string;
  remainingDrinkCardBalance?: string;
  tasks?: Record<string, boolean>;
  entertainment?: Record<string, { quantity?: string; selectedRateKey?: string; manualPrice?: string }>;
  food?: Record<string, { quantity?: string; manualPrice?: string }>;
};

type ChecklistRequest = {
  action?: "save" | "submit";
  eventId?: number;
  eventName?: string;
  eventDate?: string;
  poc?: string;
  checklist?: ChecklistPayload;
};

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

function getServiceRoleKey() {
  const currentKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (currentKey) {
    return currentKey;
  }

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!secretKeys) {
    throw new Error("Missing Supabase secret key.");
  }

  const parsed = JSON.parse(secretKeys) as Record<string, string>;
  const firstKey = Object.values(parsed)[0];
  if (!firstKey) {
    throw new Error("Missing Supabase secret key.");
  }

  return firstKey;
}

function getClient() {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) {
    throw new Error("Missing SUPABASE_URL.");
  }

  return createClient(url, getServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function toRecord(record: Record<string, unknown>) {
  return {
    eventId: Number(record.event_id),
    bwa: String(record.bwa ?? ""),
    extrasAdded: String(record.extras_added ?? ""),
    remainingDrinkCardBalance: String(record.remaining_drink_card_balance ?? ""),
    tasks: (record.tasks as Record<string, boolean> | null) ?? {},
    entertainment: (record.entertainment as Record<string, unknown> | null) ?? {},
    food: (record.food as Record<string, unknown> | null) ?? {},
    status: String(record.status ?? "draft"),
    updatedAt: record.updated_at ? String(record.updated_at) : null,
    submittedAt: record.submitted_at ? String(record.submitted_at) : null,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    const supabase = getClient();

    if (request.method === "GET") {
      const { data, error } = await supabase
        .from("event_host_checklists")
        .select(
          "event_id, bwa, extras_added, remaining_drink_card_balance, tasks, entertainment, food, status, updated_at, submitted_at",
        )
        .order("event_date", { ascending: true });

      if (error) {
        throw error;
      }

      return json({
        records: (data ?? []).map((record) => toRecord(record as Record<string, unknown>)),
      });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }

    const body = (await request.json()) as ChecklistRequest;
    if (
      (body.action !== "save" && body.action !== "submit") ||
      typeof body.eventId !== "number" ||
      !body.eventName ||
      !body.eventDate ||
      !body.checklist
    ) {
      return json({ error: "Invalid checklist request." }, 400);
    }

    const now = new Date().toISOString();
    const row = {
      event_id: body.eventId,
      event_name: body.eventName,
      event_date: body.eventDate,
      poc: body.poc ?? "",
      bwa: body.checklist.bwa ?? "",
      extras_added: body.checklist.extrasAdded ?? "",
      remaining_drink_card_balance: body.checklist.remainingDrinkCardBalance ?? "",
      tasks: body.checklist.tasks ?? {},
      entertainment: body.checklist.entertainment ?? {},
      food: body.checklist.food ?? {},
      status: body.action === "submit" ? "submitted" : "draft",
      submitted_at: body.action === "submit" ? now : null,
      updated_at: now,
    };

    const { data, error } = await supabase
      .from("event_host_checklists")
      .upsert(row, {
        onConflict: "event_id",
      })
      .select(
        "event_id, bwa, extras_added, remaining_drink_card_balance, tasks, entertainment, food, status, updated_at, submitted_at",
      )
      .single();

    if (error) {
      throw error;
    }

    return json({
      record: toRecord(data as Record<string, unknown>),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected checklist function error.";
    return json({ error: message }, 500);
  }
});
