import { NextResponse } from "next/server";
import {
  EntertainmentConflictError,
  revertEntertainmentReservation,
} from "@/lib/entertainment/sync";
import {
  entertainmentUnauthorized,
  requireEntertainmentSession,
} from "../../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ reservationId: string }> },
) {
  if (!(await requireEntertainmentSession())) {
    return entertainmentUnauthorized();
  }
  let body: { forceConflict?: unknown; reason?: unknown } = {};
  try {
    body = (await request.json()) as {
      forceConflict?: unknown;
      reason?: unknown;
    };
  } catch {
    // Both values are optional.
  }
  try {
    const { reservationId } = await context.params;
    return NextResponse.json({
      reservation: await revertEntertainmentReservation(
        reservationId,
        body.forceConflict === true,
        typeof body.reason === "string" ? body.reason : "",
      ),
    });
  } catch (error) {
    if (error instanceof EntertainmentConflictError) {
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
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to revert the reservation.",
      },
      { status: 400 },
    );
  }
}
