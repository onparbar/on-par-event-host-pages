"use client";

import { useEffect, useState } from "react";
import { nextPortalConnectivityState, portalConnectivityNotice, type PortalConnectivityState } from "@/lib/operations/connectivity";

/** Read-only warning. This component never queues, retries, or replays writes. */
export function ConnectivityBanner() {
  const [state, setState] = useState<PortalConnectivityState>("unknown");
  useEffect(() => {
    const update = () => setState((previous) => nextPortalConnectivityState(previous, navigator.onLine));
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const notice = portalConnectivityNotice(state);
  if (!notice) return null;
  return <div className={`portal-connectivity-notice is-${state}`} role={notice.role}>{notice.message}</div>;
}
