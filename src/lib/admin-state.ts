import {
  getChecklistRecord,
  getChecklistRecordUpdatedAt,
  listChecklistRecords,
} from "@/lib/checklist-storage";
import { emptyAdminState, type AdminState } from "@/lib/admin-types";

export const ADMIN_STATE_EVENT_ID = 99990001;
const ADMIN_EVENT_NAME = "__admin_state__";
const ADMIN_EVENT_DATE = "2099-12-31";
const ADMIN_EVENT_POC = "Admin State";

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
  };
}

export async function loadChecklistRecords() {
  return listChecklistRecords();
}

export async function loadAdminStateSnapshot() {
  const record = await getChecklistRecord(ADMIN_STATE_EVENT_ID);
  return {
    state: parseAdminState(record?.tasks?.adminState ?? null),
    updatedAt: record?.updatedAt ?? null,
  };
}

export async function loadAdminState() {
  return (await loadAdminStateSnapshot()).state;
}

export async function loadAdminStateVersion() {
  return getChecklistRecordUpdatedAt(ADMIN_STATE_EVENT_ID);
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
