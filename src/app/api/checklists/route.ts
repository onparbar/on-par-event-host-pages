import { NextResponse } from "next/server";
import { checklistEvents } from "@/lib/checklist-events";
import type { EventChecklistState } from "@/lib/checklist-model";
import { callChecklistFunction } from "@/lib/checklist-storage";

export const dynamic = "force-dynamic";

type SaveChecklistRequest = {
  eventId?: number;
  checklist?: EventChecklistState;
};

const eventById = new Map(checklistEvents.map((event) => [event.id, event]));

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  try {
    const payload = await callChecklistFunction({ method: "GET" });
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load saved checklists.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  let body: SaveChecklistRequest;

  try {
    body = (await request.json()) as SaveChecklistRequest;
  } catch {
    return badRequest("Invalid checklist payload.");
  }

  if (typeof body.eventId !== "number" || !body.checklist) {
    return badRequest("Missing eventId or checklist.");
  }

  const event = eventById.get(body.eventId);
  if (!event) {
    return badRequest("Unknown event.");
  }

  try {
    const payload = await callChecklistFunction({
      method: "POST",
      body: JSON.stringify({
        action: "save",
        eventId: event.id,
        eventName: event.name,
        eventDate: event.date,
        poc: event.poc,
        checklist: body.checklist,
      }),
    });

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save checklist.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
