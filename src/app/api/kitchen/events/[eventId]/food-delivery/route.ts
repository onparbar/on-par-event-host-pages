import { NextResponse } from "next/server";
import { GoTabIntegrationStorage } from "@/lib/gotab/storage";
import { summarizeEventFoodDelivery } from "@/lib/gotab/delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Status checks must never synchronize a checklist or send/retry an order.
export async function GET(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await context.params;
  const values = new URL(request.url).searchParams.getAll("requestIds");
  const requestIds = values.length ? [...new Set(values.flatMap((value) => value.split(",")))] : undefined;
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(eventId) || (requestIds && (!requestIds.length || requestIds.length > 100 || requestIds.some((id) => !/^[A-Za-z0-9-]{1,160}$/.test(id))))) {
    return NextResponse.json({ error: "Invalid food-delivery scope." }, { status: 400 });
  }
  try {
    const deliveries = (await new GoTabIntegrationStorage().listEventFoodDelivery([eventId], requestIds))
      .filter((item) => item.eventId === eventId && (!requestIds || requestIds.includes(item.requestId)));
    const expected = requestIds ?? deliveries.map((item) => item.requestId);
    const summary = summarizeEventFoodDelivery(deliveries, expected);
    return NextResponse.json({
      eventId,
      requestIds: expected,
      status: summary.complete ? "live" : summary.pending ? "pending" : expected.length ? "error" : "not-required",
      deliveries: summary.deliveries,
      accepted: summary.sent,
      error: summary.error,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Food-delivery status is temporarily unavailable. Do not submit the same order again." }, { status: 502 });
  }
}
