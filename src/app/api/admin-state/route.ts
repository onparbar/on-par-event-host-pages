import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hasAdminSession } from "@/lib/admin-auth";
import { buildAdminStateRequest, loadAdminState } from "@/lib/admin-state";
import { callChecklistFunction } from "@/lib/checklist-storage";
import { emptyAdminState, type AdminState } from "@/lib/admin-types";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Admin session required." }, { status: 401 });
}

function normalizeState(value: unknown): AdminState {
  if (!value || typeof value !== "object") {
    return emptyAdminState();
  }
  const state = value as Partial<AdminState>;
  return {
    archivedAssetKeys: Array.isArray(state.archivedAssetKeys) ? state.archivedAssetKeys.filter((item): item is string => typeof item === "string") : [],
    archivedEventIds: Array.isArray(state.archivedEventIds) ? state.archivedEventIds.map((item) => Number(item)).filter((item) => Number.isFinite(item)) : [],
    overlaysByAsset:
      state.overlaysByAsset && typeof state.overlaysByAsset === "object"
        ? Object.fromEntries(
            Object.entries(state.overlaysByAsset).map(([key, overlays]) => [
              key,
              Array.isArray(overlays) ? overlays : [],
            ]),
          )
        : {},
    baseImageByAsset:
      state.baseImageByAsset && typeof state.baseImageByAsset === "object"
        ? Object.fromEntries(
            Object.entries(state.baseImageByAsset).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"),
          )
        : {},
  };
}

export async function GET() {
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return unauthorized();
  }

  return NextResponse.json({ state: await loadAdminState() });
}

export async function PUT(request: Request) {
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return unauthorized();
  }

  let body: { state?: AdminState };
  try {
    body = (await request.json()) as { state?: AdminState };
  } catch {
    return NextResponse.json({ error: "Invalid admin state payload." }, { status: 400 });
  }

  const state = normalizeState(body.state);

  try {
    const payload = await callChecklistFunction({
      method: "POST",
      body: JSON.stringify(buildAdminStateRequest(state)),
    });

    return NextResponse.json({ ok: true, payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save admin state.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
