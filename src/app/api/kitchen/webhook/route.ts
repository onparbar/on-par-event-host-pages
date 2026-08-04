import { NextResponse } from "next/server";
import {
  processTripleseatWebhook,
  TripleseatWebhookError,
} from "@/lib/kitchen/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 1024 * 1024;

export async function POST(request: Request) {
  const signingKey = process.env.TRIPLESEAT_WEBHOOK_SIGNING_KEY?.trim();
  if (!signingKey) {
    return NextResponse.json(
      {
        error: "Tripleseat webhook is not configured.",
        missingEnvironmentVariables: ["TRIPLESEAT_WEBHOOK_SIGNING_KEY"],
      },
      { status: 503 },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json(
      { error: "Tripleseat webhook payload is too large." },
      { status: 413 },
    );
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.byteLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json(
      { error: "Tripleseat webhook payload is too large." },
      { status: 413 },
    );
  }

  try {
    return NextResponse.json(
      await processTripleseatWebhook({
        rawBody,
        signatureHeader: request.headers.get("x-signature"),
        signingKey,
      }),
    );
  } catch (error) {
    if (error instanceof TripleseatWebhookError) {
      const status =
        error.kind === "signature"
          ? 401
          : error.kind === "payload"
            ? 400
            : 502;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json(
      { error: "Tripleseat webhook processing failed." },
      { status: 502 },
    );
  }
}
