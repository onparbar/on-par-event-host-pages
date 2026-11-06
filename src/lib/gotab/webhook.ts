import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGoTabWebhookSignature(
  rawBody: Uint8Array,
  signatureHeader: string | null,
  webhookSecret: string,
) {
  if (!signatureHeader || !/^[a-f0-9]{64}$/i.test(signatureHeader) || !webhookSecret) {
    return false;
  }
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest();
  const received = Buffer.from(signatureHeader, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
