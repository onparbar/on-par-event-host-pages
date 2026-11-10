import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const STAFF_COOKIE = "event-host-staff-session";
export const HANDOFF_COOKIE = "event-host-staff-handoff";
export const SESSION_SECONDS = 8 * 60 * 60;
const STATE_SECONDS = 10 * 60;
const ASSERTION_SECONDS = 60;
const RANDOM_ID = /^[\w-]{43}$/;
const EMPLOYEE_ID = /^[1-9]\d{0,15}$/;

export type StaffBridge = { issuer: string; audience: string; secret: string };
export type Handoff = { iss: string; aud: string; sub: string; staffSession: string; state: string; jti: string; iat: number; exp: number };

export function staffLoginRequired(env = process.env) {
  return env.EVENT_HOST_STAFF_LOGIN_REQUIRED === "true";
}

function exactOrigin(value: string | undefined, local: boolean) {
  try {
    const url = new URL(value ?? "");
    if (url.hostname.endsWith(".") || url.origin !== value || (url.protocol !== "https:" && !(local && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) return null;
    return url.origin;
  } catch { return null; }
}

export function staffBridge(env = process.env): StaffBridge | null {
  const local = env.NODE_ENV !== "production";
  const issuer = exactOrigin(env.STAFF_TOOLS_ORIGIN, local);
  const audience = exactOrigin(env.EVENT_HOST_ORIGIN, local);
  const secret = env.STAFF_TOOLS_HANDOFF_SECRET?.trim();
  if (env.VERCEL_ENV === "preview" && ((issuer && new URL(issuer).hostname === "on-par.vercel.app") ||
      (audience && new URL(audience).hostname === "eventhost-opal.vercel.app"))) return null;
  return issuer && audience && issuer !== audience && secret && secret.length >= 32 ? { issuer, audience, secret } : null;
}

export function eventHostOrigin(env = process.env) {
  return exactOrigin(env.EVENT_HOST_ORIGIN, env.NODE_ENV !== "production");
}

export const opaqueId = () => randomBytes(32).toString("base64url");
export const isOpaqueId = (value: unknown): value is string => typeof value === "string" && RANDOM_ID.test(value);
export const isEmployeeId = (value: unknown): value is string => typeof value === "string" && EMPLOYEE_ID.test(value);
export const isStaffSessionProof = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 1024 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value);
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function authorizedStaffBridgeRequest(authorization: string | null, bridge: StaffBridge) {
  if (!authorization) return false;
  const received = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${bridge.secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function signature(namespace: string, payload: string, secret: string) {
  return createHmac("sha256", secret).update(namespace + ":" + payload).digest("base64url");
}

function unpack(token: string, namespace: string, secret: string): unknown {
  if (token.length > 2048 || !/^[\w-]+\.[\w-]{43}$/.test(token)) return null;
  const [data, sig] = token.split(".");
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(signature(namespace, data, secret)))) return null;
  try { return JSON.parse(Buffer.from(data, "base64url").toString("utf8")); } catch { return null; }
}

function pack(namespace: string, data: object, secret: string) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return payload + "." + signature(namespace, payload, secret);
}

export function makeHandoffState(bridge: StaffBridge, now = Date.now()) {
  const state = opaqueId();
  const exp = Math.floor(now / 1000) + STATE_SECONDS;
  return { state, cookie: pack("event-host-state-v1", { state, exp }, bridge.secret), maxAge: STATE_SECONDS };
}

export function verifyHandoff(assertion: string, stateCookie: string, bridge: StaffBridge, now = Date.now()): Handoff | null {
  const clock = Math.floor(now / 1000);
  const state = unpack(stateCookie, "event-host-state-v1", bridge.secret) as { state?: unknown; exp?: number } | null;
  const data = unpack(assertion, "event-host-handoff-v1", bridge.secret) as Partial<Handoff> | null;
  if (!state || !isOpaqueId(state.state) || !Number.isSafeInteger(state.exp) || state.exp! <= clock) return null;
  if (!data || data.iss !== bridge.issuer || data.aud !== bridge.audience || data.state !== state.state ||
      !isEmployeeId(data.sub) || !isStaffSessionProof(data.staffSession) || !isOpaqueId(data.jti) || !Number.isSafeInteger(data.iat) || !Number.isSafeInteger(data.exp) ||
      data.iat! > clock + 5 || data.exp! <= clock || data.exp! <= data.iat! || data.exp! - data.iat! > ASSERTION_SECONDS) return null;
  return data as Handoff;
}

/** Used by the Staff Tools issuer and the local cross-origin contract test. */
export function signHandoff(bridge: StaffBridge, employeeId: string, state: string, staffSession: string, now = Date.now()) {
  if (!isEmployeeId(employeeId) || !isOpaqueId(state) || !isStaffSessionProof(staffSession)) throw new Error("Invalid handoff identity, session or state.");
  const iat = Math.floor(now / 1000);
  return pack("event-host-handoff-v1", { iss: bridge.issuer, aud: bridge.audience, sub: employeeId, staffSession, state,
    jti: opaqueId(), iat, exp: iat + ASSERTION_SECONDS }, bridge.secret);
}
