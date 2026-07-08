import type { ChecklistRecord } from "@/lib/checklist-model";
import { callChecklistFunction } from "@/lib/checklist-storage";
import { emptyAdminState, type AdminState } from "@/lib/admin-types";

export const ADMIN_STATE_EVENT_ID = 99990001;
const ADMIN_EVENT_NAME = "__admin_state__";
const ADMIN_EVENT_DATE = "2099-12-31";
const ADMIN_EVENT_POC = "Admin State";

type ChecklistFunctionPayload = {
  records?: ChecklistRecord[];
};

function parseAdminState(value: unknown): AdminState {
  if (!value || typeof value !== "object") {
    return emptyAdminState();
  }

  const candidate = value as Partial<AdminState>;
  return {
    archivedAssetKeys: Array.isArray(candidate.archivedAssetKeys) ? candidate.archivedAssetKeys.filter((item): item is string => typeof item === "string") : [],
    archivedEventIds: Array.isArray(candidate.archivedEventIds) ? candidate.archivedEventIds.map((item) => Number(item)).filter((item) => Number.isFinite(item)) : [],
    overlaysByAsset:
      candidate.overlaysByAsset && typeof candidate.overlaysByAsset === "object"
        ? Object.fromEntries(
            Object.entries(candidate.overlaysByAsset).map(([key, overlays]) => [
              key,
              Array.isArray(overlays) ? overlays : [],
            ]),
          )
        : {},
    baseImageByAsset:
      candidate.baseImageByAsset && typeof candidate.baseImageByAsset === "object"
        ? Object.fromEntries(
            Object.entries(candidate.baseImageByAsset).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"),
          )
        : {},
  };
}

export async function loadChecklistRecords() {
  const payload = (await callChecklistFunction({ method: "GET" })) as ChecklistFunctionPayload;
  return payload.records ?? [];
}

export async function loadAdminState() {
  const records = await loadChecklistRecords();
  const record = records.find((item) => item.eventId === ADMIN_STATE_EVENT_ID);
  return parseAdminState(record?.tasks?.adminState ?? null);
}

export function buildAdminStateRequest(state: AdminState) {
  return {
    action: "save" as const,
    eventId: ADMIN_STATE_EVENT_ID,
    eventName: ADMIN_EVENT_NAME,
    eventDate: ADMIN_EVENT_DATE,
    poc: ADMIN_EVENT_POC,
    checklist: {
      bwa: "admin-state-v1",
      extrasAdded: "",
      remainingDrinkCardBalance: "",
      tasks: {
        adminState: state,
      },
      entertainment: {},
      food: {},
    },
  };
}
