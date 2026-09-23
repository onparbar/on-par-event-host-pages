import { afterEach, describe, expect, it, vi } from "vitest";
import {
  broadcastEntertainmentUpdate,
  ENTERTAINMENT_UPDATE_CHANNEL,
} from "../live-updates";

afterEach(() => vi.unstubAllGlobals());

describe("entertainment live update notifications", () => {
  it("broadcasts the saved action and operating date, then closes the channel", () => {
    const messages: unknown[] = [];
    const close = vi.fn();
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor(name: string) {
          expect(name).toBe(ENTERTAINMENT_UPDATE_CHANNEL);
        }
        postMessage(message: unknown) {
          messages.push(message);
        }
        close() {
          close();
        }
      },
    );

    broadcastEntertainmentUpdate("update", "2026-08-07");

    expect(messages).toEqual([
      { action: "update", date: "2026-08-07" },
    ]);
    expect(close).toHaveBeenCalledOnce();
  });
});
