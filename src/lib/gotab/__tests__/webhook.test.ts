import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let verifyGoTabWebhookSignature: typeof import("../webhook").verifyGoTabWebhookSignature;

beforeAll(async () => {
  ({ verifyGoTabWebhookSignature } = await import("../webhook"));
});

describe("GoTab webhook verification", () => {
  it("validates the documented raw-body HMAC-SHA256 signature", () => {
    const body = Buffer.from('{"type":"ORDER_PLACED"}');
    const signature = createHmac("sha256", "rotated-test-secret").update(body).digest("hex");
    expect(verifyGoTabWebhookSignature(body, signature, "rotated-test-secret")).toBe(true);
    expect(verifyGoTabWebhookSignature(body, "0".repeat(64), "rotated-test-secret")).toBe(false);
  });
});
