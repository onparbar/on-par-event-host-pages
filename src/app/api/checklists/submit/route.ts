import { NextResponse } from "next/server";
import { checklistEvents } from "@/lib/checklist-events";
import type { EventChecklistState } from "@/lib/checklist-model";
import { callChecklistFunction } from "@/lib/checklist-storage";

export const dynamic = "force-dynamic";

type SubmitChecklistRequest = {
  eventId?: number;
  checklist?: EventChecklistState;
};

const eventById = new Map(checklistEvents.map((event) => [event.id, event]));

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  let body: SubmitChecklistRequest;

  try {
    body = (await request.json()) as SubmitChecklistRequest;
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
        action: "submit",
        eventId: event.id,
        eventName: event.name,
        eventDate: event.date,
        poc: event.poc,
        checklist: body.checklist,
      }),
    });

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit checklist.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
