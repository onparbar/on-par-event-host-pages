import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getChecklistRecord,
  getChecklistRecordUpdatedAt,
  listChecklistRecords,
  resetLocalChecklistStorageForTests,
  saveChecklist,
} from "../checklist-storage";
import { CHECKLIST_CLOSEOUT_CONFIRMATION_KEY, defaultChecklistState } from "../checklist-model";

afterEach(() => {
  resetLocalChecklistStorageForTests();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("local legacy checklist preview", () => {
  it("uses process-local storage when the Supabase secret is unavailable outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEYS", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const saved = await saveChecklist({
      action: "save",
      expectedUpdatedAt: null,
      eventId: 1001,
      eventName: "Preview Event",
      eventDate: "2026-08-06",
      checklist: {
        bwa: "",
        extrasAdded: "",
        remainingDrinkCardBalance: "",
        tasks: {},
        entertainment: {},
        food: {},
      },
    });

    await expect(listChecklistRecords()).resolves.toEqual([saved]);
    await expect(getChecklistRecord(1001)).resolves.toEqual(saved);
    await expect(getChecklistRecordUpdatedAt(1001)).resolves.toBe(saved.updatedAt);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the saved event identity used by completed checklists", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEYS", "");

    const saved = await saveChecklist({
      action: "submit",
      expectedUpdatedAt: null,
      eventId: 4321,
      eventName: "80th Birthday Party",
      eventDate: "2026-09-05",
      poc: "Diana",
      checklist: {
        bwa: "",
        extrasAdded: "",
        remainingDrinkCardBalance: "",
        tasks: {},
        entertainment: {},
        food: {},
      },
    });

    expect(saved).toMatchObject({
      eventId: 4321,
      eventName: "80th Birthday Party",
      eventDate: "2026-09-05",
      poc: "Diana",
      status: "submitted",
    });
  });
});

function databaseResponse() {
  return new Response("[]", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("legacy Event Host checklist database authentication", () => {
  it("loads the saved event identity used by completed checklists", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_value");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json([
        {
          event_id: 7002,
          event_name: "Correct Event Name",
          event_date: "2026-09-12",
          poc: "Taylor",
          status: "submitted",
          submitted_at: "2026-09-12T22:00:00.000Z",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listChecklistRecords()).resolves.toEqual([
      expect.objectContaining({
        eventId: 7002,
        eventName: "Correct Event Name",
        eventDate: "2026-09-12",
        poc: "Taylor",
        status: "submitted",
      }),
    ]);

    const selectedColumns = new URL(
      String(fetchMock.mock.calls[0]?.[0]),
    ).searchParams.get("select")?.split(",");
    expect(selectedColumns).toEqual(
      expect.arrayContaining(["event_name", "event_date", "poc"]),
    );
  });

  it("uses an opaque Supabase secret as apikey without an invalid Bearer header", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_value");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        databaseResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listChecklistRecords();

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("apikey")).toBe("sb_secret_test_value");
    expect(headers.get("authorization")).toBeNull();
  });

  it("retains Bearer authorization for legacy service-role JWTs", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "eyJtest.payload.signature");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        databaseResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listChecklistRecords();

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe(
      "Bearer eyJtest.payload.signature",
    );
  });
});

describe("targeted Event Host checklist reads", () => {
  it("loads only the requested admin-state row", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_value");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json([
        {
          event_id: 99990001,
          tasks: { adminState: { archivedAssetKeys: [] } },
          updated_at: "2026-07-30T17:00:00.000Z",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const record = await getChecklistRecord(99990001);

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("event_id")).toBe(
      "eq.99990001",
    );
    expect(requestUrl.searchParams.get("limit")).toBe("1");
    expect(requestUrl.searchParams.get("select")).toContain("tasks");
    expect(record).toMatchObject({
      eventId: 99990001,
      updatedAt: "2026-07-30T17:00:00.000Z",
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
    });
  });

  it("fetches only updated_at for the live-sync revision check", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_value");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json([
        { updated_at: "2026-07-30T17:00:01.000Z" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getChecklistRecordUpdatedAt(99990001),
    ).resolves.toBe("2026-07-30T17:00:01.000Z");

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("event_id")).toBe(
      "eq.99990001",
    );
    expect(requestUrl.searchParams.get("select")).toBe("updated_at");
    expect(requestUrl.searchParams.get("limit")).toBe("1");
  });
});

describe("atomic checklist saves", () => {
  function localInput() {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEYS", "");
    return { action: "save" as const, eventId: 42, eventName: "Redacted safety fixture", eventDate: "2026-10-21", expectedUpdatedAt: null, checklist: defaultChecklistState("2026-10-21") };
  }

  it("rejects the second first-save rather than merging over a new record", async () => {
    const input = localInput();
    const results = await Promise.allSettled([saveChecklist(input), saveChecklist(input)]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
  });

  it("preserves manually entered POC and workspace evidence when an older client omits them", async () => {
    const input = localInput();
    const first = await saveChecklist({ ...input, checklist: { ...input.checklist, poc: "Staff POC", tasks: { "workspace:activity:bowling:started": true }, taskEvidence: { "workspace:activity:bowling:started": { employeeName: "Carlos", completedAt: "2026-10-23T17:00:00Z" } } } });
    const legacy = { ...input.checklist };
    delete legacy.poc;
    const second = await saveChecklist({ ...input, expectedUpdatedAt: first.updatedAt, checklist: legacy });
    expect(second.poc).toBe("Staff POC");
    expect(second.tasks["workspace:activity:bowling:started"]).toBe(true);
    expect(second.taskEvidence?.["workspace:activity:bowling:started"]).toMatchObject({ employeeName: "Carlos" });
    const third = await saveChecklist({ ...input, expectedUpdatedAt: second.updatedAt, checklist: { ...legacy, poc: "Contact omitted from preview" } });
    expect(third.poc).toBe("Staff POC");
    const cleared = await saveChecklist({ ...input, expectedUpdatedAt: third.updatedAt, checklist: { ...legacy, poc: "" } });
    expect(cleared.poc).toBe("");
  });

  it("merges the current POC on hosted CAS saves without making a schema change", async () => {
    const input = localInput();
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    const prior = { event_id: input.eventId, poc: "Staff POC", updated_at: "2026-10-23T17:00:00Z", tasks: { "workspace:reminder:food:ack": true }, task_evidence: { "workspace:reminder:food:ack": { employeeName: "Brooke", completedAt: "2026-10-23T17:00:00Z" } } };
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST" ? Response.json({ ...prior, ...JSON.parse(String(init.body)).p_record }) : Response.json([prior]));
    vi.stubGlobal("fetch", fetchMock);
    const legacy = { ...input.checklist };
    delete legacy.poc;
    const saved = await saveChecklist({ ...input, expectedUpdatedAt: prior.updated_at, checklist: legacy });
    expect(saved.poc).toBe("Staff POC");
    expect(saved.tasks["workspace:reminder:food:ack"]).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ p_expected_updated_at: prior.updated_at, p_record: { poc: "Staff POC" } });
  });

  it("preserves quantities and completion evidence when another tablet loses a stale save", async () => {
    const input = localInput();
    const initial = await saveChecklist(input);
    const winner = { ...input, expectedUpdatedAt: initial.updatedAt, checklist: { ...input.checklist, food: { ...input.checklist.food, wings: { quantity: "2", manualPrice: "", panSize: "1/2" as const } }, taskEvidence: { "food-ready": { employeeName: "Staff-entered name", completedAt: "2026-10-21T17:00:00Z" } } } };
    const results = await Promise.allSettled([saveChecklist(winner), saveChecklist({ ...input, expectedUpdatedAt: initial.updatedAt })]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    await expect(getChecklistRecord(42)).resolves.toMatchObject({ food: { wings: { quantity: "2", panSize: "1/2" } }, taskEvidence: winner.checklist.taskEvidence });
  });

  it("does not reopen a submitted record without the Admin-only reopen flag", async () => {
    const input = localInput();
    const submitted = await saveChecklist({ ...input, action: "submit" });
    await expect(saveChecklist({ ...input, expectedUpdatedAt: submitted.updatedAt })).rejects.toMatchObject({ status: 409 });
    await expect(saveChecklist({ ...input, expectedUpdatedAt: submitted.updatedAt, allowReopen: true })).resolves.toMatchObject({ status: "draft", submittedAt: null });
  });

  it("does not allow draft saves to forge a closeout confirmation receipt", async () => {
    const input = localInput();
    const forged = { ...input.checklist, tasks: { [CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]: true }, taskEvidence: { [CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]: { employeeName: "Client supplied", completedAt: "2026-10-23T17:00:00Z", sourceFingerprint: "client supplied", contractWarnings: ["Client supplied warning"] } } };
    const first = await saveChecklist({ ...input, checklist: forged });
    expect(first.tasks[CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toBeUndefined();
    expect(first.taskEvidence![CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toBeUndefined();
    const second = await saveChecklist({ ...input, expectedUpdatedAt: first.updatedAt, checklist: forged });
    expect(second.tasks[CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toBeUndefined();
    expect(second.taskEvidence![CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toBeUndefined();
  });

  it("preserves the server receipt during Admin reopen but clears it on ordinary resubmission", async () => {
    const input = localInput();
    const receipt = { employeeName: "Brooke", completedAt: "2026-10-23T17:00:00Z", sourceFingerprint: "server-reviewed-source", contractWarnings: ["Original unresolved contract detail"] };
    const workspaceKey = "workspace:activity:bowling:completed";
    const submitted = await saveChecklist({ ...input, action: "submit", checklist: { ...input.checklist, tasks: { [CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]: true, [workspaceKey]: true }, taskEvidence: { [CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]: receipt, [workspaceKey]: { employeeName: "Carlos", completedAt: "2026-10-23T17:00:00Z" } } } });
    const reopened = await saveChecklist({ ...input, expectedUpdatedAt: submitted.updatedAt, allowReopen: true });
    expect(reopened.taskEvidence![CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toEqual(receipt);
    expect(reopened.tasks[CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toBe(true);
    const tampered = { ...input.checklist, tasks: { [CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]: false }, taskEvidence: { [CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]: { ...receipt, employeeName: "Client replacement" } } };
    const draft = await saveChecklist({ ...input, expectedUpdatedAt: reopened.updatedAt, checklist: tampered });
    expect(draft.tasks[CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toBe(true);
    expect(draft.taskEvidence![CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toEqual(receipt);
    const final = await saveChecklist({ ...input, action: "submit", expectedUpdatedAt: draft.updatedAt });
    expect(final.status).toBe("submitted");
    expect(final.tasks[CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toBeUndefined();
    expect(final.taskEvidence![CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toBeUndefined();
    expect(final.tasks[workspaceKey]).toBe(true);
    expect(final.taskEvidence![workspaceKey].employeeName).toBe("Carlos");
  });

  it("omits a previous receipt from the hosted CAS payload unless the server supplies a new one", async () => {
    const input = localInput();
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    const prior = { event_id: input.eventId, updated_at: "2026-10-23T17:00:00Z", status: "draft", tasks: { [CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]: true, "workspace:reminder:food:ack": true }, task_evidence: { [CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]: { employeeName: "Brooke", completedAt: "2026-10-23T17:00:00Z", sourceFingerprint: "old-server-source", contractWarnings: ["Old warning"] } } };
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST" ? Response.json({ ...prior, ...JSON.parse(String(init.body)).p_record }) : Response.json([prior]));
    vi.stubGlobal("fetch", fetchMock);
    const saved = await saveChecklist({ ...input, action: "submit", expectedUpdatedAt: prior.updated_at });
    expect(saved.tasks[CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toBeUndefined();
    expect(saved.taskEvidence![CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toBeUndefined();
    expect(saved.tasks["workspace:reminder:food:ack"]).toBe(true);
    const payload = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(payload.p_expected_updated_at).toBe(prior.updated_at);
    expect(payload.p_record.tasks).not.toHaveProperty(CHECKLIST_CLOSEOUT_CONFIRMATION_KEY);
    expect(payload.p_record.task_evidence).not.toHaveProperty(CHECKLIST_CLOSEOUT_CONFIRMATION_KEY);
  });

  it("sends the loaded revision to the atomic RPC and never falls back after a missing migration", async () => {
    const input = localInput();
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ code: "PGRST202" }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveChecklist(input)).rejects.toThrow("migration is not installed");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/rpc/save_event_host_checklist_checked");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ p_expected_updated_at: null, p_allow_reopen: false, p_record: { food: input.checklist.food, task_evidence: {} } });
  });
});
