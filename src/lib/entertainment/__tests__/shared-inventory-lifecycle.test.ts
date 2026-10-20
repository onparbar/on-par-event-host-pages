import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("shared inventory lifecycle transactions", () => {
  let db: PGlite;
  const group = {
    group: "bowling", resourceIds: ["bowling-3", "bowling-4"],
    startsAt: "2026-10-21T20:00:00Z", endsAt: "2026-10-21T21:00:00Z",
  };
  const identity = {
    ownerReference: "fictional-event-1", eventId: "event-1", kind: "event",
    approvalReference: "staff-decision-1", expectedRevision: 0,
    sourceRevisions: { "event-host": "r1", rexreplace: "r1", waitlist: "r1" },
  };
  const request = (overrides: Record<string, unknown> = {}): Record<string, any> => ({
    ...identity, action: "replace", claims: [group], replaceClaimIds: [], ...overrides,
  });
  async function rpc(name: string, key: string, data: unknown, writer = "final-call") {
    return (await db.query<{ result: any }>(
      `select public.shared_inventory_${name}($1,$2,$3::jsonb) as result`,
      [writer, key, JSON.stringify(data)],
    )).rows[0].result;
  }
  const mutate = (key: string, data = request(), writer?: string) => rpc("mutate", key, data, writer);
  const active = async () => (await db.query("select id, resource_ids from shared_inventory.claims where active order by id")).rows;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; alter default privileges grant all on tables to service_role;");
    for (const name of [
      "20260729152402_entertainment_schedule.sql",
      "20261013182233_shared_reservation_authority.sql",
      "20261020175405_shared_reservation_lifecycle.sql",
    ]) await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    expect((await db.query("select enabled, baseline_ready from shared_inventory.control")).rows)
      .toEqual([{ enabled: false, baseline_ready: false }]);
    expect((await db.query("select * from shared_inventory.writers where enabled")).rows).toHaveLength(0);
  });
  afterAll(async () => db.close());
  beforeEach(async () => {
    await db.exec(`truncate shared_inventory.operations,shared_inventory.claims;
      update shared_inventory.control set enabled=true,baseline_ready=true,revision=0;
      update shared_inventory.writers set enabled=true;
      insert into shared_inventory.checkpoints values
        ('event-host','r1',true,clock_timestamp(),'2026-10-01','2026-11-01'),
        ('rexreplace','r1',true,clock_timestamp(),'2026-10-01','2026-11-01'),
        ('waitlist','r1',true,clock_timestamp(),'2026-10-01','2026-11-01')
      on conflict(source) do update set checked_at=excluded.checked_at,complete=true,revision='r1';`);
  });
  it("commits several groups atomically and returns the same immutable receipt on retry", async () => {
    const data = request({ claims: [group, { ...group, group: "darts", resourceIds: ["darts-2"] }] });
    const result = await mutate("two-group-event", data);
    expect(result).toMatchObject({ status: "applied", action: "replace", revision: 2, releasedClaimIds: [] });
    expect(result.claims.map((c: any) => c.resourceIds)).toEqual([["bowling-3", "bowling-4"], ["darts-2"]]);
    expect(await mutate("two-group-event", data)).toEqual(result);
    expect(await rpc("operation", "two-group-event", data)).toEqual(result);
    expect(await active()).toHaveLength(2);
    await expect(mutate("two-group-event", request())).rejects.toThrow(/idempotency/);
  });
  it("rolls back old releases and every new group if a later group conflicts", async () => {
    const old = await mutate("original-event");
    await mutate("another-owner", request({
      ownerReference: "another", eventId: "another", expectedRevision: 1,
      claims: [{ ...group, group: "darts", resourceIds: ["darts-2"] }],
    }));
    const before = await active();
    const data = request({
      expectedRevision: 2, replaceClaimIds: [old.claims[0].claimId],
      claims: [{ ...group, resourceIds: ["bowling-7"] }, { ...group, group: "darts", resourceIds: ["darts-2"] }],
    });
    expect(await mutate("atomic-failure", data)).toMatchObject({ status: "conflict" });
    expect(await active()).toEqual(before);
    expect((await db.query<{ revision: number }>("select revision from shared_inventory.control")).rows[0].revision).toBe(2);
    expect(await rpc("operation", "original-event", request())).toEqual(old);
    expect((await db.query<{ n: number }>("select count(*)::int n from shared_inventory.operations")).rows[0].n).toBe(5);
  });
  it("rolls back all changes when a later group is invalid or duplicates capacity", async () => {
    for (const resourceIds of [["not-a-resource"], ["bowling-3"]]) {
      await expect(mutate("invalid-batch", request({ claims: [group, { ...group, resourceIds }] }))).rejects.toThrow();
      expect(await active()).toHaveLength(0);
      expect((await db.query("select * from shared_inventory.operations")).rows).toHaveLength(0);
    }
  });
  it("releases only the exact owned claims after a verified cancellation", async () => {
    const old = await mutate("owned-original");
    const data = request({
      action: "release", claims: [], replaceClaimIds: [old.claims[0].claimId],
      expectedRevision: 1, confirmationReference: "verified-source-cancellation-1",
    });
    await expect(mutate("foreign-release", data, "waitlist")).rejects.toThrow(/ownership/);
    await expect(mutate("foreign-owner", { ...data, ownerReference: "another" })).rejects.toThrow(/ownership/);
    await expect(mutate("wrong-event-id", { ...data, eventId: "another" })).rejects.toThrow(/ownership/);
    await expect(mutate("missing-confirmation", { ...data, confirmationReference: "" })).rejects.toThrow(/shape/);
    await db.exec("update shared_inventory.checkpoints set complete=false");
    const released = await mutate("owned-release", data);
    expect(released).toMatchObject({ status: "applied", action: "release", revision: 2, claims: [] });
    expect(await active()).toHaveLength(0);
    expect(await mutate("owned-release", data)).toEqual(released);
    expect(await rpc("operation", "owned-original", request())).toMatchObject({ status: "unknown", reason: "claim_no_longer_active" });
    await expect(mutate("release-again", { ...data, expectedRevision: 2 })).rejects.toThrow(/ownership/);
  });
  it("converts a live owned checkout hold without a capacity gap", async () => {
    const held = request({
      eventId: null, kind: "checkout-hold",
      claims: [{ ...group, group: "karaoke", resourceIds: ["private-room-gem"], expiresAt: new Date(Date.now() + 600000).toISOString() }],
    });
    const old = await mutate("original-hold", held, "rexreplace");
    const data = request({
      action: "convert", eventId: null, kind: "room-booking", expectedRevision: 1,
      confirmationReference: "verified-payment-1", replaceClaimIds: [old.claims[0].claimId],
      claims: [{ ...group, group: "karaoke", resourceIds: ["private-room-gem"] }],
    });
    const booked = await mutate("paid-booking", data, "rexreplace");
    expect(booked).toMatchObject({ status: "applied", action: "convert", revision: 2 });
    expect(booked.claims[0].expiresAt).toBeNull();
    expect(booked.claims[0].claimId).not.toBe(old.claims[0].claimId);
    expect(await active()).toHaveLength(1);
    expect(await mutate("paid-booking", data, "rexreplace")).toEqual(booked);
    expect(await rpc("operation", "original-hold", held, "rexreplace")).toMatchObject({ status: "unknown" });
    expect(await mutate("competing-guest", request({ ...data, action: "replace", replaceClaimIds: [], expectedRevision: 2, ownerReference: "other" }), "rexreplace"))
      .toMatchObject({ status: "conflict" });
  });
  it.each(["resources", "interval", "expired", "foreign", "source"])("cannot convert a %s-mismatched hold", async (failure) => {
    const held = request({ eventId: null, kind: "checkout-hold", claims: [{ ...group, expiresAt: new Date(Date.now() + 600000).toISOString() }] });
    const old = await mutate("original-hold", held, "rexreplace");
    const data = request({ action: "convert", eventId: null, kind: "room-booking",
      expectedRevision: 1, confirmationReference: "payment-1", replaceClaimIds: [old.claims[0].claimId] });
    if (failure === "resources") data.claims = [{ ...group, resourceIds: ["bowling-7"] }];
    if (failure === "interval") data.claims = [{ ...group, endsAt: "2026-10-21T22:00:00Z" }];
    if (failure === "expired") await db.query("update shared_inventory.claims set expires_at=clock_timestamp()-interval '1 second' where id=$1", [old.claims[0].claimId]);
    if (failure === "foreign") data.ownerReference = "foreign";
    if (failure === "source") {
      await db.exec("update shared_inventory.checkpoints set complete=false");
      expect(await mutate("failed-conversion", data, "rexreplace")).toMatchObject({ status: "unknown" });
    } else await expect(mutate("failed-conversion", data, "rexreplace")).rejects.toThrow();
    expect((await db.query("select kind,active from shared_inventory.claims")).rows).toEqual([{ kind: "checkout-hold", active: true }]);
    expect((await db.query<{ revision: number }>("select revision from shared_inventory.control")).rows[0].revision).toBe(1);
  });
  it("rejects stale revisions, disabled writers and non-read-committed transactions", async () => {
    expect(await mutate("stale-revision", request({ expectedRevision: 2 }))).toMatchObject({ status: "unknown", reason: "revision_changed" });
    await db.exec("update shared_inventory.writers set enabled=false where id='waitlist'");
    expect(await mutate("disabled-writer")).toMatchObject({ status: "unknown", reason: "writer_cutover_incomplete" });
    await db.exec("begin isolation level repeatable read");
    try { await expect(mutate("wrong-isolation")).rejects.toThrow(/read_committed/); }
    finally { await db.exec("rollback"); }
    expect(await active()).toHaveLength(0);
  });
  it("detects altered receipts and denies browser access while allowing service calls", async () => {
    await db.exec("set role service_role");
    try {
      const old = await mutate("service-mutation");
      await db.query("update shared_inventory.claims set ends_at=ends_at+interval '1 hour' where id=$1", [old.claims[0].claimId]);
      expect(await rpc("operation", "service-mutation", request())).toMatchObject({ status: "unknown" });
      await expect(db.exec("delete from shared_inventory.operations")).rejects.toThrow(/permission/);
    } finally { await db.exec("reset role"); }
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try { await expect(mutate("browser-mutation")).rejects.toThrow(/permission/); }
      finally { await db.exec("reset role"); }
    }
  });
  it.each(["owner_reference", "event_id", "kind"])("invalidates both v1 retries and v2 read-back after %s changes", async (column) => {
    const data = { ...identity, ...group, replaceClaimIds: [] };
    const first = await rpc("claim", "single-claim", data);
    await db.query(`update shared_inventory.claims set ${column}=$1 where id=$2`, [column === "kind" ? "walk-in" : "another", first.claimId]);
    expect(await rpc("claim", "single-claim", data)).toMatchObject({ status: "unknown" });
    expect(await rpc("operation", "single-claim", data)).toMatchObject({ status: "unknown" });
  });
});
