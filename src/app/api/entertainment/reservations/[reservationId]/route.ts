import { NextResponse } from "next/server";
import {
  EntertainmentConflictError,
  removeEntertainmentReservation,
  type ReservationMutationInput,
  updateEntertainmentReservation,
} from "@/lib/entertainment/sync";
import {
  entertainmentUnauthorized,
  requireEntertainmentSession,
} from "../../_auth";

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
export async function PATCH(
  request: Request,
  context: { params: Promise<{ reservationId: string }> },
) {
  if (!(await requireEntertainmentSession())) {
    return entertainmentUnauthorized();
  }
  let body: ReservationMutationInput;
  try {
    body = (await request.json()) as ReservationMutationInput;
  } catch {
    return NextResponse.json(
      { error: "Invalid reservation edit payload." },
      { status: 400 },
    );
  }
  try {
    const { reservationId } = await context.params;
    return NextResponse.json({
      reservation: await updateEntertainmentReservation(reservationId, body),
    });
  } catch (error) {
    if (error instanceof EntertainmentConflictError) {
      return conflictResponse(error);
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update the reservation.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ reservationId: string }> },
) {
  if (!(await requireEntertainmentSession())) {
    return entertainmentUnauthorized();
  }
  let body: { reason?: unknown } = {};
  try {
    body = (await request.json()) as { reason?: unknown };
  } catch {
    // A reason is optional.
  }
  try {
    const { reservationId } = await context.params;
    const reason = typeof body.reason === "string" ? body.reason : "";
    return NextResponse.json({
      reservation: await removeEntertainmentReservation(
        reservationId,
        reason,
      ),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to remove the reservation.",
      },
      { status: 400 },
    );
  }
}
