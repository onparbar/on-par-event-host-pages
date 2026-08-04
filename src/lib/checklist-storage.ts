import type { ChecklistRecord } from "@/lib/checklist-model";

const DEFAULT_SUPABASE_URL = "https://tmnstuthbllnoqgepotn.supabase.co";
const CHECKLIST_COLUMNS =
  "event_id,bwa,extras_added,remaining_drink_card_balance,tasks,entertainment,food,status,updated_at,submitted_at";

type ChecklistPayload = {
  bwa?: string;
  extrasAdded?: string;
  remainingDrinkCardBalance?: string;
  tasks?: Record<string, unknown>;
  entertainment?: Record<string, unknown>;
  food?: Record<string, unknown>;
};

export type SaveChecklistInput = {
  action: "save" | "submit";
  eventId: number;
  eventName: string;
  eventDate: string;
  poc?: string;
  checklist: ChecklistPayload;
};

type DatabaseRecord = {
  event_id: number | string;
  event_date?: string | null;
  bwa?: string | null;
  extras_added?: string | null;
  remaining_drink_card_balance?: string | null;
  tasks?: Record<string, unknown> | null;
  entertainment?: Record<string, unknown> | null;
  food?: Record<string, unknown> | null;
  status?: string | null;
  updated_at?: string | null;
  submitted_at?: string | null;
};

const memoryRecords = new Map<number, DatabaseRecord>();

function configuredSupabaseSecret() {
  const directSecret = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (directSecret) {
    return directSecret;
  }

  const secretKeys = process.env.SUPABASE_SECRET_KEYS?.trim();
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, string>;
      const secret = Object.values(parsed).find(Boolean);
      if (secret) {
        return secret;
      }
    } catch {
      // The Vercel variable must contain the JSON object supplied by Supabase.
    }
  }

  return null;
}

function getSupabaseSecret() {
  const secret = configuredSupabaseSecret();
  if (secret) {
    return secret;
  }

  throw new Error("Missing SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in Vercel.");
}

function useLocalMemoryStorage() {
  return process.env.NODE_ENV !== "production" && !configuredSupabaseSecret();
}

function cloneRecord(record: DatabaseRecord) {
  return structuredClone(record);
}

function getDatabaseUrl(query = "") {
  const baseUrl = process.env.SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL;
  return `${baseUrl}/rest/v1/event_host_checklists${query}`;
}

function isJwt(value: string) {
  return /^eyJ[^.]*\.[^.]+\.[^.]+$/.test(value);
}

async function databaseRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const secret = getSupabaseSecret();
  const headers = new Headers(init?.headers);
  headers.set("apikey", secret);
  headers.set("content-type", "application/json");
  if (isJwt(secret)) {
    headers.set("authorization", `Bearer ${secret}`);
  } else {
    headers.delete("authorization");
  }

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Checklist database request failed.");
  }

  return response.json() as Promise<T>;
}

function toChecklistRecord(record: DatabaseRecord): ChecklistRecord {
  return {
    eventId: Number(record.event_id),
    bwa: record.bwa ?? "",
    extrasAdded: record.extras_added ?? "",
    remainingDrinkCardBalance: record.remaining_drink_card_balance ?? "",
    tasks: (record.tasks ?? {}) as ChecklistRecord["tasks"],
    entertainment: (record.entertainment ?? {}) as ChecklistRecord["entertainment"],
    food: (record.food ?? {}) as ChecklistRecord["food"],
    status: record.status === "submitted" ? "submitted" : "draft",
    updatedAt: record.updated_at ?? null,
    submittedAt: record.submitted_at ?? null,
  };
}

export async function listChecklistRecords() {
  if (useLocalMemoryStorage()) {
    return [...memoryRecords.values()]
      .sort((left, right) =>
        (left.event_date ?? "").localeCompare(right.event_date ?? ""),
      )
      .map((record) => toChecklistRecord(cloneRecord(record)));
  }
  const records = await databaseRequest<DatabaseRecord[]>(
    getDatabaseUrl(`?select=${CHECKLIST_COLUMNS}&order=event_date.asc`),
  );
  return records.map(toChecklistRecord);
}

export async function getChecklistRecord(eventId: number) {
  if (useLocalMemoryStorage()) {
    const record = memoryRecords.get(eventId);
    return record ? toChecklistRecord(cloneRecord(record)) : null;
  }
  const records = await databaseRequest<DatabaseRecord[]>(
    getDatabaseUrl(
      `?event_id=eq.${encodeURIComponent(String(eventId))}&select=${CHECKLIST_COLUMNS}&limit=1`,
    ),
  );
  return records[0] ? toChecklistRecord(records[0]) : null;
}

export async function getChecklistRecordUpdatedAt(eventId: number) {
  if (useLocalMemoryStorage()) {
    return memoryRecords.get(eventId)?.updated_at ?? null;
  }
  const records = await databaseRequest<
    Pick<DatabaseRecord, "updated_at">[]
  >(
    getDatabaseUrl(
      `?event_id=eq.${encodeURIComponent(String(eventId))}&select=updated_at&limit=1`,
    ),
  );
  return records[0]?.updated_at ?? null;
}

export async function saveChecklist(input: SaveChecklistInput) {
  const now = new Date().toISOString();
  const row = {
    event_id: input.eventId,
    event_name: input.eventName,
    event_date: input.eventDate,
    poc: input.poc ?? "",
    bwa: input.checklist.bwa ?? "",
    extras_added: input.checklist.extrasAdded ?? "",
    remaining_drink_card_balance: input.checklist.remainingDrinkCardBalance ?? "",
    tasks: input.checklist.tasks ?? {},
    entertainment: input.checklist.entertainment ?? {},
    food: input.checklist.food ?? {},
    status: input.action === "submit" ? "submitted" : "draft",
    submitted_at: input.action === "submit" ? now : null,
    updated_at: now,
  };

  if (useLocalMemoryStorage()) {
    memoryRecords.set(input.eventId, cloneRecord(row));
    return toChecklistRecord(cloneRecord(row));
  }

  const records = await databaseRequest<DatabaseRecord[]>(
    getDatabaseUrl(`?on_conflict=event_id&select=${CHECKLIST_COLUMNS}`),
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    },
  );

  if (!records[0]) {
    throw new Error("Checklist database did not return the saved record.");
  }

  return toChecklistRecord(records[0]);
}

export function resetLocalChecklistStorageForTests() {
  memoryRecords.clear();
}
