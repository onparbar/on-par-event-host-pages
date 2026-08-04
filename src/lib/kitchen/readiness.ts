const VALID_ITEM_KEY = /^[A-Za-z0-9:_-]+$/;
const MAX_ITEM_KEY_LENGTH = 160;

export type ReadinessIdentity = {
  itemKey: string;
  quantity: number | null;
  numberOfPans: number | null;
  panSize: string | null;
  unit: string;
  ruleVersion: string;
  sourceUpdatedAt?: string | null;
};

function validateNumber(value: number | null) {
  if (value !== null && !Number.isFinite(value)) {
    throw new Error("Readiness quantities and pan counts must be finite.");
  }
}

function fingerprint(value: string) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function quantityAwareReadinessKey(identity: ReadinessIdentity) {
  const {
    itemKey,
    quantity,
    numberOfPans,
    panSize,
    unit,
    ruleVersion,
    sourceUpdatedAt = null,
  } = identity;
  if (!VALID_ITEM_KEY.test(itemKey)) {
    throw new Error("Readiness item keys may only use letters, numbers, colons, underscores, and hyphens.");
  }
  validateNumber(quantity);
  validateNumber(numberOfPans);

  const definitionFingerprint = fingerprint(
    JSON.stringify({
      itemKey,
      quantity,
      numberOfPans,
      panSize,
      unit,
      ruleVersion,
      sourceUpdatedAt,
    }),
  );
  const key = `ready:${itemKey}:v2:${definitionFingerprint}`;
  if (key.length > MAX_ITEM_KEY_LENGTH || !VALID_ITEM_KEY.test(key)) {
    throw new Error("Quantity-aware readiness key is invalid.");
  }
  return key;
}
