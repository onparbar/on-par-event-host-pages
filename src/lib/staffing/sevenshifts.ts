import "server-only";
import { addCalendarDays, zonedDateTimeToIso } from "@/lib/entertainment/time";
import { staffingInstant, type CorporateStaffShift, type staffingWindow } from "./domain";

const SHIFT_API = "https://api.7shifts.com/v2/company/";
const VERSION = "2026-01-01";
const PAGE_LIMIT = 20;

export class StaffingSourceError extends Error {
  constructor(readonly reason: "unconfigured" | "unavailable" | "incomplete" | "rate-limited") {
    super(`Published 7shifts schedule is ${reason}.`);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function id(value: unknown) {
  const normalized = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  return /^[1-9]\d{0,15}$/.test(normalized) ? normalized : null;
}

function configuration(env: NodeJS.ProcessEnv) {
  const token = env.SEVENSHIFTS_ACCESS_TOKEN?.trim();
  const company = id(env.SEVENSHIFTS_COMPANY_ID);
  const location = id(env.SEVENSHIFTS_LOCATION_ID);
  const markers = ([
    ["role_id", env.SEVENSHIFTS_CORPORATE_ROLE_ID],
    ["department_id", env.SEVENSHIFTS_CORPORATE_DEPARTMENT_ID],
    ["station_id", env.SEVENSHIFTS_CORPORATE_STATION_ID],
  ] as const).filter(([, value]) => value?.trim());
  if (!token || !company || !location || markers.length !== 1 || !id(markers[0][1])) throw new StaffingSourceError("unconfigured");
  return { token, company, location, marker: { field: markers[0][0], id: id(markers[0][1])! } };
}

/** Full published schedule only; provisional changes must not erase the last confirmed assignments. */
export async function readPublishedCorporateShifts(window: ReturnType<typeof staffingWindow>, options: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
} = {}): Promise<CorporateStaffShift[]> {
  const config = configuration(options.env ?? process.env);
  const request = options.fetchImpl ?? fetch;
  const deadline = AbortSignal.timeout(20_000);
  async function get(path: string, params?: URLSearchParams) {
    const url = new URL(`${config.company}/${path}`, SHIFT_API);
    if (params) url.search = params.toString();
    let response: Response;
    try {
      response = await request(url, { method: "GET", redirect: "error", cache: "no-store", signal: deadline,
        headers: { Authorization: `Bearer ${config.token}`, "x-api-version": VERSION, Accept: "application/json" } });
    } catch { throw new StaffingSourceError("unavailable"); }
    // The next scheduled run retries; never retry unbounded or interpret a throttle as an empty schedule.
    if (response.status === 429) throw new StaffingSourceError("rate-limited");
    if (!response.ok) throw new StaffingSourceError("unavailable");
    const body = record(await response.json().catch(() => null));
    if (!body) throw new StaffingSourceError("incomplete");
    return body;
  }
  const first = zonedDateTimeToIso(window.shiftStartDate, 0, 0);
  const after = zonedDateTimeToIso(addCalendarDays(window.endDate, 1), 0, 0);
  const last = new Date(Date.parse(after) - 1).toISOString();
  const params = new URLSearchParams({ location_id: config.location, limit: "250", "start[gte]": first, "start[lte]": last });
  const selected: Omit<CorporateStaffShift, "employeeName">[] = [];
  const seenShiftIds = new Set<string>();
  const seenCursors = new Set<string>();
  for (let page = 0; page < PAGE_LIMIT; page++) {
    const body = await get("shifts", params);
    const cursor = record(record(body.meta)?.cursor);
    if (!Array.isArray(body.data) || !cursor || (cursor.next !== null && (typeof cursor.next !== "string" || !cursor.next || cursor.next.length > 2_000))) {
      throw new StaffingSourceError("incomplete");
    }
    for (const value of body.data) {
      const row = record(value);
      const shiftId = id(row?.id);
      if (!row || !shiftId || !id(row.company_id) || !id(row.location_id) || seenShiftIds.has(shiftId)) throw new StaffingSourceError("incomplete");
      seenShiftIds.add(shiftId);
      if (id(row.company_id) !== config.company || id(row.location_id) !== config.location) continue;
      if (row.draft === true && row.publish_status === "published") throw new StaffingSourceError("incomplete");
      if (!Object.hasOwn(row, config.marker.field)) throw new StaffingSourceError("incomplete");
      if (id(row[config.marker.field]) !== config.marker.id) continue;
      if (row.deleted === true || row.open === true || row.unassigned === true) continue;
      const employeeId = id(row.user_id);
      if (row.publish_status !== "published" || row.draft !== false || row.deleted !== false || row.open !== false || row.unassigned !== false ||
          !employeeId || typeof row.start !== "string" || typeof row.end !== "string" || row.soft_deleted ||
          (row.notes != null && (typeof row.notes !== "string" || row.notes.length > 2_000))) throw new StaffingSourceError("incomplete");
      const startTime = staffingInstant(row.start);
      const endTime = staffingInstant(row.end);
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) throw new StaffingSourceError("incomplete");
      if (startTime < Date.parse(first) || startTime >= Date.parse(after)) continue;
      selected.push({ shiftId, employeeId, startAt: row.start, endAt: row.end, ...(typeof row.notes === "string" && row.notes.length <= 2_000 ? { notes: row.notes } : {}) });
    }
    if (cursor.next === null) break;
    if (seenCursors.has(cursor.next as string) || page + 1 === PAGE_LIMIT) throw new StaffingSourceError("incomplete");
    seenCursors.add(cursor.next as string);
    params.set("cursor", cursor.next as string);
  }
  const names = new Map<string, string>();
  const employees = [...new Set(selected.map((shift) => shift.employeeId))];
  for (let index = 0; index < employees.length; index += 4) {
    await Promise.all(employees.slice(index, index + 4).map(async (employeeId) => {
      const user = record((await get(`users/${employeeId}`, new URLSearchParams({ include_inactive: "true" }))).data);
      if (!user || id(user.id) !== employeeId || id(user.company_id) !== config.company || typeof user.active !== "boolean") throw new StaffingSourceError("incomplete");
      if (!user.active) return;
      const part = (value: unknown) => typeof value === "string" && value.length <= 160 ? value.trim() : "";
      const firstName = part(user.preferred_first_name) || part(user.first_name);
      const lastName = part(user.preferred_last_name) || part(user.last_name);
      const name = [firstName, lastName].filter(Boolean).join(" ");
      if (!name) throw new StaffingSourceError("incomplete");
      names.set(employeeId, name);
    }));
  }
  return selected.flatMap((shift) => names.has(shift.employeeId) ? [{ ...shift, employeeName: names.get(shift.employeeId)! }] : []);
}
