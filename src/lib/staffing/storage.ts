import "server-only";
import { StaleSaveError } from "@/lib/stale-save";
import type { CorporateStaffShift, StaffingEvent, StaffingEventDate, StaffingMatchPolicy, StaffingReconciliation, StaffingSuppression } from "./domain";
import { staffingPrivateRequest } from "./security";

export type StaffingState = {
  version: number;
  reconciliation: StaffingReconciliation | null;
  events: StaffingEvent[];
  shifts: CorporateStaffShift[];
  dailyScheduleComplete?: boolean;
  keepClearEventIds: string[];
  manualTeams?: StaffingEventDate[];
  suppressedAssignments?: StaffingSuppression[];
  policy: StaffingMatchPolicy;
  lastAttemptAt: string | null;
  failure: "events" | "shifts" | "incomplete" | null;
};

const TABLE = "event_host_standalone_staffing_state";
const ROW = "corporate-parties";

export function emptyStaffingState(): StaffingState {
  return { version: 0, reconciliation: null, events: [], shifts: [], keepClearEventIds: [],
    policy: { earlyStartMinutes: 60, allowIntermediateStarts: false }, lastAttemptAt: null, failure: null };
}

export async function loadStaffingState(): Promise<StaffingState> {
  const response = await staffingPrivateRequest(`${TABLE}?id=eq.${ROW}&select=version,document&limit=1`);
  if (!response.ok) throw new Error("Staffing storage is unavailable.");
  const [row] = await response.json() as { version: number; document: Omit<StaffingState, "version"> }[];
  return row ? { ...row.document, version: row.version } : emptyStaffingState();
}

/** A sync and an admin edit cannot overwrite each other's reviewed snapshot. */
export async function saveStaffingState(next: StaffingState, expectedVersion: number): Promise<StaffingState> {
  if (next.version !== expectedVersion) throw new StaleSaveError();
  const { version, ...document } = next;
  const entry = { version: version + 1, document };
  const response = await staffingPrivateRequest(expectedVersion ? `${TABLE}?id=eq.${ROW}&version=eq.${version}` : TABLE, {
    method: expectedVersion ? "PATCH" : "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(expectedVersion ? entry : { id: ROW, ...entry }),
  });
  if (response.status === 409) throw new StaleSaveError();
  if (!response.ok) throw new Error("Staffing storage is unavailable.");
  const [row] = await response.json() as typeof entry[];
  if (!row) throw new StaleSaveError();
  return { ...row.document, version: row.version };
}
