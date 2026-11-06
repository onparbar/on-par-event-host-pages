import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("entertainment reservation schema", () => {
  it("accepts VIP Prep reservations", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20260831132500_allow_vip_prep_entertainment_source.sql",
      ),
      "utf8",
    );

    expect(migration).toContain(
      "source in ('tripleseat', 'vip-prep', 'event-host-fallback', 'manual')",
    );
  });
});
