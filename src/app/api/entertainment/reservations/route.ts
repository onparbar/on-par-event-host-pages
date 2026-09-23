import { NextResponse } from "next/server";
import {
  createManualEntertainmentReservation,
  EntertainmentConflictError,
  type ReservationMutationInput,
} from "@/lib/entertainment/sync";
import {
  isSameOriginOperationalRequest,
  operationalAccessDenied,
} from "@/lib/operational-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function conflictResponse(error: EntertainmentConflictError) {
  return NextResponse.json(
    {
      error: error.message,
      conflict: true,
      reservations: error.conflictingReservations.map((reservation) => ({
        id: reservation.id,
        eventName: reservation.eventName,
        resourceName: reservation.resourceName,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
      })),
    },
    { status: 409 },
  );
}
export async function POST(request: Request) {
  if (!isSameOriginOperationalRequest(request)) {
    return operationalAccessDenied();
  }
  let body: ReservationMutationInput;
  try {
    body = (await request.json()) as ReservationMutationInput;
  } catch {
    return NextResponse.json(
      { error: "Invalid manual reservation payload." },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(
      { reservation: await createManualEntertainmentReservation(body) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof EntertainmentConflictError) {
      return conflictResponse(error);
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create the reservation.",
      },
      { status: 400 },
    );
  }
}
