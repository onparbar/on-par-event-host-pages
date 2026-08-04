import { getSupabaseSecret } from "@/lib/kitchen/storage";
import type {
  FloorPlanDocument,
  FloorPlanRevision,
} from "./types";

const DEFAULT_SUPABASE_URL = "https://tmnstuthbllnoqgepotn.supabase.co";

type StorageOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};

export interface FloorPlanStorage {
  readonly persistence: "database" | "memory";
  get(date: string): Promise<FloorPlanDocument | null>;
  save(
    plan: FloorPlanDocument,
    description: string,
  ): Promise<FloorPlanDocument>;
  revisions(planId: string): Promise<FloorPlanRevision[]>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isJwt(value: string) {
  return /^eyJ[^.]*\.[^.]+\.[^.]+$/.test(value);
}

export class SupabaseFloorPlanStorage implements FloorPlanStorage {
  readonly persistence = "database" as const;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;

  constructor(options: StorageOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async rpc<T>(name: string, body: Record<string, unknown>) {
    const secret = getSupabaseSecret(this.env);
    if (!secret) throw new Error("Floor-plan database access is not configured.");
    const baseUrl = (this.env.SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
    const headers = new Headers({ apikey: secret, "content-type": "application/json" });
    if (isJwt(secret)) headers.set("authorization", `Bearer ${secret}`);
    const response = await this.fetchImpl(`${baseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Floor-plan database request failed (${response.status}).`);
    }
    return response.json() as Promise<T>;
  }

  async get(date: string) {
    return this.rpc<FloorPlanDocument | null>("event_host_floor_plan_document", {
      p_event_date: date,
    });
  }

  async save(plan: FloorPlanDocument, description: string) {
    return this.rpc<FloorPlanDocument>("save_event_host_floor_plan", {
      p_document: plan,
      p_changed_by: "authenticated-event-host-staff",
      p_description: description.slice(0, 500),
    });
  }

  async revisions(planId: string) {
    return this.rpc<FloorPlanRevision[]>("event_host_floor_plan_revisions", {
      p_floor_plan_id: planId,
    });
  }
}

export class MemoryFloorPlanStorage implements FloorPlanStorage {
  readonly persistence = "memory" as const;
  private readonly plans = new Map<string, FloorPlanDocument>();
  private readonly history = new Map<string, FloorPlanRevision[]>();

  async get(date: string) {
    return clone(this.plans.get(date) ?? null);
  }

  async save(requested: FloorPlanDocument, description: string) {
    const previous = this.plans.get(requested.eventDate) ?? null;
    const now = new Date().toISOString();
    const plan = {
      ...clone(requested),
      version: previous ? previous.version + 1 : Math.max(1, requested.version),
      createdAt: previous?.createdAt ?? requested.createdAt ?? now,
      updatedAt: now,
    };
    this.plans.set(plan.eventDate, plan);
    const revisions = this.history.get(plan.id) ?? [];
    revisions.unshift({
      id: `${plan.id}:${plan.version}`,
      floorPlanId: plan.id,
      version: plan.version,
      changedAt: now,
      changedBy: "authenticated-event-host-staff",
      description,
      previousValue: clone(previous),
      newValue: clone(plan),
    });
    this.history.set(plan.id, revisions);
    return clone(plan);
  }

  async revisions(planId: string) {
    return clone(this.history.get(planId) ?? []);
  }
}

let memoryStorage: MemoryFloorPlanStorage | null = null;

export function getFloorPlanStorage(
  options: StorageOptions = {},
): FloorPlanStorage {
  const env = options.env ?? process.env;
  if (getSupabaseSecret(env)) return new SupabaseFloorPlanStorage(options);
  memoryStorage ??= new MemoryFloorPlanStorage();
  return memoryStorage;
}
