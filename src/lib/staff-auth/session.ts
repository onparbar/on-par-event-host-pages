import "server-only";
import { isOpaqueId, staffBridge, type StaffBridge } from "./protocol";
import { findStaffSession, revokeStaffSession } from "./storage";

export type StaffIdentity = { employeeId: string; name: string };

export async function verifyStaffIdentity(employeeId: string, staffSession: string, bridge: StaffBridge): Promise<StaffIdentity | null> {
  const response = await fetch(new URL("/api/event-host/identity", bridge.issuer), {
    method: "POST",
    headers: { authorization: `Bearer ${bridge.secret}`, "content-type": "application/json" },
    body: JSON.stringify({ employeeId, staffSession }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    if (response.status === 404 || response.status === 410) return null;
    throw new Error("Staff identity could not be verified.");
  }
  const data = await response.json() as Partial<StaffIdentity> & { active?: boolean };
  if (data?.employeeId === employeeId && data.active === false) return null;
  if (data?.employeeId !== employeeId || data.active !== true || typeof data.name !== "string" || !data.name.trim() || data.name.length > 120) {
    throw new Error("Staff identity could not be verified.");
  }
  return { employeeId, name: data.name.trim() };
}

export async function readStaffSession(token: string | undefined): Promise<StaffIdentity | null> {
  const bridge = staffBridge();
  if (!bridge || !isOpaqueId(token)) return null;
  try {
    const session = await findStaffSession(token);
    if (!session) return null;
    const identity = await verifyStaffIdentity(session.employeeId, session.staffSession, bridge);
    if (!identity) await revokeStaffSession(token);
    return identity;
  } catch { return null; }
}
