import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processGoTabDispatches } from "@/lib/gotab/worker";
import { synchronizeVipBookingFoodToEventFood } from "@/lib/gotab/sync-event-food";
import { getKitchenDay } from "@/lib/kitchen/sync";
import { todayInEntertainmentTimeZone } from "@/lib/entertainment/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function equalSecret(candidate: string, expected: string) {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  return Boolean(
    secret &&
    authorization.startsWith("Bearer ") &&
    equalSecret(authorization.slice("Bearer ".length), secret),
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    let vipBookingFood = { queued: 0, exceptions: 0, warning: null as string | null };
    try {
      const day = await getKitchenDay(todayInEntertainmentTimeZone());
      if (day.warnings.some((warning) => warning.startsWith("VIP Prep could not be refreshed")) ||
          day.missingEnvironmentVariables.includes("VIP_PREP_API_TOKEN")) {
        throw new Error("VIP booking feed is unavailable.");
      }
      for (const checklist of day.events.filter((event) =>
        String(event.event.eventId).startsWith("vip-"),
      )) {
        const result = await synchronizeVipBookingFoodToEventFood(checklist);
        vipBookingFood.queued += result.requestCount;
        vipBookingFood.exceptions += result.exceptionCount;
      }
    } catch {
      vipBookingFood = {
        ...vipBookingFood,
        warning: "VIP booking food could not be staged; GoTab dispatches will still be processed.",
      };
    }
    return NextResponse.json({
      ...(await processGoTabDispatches()),
      vipBookingFood,
    });
  } catch {
    return NextResponse.json(
      { error: "GoTab reconciliation could not complete." },
      { status: 503 },
    );
  }
}
