import { describe, expect, it } from "vitest";

import { quantityAwareReadinessKey } from "../readiness";

describe("quantityAwareReadinessKey", () => {
  const baseIdentity = {
    itemKey: "addon:wings",
    quantity: 64,
    numberOfPans: 3,
    panSize: "1/3",
    unit: "each",
    ruleVersion: "ope-kitchen-2026-07-29.2",
    sourceUpdatedAt: "2026-07-29T16:30:00Z",
  } as const;

  it("creates validation-safe deterministic keys for contract rows and live add-ons", () => {
    const contractKey = quantityAwareReadinessKey({
      itemKey: "taco-beef",
      quantity: 5,
      numberOfPans: 1,
      panSize: "1/3",
      unit: "pounds",
      ruleVersion: "ope-kitchen-2026-07-29.2",
    });
    const addOnKey = quantityAwareReadinessKey(baseIdentity);

    expect(contractKey).toMatch(/^ready:taco-beef:v2:[0-9a-f]{16}$/);
    expect(addOnKey).toMatch(/^ready:addon:wings:v2:[0-9a-f]{16}$/);
    expect(contractKey).toMatch(/^[A-Za-z0-9:_-]{1,160}$/);
    expect(addOnKey).toMatch(/^[A-Za-z0-9:_-]{1,160}$/);
    expect(quantityAwareReadinessKey(baseIdentity)).toBe(addOnKey);
  });

  it("changes when any preparation-defining field changes", () => {
    const original = quantityAwareReadinessKey(baseIdentity);
    const variants = [
      { ...baseIdentity, quantity: 128 },
      { ...baseIdentity, numberOfPans: 6 },
      { ...baseIdentity, panSize: "1/2" },
      { ...baseIdentity, unit: "pounds" },
      { ...baseIdentity, ruleVersion: "ope-kitchen-2026-07-29.3" },
      {
        ...baseIdentity,
        sourceUpdatedAt: "2026-07-29T16:31:00Z",
      },
    ];

    for (const variant of variants) {
      expect(quantityAwareReadinessKey(variant)).not.toBe(original);
    }
  });

  it("fingerprints unresolved and fractional values without leaving the allowed character set", () => {
    const key = quantityAwareReadinessKey({
      itemKey: "platter-mozzarella-sticks",
      quantity: 1.5,
      numberOfPans: null,
      panSize: null,
      unit: "pounds",
      ruleVersion: "ope-kitchen-2026-07-29.2",
    });

    expect(key).toMatch(/^[A-Za-z0-9:_-]{1,160}$/);
  });

  it("rejects invalid display keys and non-finite values", () => {
    expect(() =>
      quantityAwareReadinessKey({
        ...baseIdentity,
        itemKey: "addon/wings",
      }),
    ).toThrow(/item keys/i);
    expect(() =>
      quantityAwareReadinessKey({
        ...baseIdentity,
        quantity: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/finite/i);
  });
});
