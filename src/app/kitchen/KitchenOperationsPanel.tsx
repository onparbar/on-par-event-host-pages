"use client";

import { kitchenProductionTotals, kitchenProgress } from "@/lib/kitchen/production";
import type { KitchenChecklist } from "@/lib/kitchen/types";
import { eventFoodDeliveryState, type EventFoodDelivery } from "@/lib/gotab/delivery";

function clock(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Needs review";
}

export function KitchenProductionPanel({ events }: { events: KitchenChecklist[] }) {
  const { totals, unresolvedRows } = kitchenProductionTotals(events);
  return <section className="kitchen-operations-panel" aria-labelledby="kitchen-production-heading">
    <h2 id="kitchen-production-heading">Production by food-ready time</h2>
    <p>Current calculated prep-sheet totals, grouped by food, pan size, and service time. Keep party portions separate. Live refills and other separate GoTab orders are listed below; do not add them to these totals again.</p>
    {unresolvedRows > 0 ? <p role="alert">{unresolvedRows} unresolved food row(s) excluded from totals. Review the event sheets.</p> : null}
    <div className="kitchen-operations-scroll"><table><thead><tr><th>Food</th><th>Ready by</th><th>Total</th><th>Not ready</th><th>Pans</th><th>Party portions</th></tr></thead><tbody>
      {totals.map((item) => <tr key={item.id} data-review={item.needsReview}>
        <th scope="row">{item.foodName}{item.needsReview ? <small>Needs review</small> : null}</th>
        <td>{clock(item.readyBy)}</td><td>{item.quantity} {item.unit}</td><td>{item.remainingQuantity} {item.unit}</td>
        <td>{item.pans ?? "—"}{item.panSize ? ` × ${item.panSize}` : ""}</td>
        <td>{item.events.map((event, index) => <div key={`${event.id}:${index}`}>{event.name}: {event.quantity} {item.unit}{event.ready ? " · ready" : ""}</div>)}</td>
      </tr>)}
    </tbody></table></div>
    {!totals.length ? <p>No verified numeric prep quantities are available for this selection.</p> : null}
  </section>;
}

export function KitchenExpoPanel({ events }: { events: KitchenChecklist[] }) {
  return <section className="kitchen-operations-panel" aria-labelledby="kitchen-expo-heading"><h2 id="kitchen-expo-heading">Expo and Food Runner</h2>
    <div className="kitchen-operations-scroll"><table><thead><tr><th>Event / area</th><th>Food Runner</th><th>POC</th><th>Prepped</th><th>Ready</th></tr></thead><tbody>{events.map((event) => {
      const progress = kitchenProgress(event);
      return <tr key={String(event.event.eventId)}><th scope="row">{event.event.name}<small>{event.event.room || "Area not listed"}</small></th>
        <td>{event.foodRunners?.join(", ") || event.foodRunnerOrBwa || "Unassigned"}</td><td>{event.pocs?.join(", ") || "Unassigned"}</td><td>{progress.prepped}/{progress.total}</td><td>{progress.ready}/{progress.total}</td></tr>;
    })}</tbody></table></div>
  </section>;
}

export function FoodDeliveryPanel({ items, error, events = [] }: { items: EventFoodDelivery[]; error?: string | null; events?: KitchenChecklist[] }) {
  return <details className="kitchen-operations-panel food-delivery-panel"><summary>Food-order delivery · {items.filter((item) => eventFoodDeliveryState(item).accepted).length} GoTab accepted · {items.filter((item) => eventFoodDeliveryState(item).tone === "warning").length} need review</summary>
    <p>These are saved order results, not proof that a person saw the physical KDS. Check the order reference before retrying an uncertain delivery.</p>
    {error ? <p role="alert">{error}</p> : null}
    <div className="kitchen-operations-scroll"><table><thead><tr><th>Event / area</th><th>Item</th><th>Ordered quantity</th><th>GoTab status</th><th>Order reference</th><th>Last update</th></tr></thead><tbody>
      {items.map((item) => {
        const event = events.find((event) => String(event.event.eventId) === item.eventId);
        return <tr key={item.requestId}><th scope="row">{event?.event.name ?? "Event details not loaded"}<small>{event?.event.room ?? "Area not listed"}</small></th><td>{item.foodName}<small>{item.panSize === "HALF_PAN" ? "1/2 pan" : item.panSize === "THIRD_PAN" ? "1/3 pan" : ""}</small></td><td>{item.quantity}</td><td>{eventFoodDeliveryState(item).label}</td><td>{item.orderReference ?? "Not yet available"}</td><td>{clock(item.acceptedAt ?? (item.updatedAt || null))}</td></tr>;
      })}
    </tbody></table></div>
    {!items.length && !error ? <p>No food-order delivery records for this selection.</p> : null}
  </details>;
}
