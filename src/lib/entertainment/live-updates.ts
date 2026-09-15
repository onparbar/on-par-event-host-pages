export const ENTERTAINMENT_UPDATE_CHANNEL = "event-host-entertainment";

export type EntertainmentUpdateAction =
  | "create"
  | "remove"
  | "revert"
  | "sync"
  | "update";

export function broadcastEntertainmentUpdate(
  action: EntertainmentUpdateAction,
  date: string,
) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(ENTERTAINMENT_UPDATE_CHANNEL);
  channel.postMessage({ action, date });
  channel.close();
}
