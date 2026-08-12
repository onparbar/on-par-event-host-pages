import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireGoTabConfiguration } from "@/lib/gotab/config";
import { GoTabIntegrationStorage } from "@/lib/gotab/storage";
import { verifyGoTabWebhookSignature } from "@/lib/gotab/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 1024 * 1024;
const SUPPORTED_EVENTS = new Set([
  "ITEM_ADDED",
  "ITEM_REMOVED",
  "ITEM_VOIDED",
  "ITEM_COMPED",
  "OPEN_TAB",
  "CLOSE_TAB",
  "ORDER_PLACED",
  "PRODUCT_UPDATED",
  "MENU_UPDATED",
]);

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: Request) {
  let configuration;
  try {
    configuration = requireGoTabConfiguration();
  } catch {
    return NextResponse.json({ error: "GoTab webhook is not configured." }, { status: 503 });
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "GoTab webhook payload is too large." }, { status: 413 });
  }
  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.byteLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "GoTab webhook payload is too large." }, { status: 413 });
  }
  if (!verifyGoTabWebhookSignature(
    rawBody,
    request.headers.get("x-gotab-signature"),
    configuration.webhookSecret,
  )) {
    return NextResponse.json({ error: "Invalid GoTab webhook signature." }, { status: 401 });
  }
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(Buffer.from(rawBody).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    payload = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid GoTab webhook payload." }, { status: 400 });
  }
  const eventType = string(payload.type)?.toUpperCase();
  if (!eventType) {
    return NextResponse.json({ error: "GoTab webhook event type is required." }, { status: 400 });
  }
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const storage = new GoTabIntegrationStorage();
  let claimed: boolean;
  try {
    claimed = await storage.claimWebhook({
      receiptId: payloadHash,
      eventType,
      targetUuid: string(payload.targetUuid),
      locationUuid: string(payload.locationUuid),
      payloadHash,
      receivedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: "GoTab webhook could not be recorded." }, { status: 503 });
  }
  if (!claimed) return NextResponse.json({ ok: true, duplicate: true }, { status: 202 });
  const relevantLocation =
    !string(payload.locationUuid) ||
    string(payload.locationUuid) === configuration.locationUuid;
  const handled = relevantLocation && SUPPORTED_EVENTS.has(eventType);
  await storage.completeWebhook(payloadHash, handled ? "PROCESSED" : "IGNORED");
  return NextResponse.json({ ok: true, duplicate: false, handled }, { status: 202 });
}

