import { NextResponse } from "next/server";
import { authorizedStaffBridgeRequest, isStaffSessionProof, staffBridge } from "@/lib/staff-auth/protocol";
import { revokeStaffSessionGroup } from "@/lib/staff-auth/storage";

export const runtime = "nodejs";

const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

export async function POST(request: Request) {
  const bridge = staffBridge();
  if (!bridge) return NextResponse.json({ error: "Staff sign-out is unavailable." }, { status: 503, headers });
  if (!authorizedStaffBridgeRequest(request.headers.get("authorization"), bridge)) {
    return NextResponse.json({ error: "Staff sign-out was not authorized." }, { status: 401, headers });
  }
  const contentType = request.headers.get("content-type") ?? "";
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (!/^application\/json(?:;|$)/i.test(contentType) || contentLength > 1200) {
    return NextResponse.json({ error: "Invalid staff sign-out request." }, { status: 400, headers });
  }
  let staffSession: unknown;
  try {
    const raw = await request.text();
    if (raw.length <= 1200) staffSession = JSON.parse(raw)?.staffSession;
  } catch { /* Invalid bodies are rejected below. */ }
  if (!isStaffSessionProof(staffSession)) {
    return NextResponse.json({ error: "Invalid staff sign-out request." }, { status: 400, headers });
  }
  try {
    await revokeStaffSessionGroup(staffSession);
    return new NextResponse(null, { status: 204, headers });
  } catch {
    return NextResponse.json({ error: "Staff sign-out could not be confirmed." }, { status: 503, headers });
  }
}
