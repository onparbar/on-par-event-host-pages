export type PortalConnectivityState = "unknown" | "online" | "offline" | "restored";

/** Browser connectivity is a hint, not confirmation that any write was saved. */
export function nextPortalConnectivityState(previous: PortalConnectivityState, online: boolean): PortalConnectivityState {
  if (!online) return "offline";
  return previous === "offline" || previous === "restored" ? "restored" : "online";
}

export function portalConnectivityNotice(state: PortalConnectivityState) {
  if (state === "offline") return {
    role: "alert" as const,
    message: "Offline—displayed information may be outdated; changes are not confirmed. Do not resubmit an uncertain food order.",
  };
  if (state === "restored") return {
    role: "status" as const,
    message: "Connection restored—refresh to verify latest saved data.",
  };
  return null;
}
