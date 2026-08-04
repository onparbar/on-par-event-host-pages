import { NextResponse } from "next/server";
import { getEntertainmentReservationAudit } from "@/lib/entertainment/sync";
import {
  entertainmentUnauthorized,
  requireEntertainmentSession,
} from "../../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ reservationId: string }> },
) {
  if (!(await requireEntertainmentSession())) {
    return entertainmentUnauthorized();
  }
  try {
    const { reservationId } = await context.params;
    return NextResponse.json({
      audit: await getEntertainmentReservationAudit(reservationId),
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load reservation history." },
      { status: 502 },
    );
  }
}
