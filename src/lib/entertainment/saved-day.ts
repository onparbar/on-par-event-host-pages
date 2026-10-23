import { detectEntertainmentConflicts } from "./domain";
import { getEntertainmentStorage, type EntertainmentStorage } from "./storage";
import { getTripleseatAdapter } from "@/lib/kitchen/tripleseat";
import type { EntertainmentDayPayload } from "./types";

/** Projection only: opening an itinerary must not sync or create reservations. */
export async function readSavedEntertainmentDay(date: string, storage: Pick<EntertainmentStorage, "getDay"> = getEntertainmentStorage()): Promise<EntertainmentDayPayload> {
  const stored = await storage.getDay(date);
  return {
    ...stored,
    conflicts: detectEntertainmentConflicts(stored.reservations),
    sourceMode: getTripleseatAdapter().sourceMode,
    warnings: stored.sync?.status === "error" ? ["The latest entertainment sync failed. This is the last saved schedule."] : [],
    missingEnvironmentVariables: [],
    canEdit: false,
  };
}
