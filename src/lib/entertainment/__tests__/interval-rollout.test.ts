import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("interval migration operator checks", () => {
  let db: PGlite;
  const read = (file: string) => readFile(`${process.cwd()}/${file}`, "utf8");
  const migrate = async () => db.exec(await read("supabase/migrations/20261013181916_final_call_interval_evidence.sql"));
  const report = async (name: string) => {
    const results = await db.exec(await read(`scripts/sql/final-call-interval-${name}.sql`));
    return results.flatMap((result) => result.rows) as { check_name: string; result: string }[];
  };
  beforeEach(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    await db.exec(await read("supabase/migrations/20260729152402_entertainment_schedule.sql"));
  });
  afterEach(async () => db.close());

  it("passes the prepared schema, installed permissions and real service read", async () => {
    expect((await report("preflight")).every((row) => row.result === "PASS")).toBe(true);
    await migrate();
    expect((await report("verify")).every((row) => row.result === "PASS")).toBe(true);
    expect(await report("smoke")).toEqual([
      { check_name: "service_interval_read", result: "PASS" },
    ]);
    expect((await db.query("select count(*)::int as count from entertainment_source_reads")).rows).toEqual([{ count: 0 }]);
  });

  it("stops on a missing prerequisite and on a previously installed migration", async () => {
    await db.exec("alter table entertainment_reservations rename column start_at to missing_start_at");
    expect(await report("preflight")).toContainEqual({ check_name: "required_columns", result: "STOP" });
    await db.exec("alter table entertainment_reservations rename column missing_start_at to start_at");
    await migrate();
    expect(await report("preflight")).toContainEqual({ check_name: "source_migration_objects_absent", result: "STOP" });
  });

  it("reports a missing migration without treating null privilege checks as success", async () => {
    const rows = await report("verify");
    expect(rows.length).toBe(7);
    expect(rows.every((row) => row.result === "STOP")).toBe(true);
  });

  it("detects browser exposure, mutable receipts, and a privileged function", async () => {
    await migrate();
    await db.exec(`grant select(payload) on entertainment_source_reads to anon;
      grant update(payload) on entertainment_source_reads to service_role;
      grant execute on function final_call_read_entertainment_interval(timestamptz,timestamptz) to public;
      alter function final_call_read_entertainment_interval(timestamptz,timestamptz) security definer;
      alter table entertainment_source_reads disable row level security;`);
    const rows = await report("verify");
    for (const name of ["receipt_table_and_rls", "service_receipts_append_only", "browser_receipts_denied", "rpc_invoker_stable_jsonb", "browser_rpc_denied"]) {
      expect(rows).toContainEqual({ check_name: name, result: "STOP" });
    }
  });

  it("fails the service smoke read when existing schedule access is missing", async () => {
    await migrate();
    await db.exec("revoke select on entertainment_event_snapshots from service_role");
    expect(await report("preflight")).toContainEqual({ check_name: "service_can_read_existing_schedule", result: "STOP" });
    await expect(report("smoke")).rejects.toThrow(/permission denied/);
  });

  it("rejects an RPC that runs but returns an invalid result shape", async () => {
    await migrate();
    await db.exec(`create or replace function final_call_read_entertainment_interval(p_start timestamptz, p_end timestamptz)
      returns jsonb language sql stable security invoker as 'select null::jsonb'`);
    await expect(report("smoke")).rejects.toThrow(/STOP: service interval response has an invalid shape/);
  });
});
