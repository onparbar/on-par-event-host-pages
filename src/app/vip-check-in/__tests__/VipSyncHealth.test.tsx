import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({ health: vi.fn(), loading: vi.fn(), error: vi.fn() }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [initial, initial === null ? state.health : initial === false ? state.loading : state.error],
}));
import VipSyncHealth from "../VipSyncHealth";

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

function button() {
  const tree = VipSyncHealth({ date: "2026-11-14", reservationId: "sanitized-vip" });
  const children = tree.props.children as ReactElement<{ onClick?: () => void }>[];
  return children.find((child) => child?.type === "button")!;
}

describe("view verification does not retain stale green results", () => {
  it("clears prior health before the read and leaves it cleared if a later verification fails", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: "VIP view verification could not be completed." }, { status: 502 }));
    vi.stubGlobal("fetch", fetch);
    button().props.onClick!();
    expect(state.health).toHaveBeenCalledExactlyOnceWith(null);
    expect(state.loading).toHaveBeenCalledWith(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(state.health).toHaveBeenCalledExactlyOnceWith(null);
    expect(state.error).toHaveBeenLastCalledWith("VIP view verification could not be completed.");
    expect(state.loading).toHaveBeenLastCalledWith(false);
  });

  it("replaces cleared health only after a successful no-store verification response", async () => {
    const health = { sourceEventId: "vip-sanitized-vip", sourceFound: true };
    const fetch = vi.fn().mockResolvedValue(Response.json({ health }));
    vi.stubGlobal("fetch", fetch);
    button().props.onClick!();
    expect(state.health).toHaveBeenCalledWith(null);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/vip-checkin/health?date=2026-11-14&reservationId=sanitized-vip", { cache: "no-store" });
    expect(state.health).toHaveBeenLastCalledWith(health);
  });
});
