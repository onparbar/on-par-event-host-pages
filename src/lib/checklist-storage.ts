import { CHECKLIST_CLOSEOUT_CONFIRMATION_KEY, checklistSections, normalizeStaffPoc, type ChecklistRecord } from "@/lib/checklist-model";
import { StaleSaveError } from "@/lib/stale-save";
import { AUTO_SUBMISSION_KEY, isAutomaticSubmission, readAutomaticSubmission, type AutomaticChecklistSubmission } from "@/lib/operations/checklist-auto-submission";
import { operationalKitchenEventId } from "@/lib/vip-prep/identity";

const DEFAULT_SUPABASE_URL = "https://tmnstuthbllnoqgepotn.supabase.co";
const CHECKLIST_COLUMNS =
  "event_id,event_name,event_date,poc,bwa,extras_added,remaining_drink_card_balance,tasks,task_evidence,entertainment,food,status,updated_at,submitted_at";

type ChecklistPayload = {
  bwa?: string;
  poc?: string;
  extrasAdded?: string;
  remainingDrinkCardBalance?: string;
  tasks?: Record<string, unknown>;
  taskEvidence?: ChecklistRecord["taskEvidence"];
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
  expectedUpdatedAt: string | null;
  allowReopen?: boolean;
  /** Trusted server job only; incoming checklist fields cannot forge this receipt. */
  autoSubmission?: AutomaticChecklistSubmission;
};

type DatabaseRecord = {
  event_id: number | string;
  event_name?: string | null;
  event_date?: string | null;
  poc?: string | null;
  bwa?: string | null;
  extras_added?: string | null;
  remaining_drink_card_balance?: string | null;
  tasks?: Record<string, unknown> | null;
  task_evidence?: ChecklistRecord["taskEvidence"] | null;
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
    const error = await response.json().catch(() => null) as { code?: string } | null;
    if (response.status === 409 || error?.code === "PT409") throw new StaleSaveError();
    if (response.status === 404 || error?.code === "PGRST202" || error?.code === "42703") {
      throw new Error("Checklist safety migration is not installed. No changes were saved; ask an administrator to finish the reviewed database update.");
    }
    throw new Error(`Checklist database request failed (${response.status}).`);
  }

  return response.json() as Promise<T>;
}

function toChecklistRecord(record: DatabaseRecord): ChecklistRecord {
  return {
    eventId: Number(record.event_id),
    eventName: record.event_name ?? "",
    eventDate: record.event_date ?? "",
    poc: normalizeStaffPoc(record.poc),
    bwa: record.bwa ?? "",
    extrasAdded: record.extras_added ?? "",
    remainingDrinkCardBalance: record.remaining_drink_card_balance ?? "",
    tasks: (record.tasks ?? {}) as ChecklistRecord["tasks"],
    taskEvidence: record.task_evidence ?? {},
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
  if (input.autoSubmission && (input.action !== "submit" || !isAutomaticSubmission(input.autoSubmission) || operationalKitchenEventId(input.autoSubmission.sourceEventId) !== String(input.eventId))) {
    throw new Error("Invalid automatic checklist submission evidence.");
  }
  if (input.expectedUpdatedAt !== null && (typeof input.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(input.expectedUpdatedAt)))) {
    throw new Error("Load the saved checklist revision before saving.");
  }
  const previous = useLocalMemoryStorage()
    ? memoryRecords.get(input.eventId)
    : input.expectedUpdatedAt === null ? undefined : await getChecklistRecord(input.eventId).then((record) => record ? {
      updated_at: record.updatedAt, poc: record.poc, tasks: record.tasks, task_evidence: record.taskEvidence, status: record.status,
    } : undefined);
  const taskKeys = new Set(checklistSections.flatMap((section) => section.items.map((item) => item.key)));
  const preservePrevious = (key: string) => !taskKeys.has(key) && (input.action !== "submit" || key !== CHECKLIST_CLOSEOUT_CONFIRMATION_KEY);
  const acceptIncoming = (key: string) => key !== AUTO_SUBMISSION_KEY && (input.action === "submit" || key !== CHECKLIST_CLOSEOUT_CONFIRMATION_KEY);
  const previousUnknownTasks = Object.fromEntries(Object.entries(previous?.tasks ?? {}).filter(([key]) => preservePrevious(key)));
  const previousUnknownEvidence = Object.fromEntries(Object.entries(previous?.task_evidence ?? {}).filter(([key]) => preservePrevious(key)));
  const suppliedPoc = input.checklist.poc ?? input.poc;
  const incomingPoc = typeof suppliedPoc === "string" ? suppliedPoc.trim() && !normalizeStaffPoc(suppliedPoc) ? undefined : suppliedPoc : undefined;
  const now = new Date(Math.max(Date.now(), Date.parse(previous?.updated_at ?? "") + 1 || 0)).toISOString();
  const row = {
    event_id: input.eventId,
    event_name: input.eventName,
    event_date: input.eventDate,
    poc: normalizeStaffPoc(incomingPoc === undefined ? previous?.poc : incomingPoc),
    bwa: input.checklist.bwa ?? "",
    extras_added: input.checklist.extrasAdded ?? "",
    remaining_drink_card_balance: input.checklist.remainingDrinkCardBalance ?? "",
    tasks: { ...previousUnknownTasks, ...Object.fromEntries(Object.entries(input.checklist.tasks ?? {}).filter(([key]) => acceptIncoming(key))) },
    task_evidence: { ...previousUnknownEvidence, ...Object.fromEntries(Object.entries(input.checklist.taskEvidence ?? {}).filter(([key]) => acceptIncoming(key))) },
    entertainment: input.checklist.entertainment ?? {},
    food: input.checklist.food ?? {},
    status: input.action === "submit" ? "submitted" : "draft",
    submitted_at: input.action === "submit" ? now : null,
    updated_at: now,
  };

  const previousAuto = readAutomaticSubmission({ taskEvidence: previous?.task_evidence ?? undefined });
  if (input.autoSubmission) {
    if (previousAuto || Object.hasOwn(previous?.tasks ?? {}, AUTO_SUBMISSION_KEY)) throw new StaleSaveError("This event was already automatically submitted or reopened by Admin. Admin reopening must be preserved.");
    row.tasks[AUTO_SUBMISSION_KEY] = true;
    row.task_evidence[AUTO_SUBMISSION_KEY] = {
      employeeName: "Event Host automation (system)", completedAt: input.autoSubmission.submittedAt,
      automaticSubmission: structuredClone(input.autoSubmission),
    };
  } else if (input.allowReopen || previousAuto && input.action === "submit") {
    row.tasks[AUTO_SUBMISSION_KEY] = false;
  }

  if (useLocalMemoryStorage()) {
    if ((previous?.updated_at ?? null) !== input.expectedUpdatedAt) throw new StaleSaveError();
    if (previous?.status === "submitted" && !input.allowReopen) throw new StaleSaveError("This checklist was submitted. Only Admin can reopen it; your draft has been kept.");
    memoryRecords.set(input.eventId, cloneRecord(row));
    return toChecklistRecord(cloneRecord(row));
  }

  const record = await databaseRequest<DatabaseRecord>(
    getDatabaseUrl().replace(/\/event_host_checklists$/, "/rpc/save_event_host_checklist_checked"),
    {
      method: "POST",
      body: JSON.stringify({ p_record: row, p_expected_updated_at: input.expectedUpdatedAt, p_allow_reopen: input.allowReopen === true }),
    },
  );

  if (!record) {
    throw new Error("Checklist database did not return the saved record.");
  }

  return toChecklistRecord(record);
}

export function resetLocalChecklistStorageForTests() {
  memoryRecords.clear();
}
