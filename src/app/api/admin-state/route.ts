import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hasAdminSession } from "@/lib/admin-auth";
import {
  buildAdminStateRequest,
  loadAdminStateSnapshot,
  loadAdminStateVersion,
} from "@/lib/admin-state";
import { saveChecklist } from "@/lib/checklist-storage";
import { StaleSaveError } from "@/lib/stale-save";
import { normalizeItineraryEdits } from "@/lib/itineraries/edits";
import {
  ADMIN_STATE_VERSION_HEADER,
  emptyAdminState,
  type AdminState,
} from "@/lib/admin-types";

export const dynamic = "force-dynamic";

const PRIVATE_RESPONSE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  vary: "Cookie",
};

function unauthorized() {
  return NextResponse.json(
    { error: "Admin session required." },
    { status: 401, headers: PRIVATE_RESPONSE_HEADERS },
  );
}

function normalizeState(value: unknown): AdminState {
  if (!value || typeof value !== "object") {
    return emptyAdminState();
  }
  const state = value as Partial<AdminState>;
  return {
    archivedAssetKeys: Array.isArray(state.archivedAssetKeys) ? state.archivedAssetKeys.filter((item): item is string => typeof item === "string") : [],
    archivedEventIds: Array.isArray(state.archivedEventIds) ? state.archivedEventIds.map((item) => Number(item)).filter((item) => Number.isFinite(item)) : [],
    itineraryEditsByEvent: normalizeItineraryEdits(state.itineraryEditsByEvent),
    overlaysByAsset:
      state.overlaysByAsset && typeof state.overlaysByAsset === "object"
        ? Object.fromEntries(
            Object.entries(state.overlaysByAsset).map(([key, overlays]) => [
              key,
              Array.isArray(overlays) ? overlays : [],
            ]),
          )
        : {},
  };
}

export async function GET() {
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return unauthorized();
  }

  return NextResponse.json(await loadAdminStateSnapshot(), {
    headers: PRIVATE_RESPONSE_HEADERS,
  });
}

export async function HEAD() {
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return unauthorized();
  }

  try {
    const version = (await loadAdminStateVersion()) ?? "none";
    return new NextResponse(null, {
      status: 204,
      headers: {
        ...PRIVATE_RESPONSE_HEADERS,
        [ADMIN_STATE_VERSION_HEADER]: version,
      },
    });
  } catch {
    return new NextResponse(null, {
      status: 502,
      headers: PRIVATE_RESPONSE_HEADERS,
    });
  }
}

export async function PUT(request: Request) {
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return unauthorized();
  }

  let body: { state?: AdminState; expectedUpdatedAt?: string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid admin state payload." }, { status: 400 });
  }

  let state: AdminState;
  try {
    state = normalizeState(body.state);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid itinerary edits." }, { status: 400, headers: PRIVATE_RESPONSE_HEADERS });
  }
  if (body.expectedUpdatedAt !== null && (typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt)))) {
    return NextResponse.json({ error: "Reload the Admin state before saving." }, { status: 400, headers: PRIVATE_RESPONSE_HEADERS });
  }

  try {
    const record = await saveChecklist({ ...buildAdminStateRequest(state), expectedUpdatedAt: body.expectedUpdatedAt });

    return NextResponse.json(
      { ok: true, record },
      { headers: PRIVATE_RESPONSE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save admin state.";
    return NextResponse.json(
      { error: message },
      { status: error instanceof StaleSaveError ? 409 : 502, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }
}
