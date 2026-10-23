import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

describe("interval evidence SQL", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      alter default privileges grant all on tables to service_role;`);
    for (const file of ["20260729152402_entertainment_schedule.sql", "20261013181916_final_call_interval_evidence.sql"]) {
      await db.exec(await readFile(path.join(process.cwd(), "supabase/migrations", file), "utf8"));
    }
    await db.exec(`insert into entertainment_event_snapshots
      (event_id, tripleseat_event_id, event_name, operating_date, event_start_at, event_end_at, event_color, color_source, source_snapshot, synced_at)
      values ('span','span','Fictional','2026-10-10','2026-10-10T20:00Z','2026-10-15T01:00Z','#123456','manual','{}',now()),
        ('outside','outside','Fictional','2026-10-01','2026-10-01T20:00Z','2026-10-01T21:00Z','#123456','manual','{}',now()),
        ('unknown','unknown','Fictional','2026-10-13',null,null,'#123456','manual','{}',now()),
        ('invalid','invalid','Fictional','2026-10-01','2026-10-02','2026-10-01','#123456','manual','{}',now());`);
  });
  afterAll(async () => { await db.close(); });
  it("reads spanning and uncertain events in a single snapshot without a start-date filter", async () => {
    const result = await db.query<{ value: { events: { event_id: string }[]; reservations: unknown[] } }>(
      "select final_call_read_entertainment_interval('2026-10-13T03:00Z','2026-10-14T05:00Z') as value",
    );
    expect(result.rows[0].value.events.map((event) => event.event_id)).toEqual(["invalid", "span", "unknown"]);
    expect(result.rows[0].value.reservations).toEqual([]);
  });
  it("denies browser roles while allowing only receipt insert/read for the service", async () => {
    const result = await db.query<{ anon: boolean; authenticated: boolean; insert: boolean; update: boolean }>(`select
      has_function_privilege('anon','final_call_read_entertainment_interval(timestamptz,timestamptz)','execute') as anon,
      has_function_privilege('authenticated','final_call_read_entertainment_interval(timestamptz,timestamptz)','execute') as authenticated,
      has_table_privilege('service_role','entertainment_source_reads','insert') as insert,
      has_table_privilege('service_role','entertainment_source_reads','update') as update`);
    expect(result.rows[0]).toEqual({ anon: false, authenticated: false, insert: true, update: false });
    await db.exec("set role service_role");
    try {
      await db.query("insert into entertainment_source_reads(id,payload) values ('5919b215-741b-4e2a-b5ce-5c95e327c433','{}')");
      await expect(db.query("update entertainment_source_reads set payload='{}'")).rejects.toThrow(/permission denied/);
      await db.query("select final_call_read_entertainment_interval('2026-10-13T03:00Z','2026-10-14T05:00Z')");
    } finally { await db.exec("reset role"); }
  });
  it("rejects oversized and reversed intervals", async () => {
    await expect(db.query("select final_call_read_entertainment_interval('2026-10-13','2026-10-12')")).rejects.toThrow(/Invalid/);
    await expect(db.query("select final_call_read_entertainment_interval('2026-10-13','2026-12-12')")).rejects.toThrow(/Invalid/);
  });
});
