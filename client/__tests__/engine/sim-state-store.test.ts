// sim-state-store.test.ts
// Tests for the renamed SimStateStore (was ConversationStore) and the new
// throttle state methods added as part of the throttle_traffic redesign.
// All tests below for SimStateStore — throttle section are NEW and must fail
// until the rename + throttle methods are implemented.

import { describe, it, expect, beforeEach } from "vitest";
import {
  createSimStateStore,
  type SimStateStoreSnapshot,
} from "../../src/engine/sim-state-store";
import {
  buildChatMessage,
  buildEmail,
  buildTicket,
  buildTicketComment,
  buildLogEntry,
  buildAlarm,
  buildDeployment,
  resetIdCounter,
} from "../../src/testutil/index";
import type { ActiveThrottle } from "@shared/types/events";

beforeEach(() => resetIdCounter());

// ── Chat (unchanged from ConversationStore) ───────────────────────────────────

describe("SimStateStore — chat", () => {
  it("addChatMessage adds to correct channel", () => {
    const store = createSimStateStore();
    const msg = buildChatMessage({ channel: "#incidents" });
    store.addChatMessage("#incidents", msg);
    expect(store.getChatChannel("#incidents").length).toBe(1);
  });

  it("getChatChannel on unknown channel returns empty array", () => {
    expect(createSimStateStore().getChatChannel("#unknown")).toEqual([]);
  });

  it("messages in different channels are independent", () => {
    const store = createSimStateStore();
    store.addChatMessage(
      "#incidents",
      buildChatMessage({ channel: "#incidents" }),
    );
    expect(store.getChatChannel("#general").length).toBe(0);
  });

  it("getChatChannel returns a copy — mutations do not affect the store", () => {
    const store = createSimStateStore();
    store.addChatMessage("#incidents", buildChatMessage());
    const copy = store.getChatChannel("#incidents");
    copy.push(buildChatMessage({ text: "injected" }));
    expect(store.getChatChannel("#incidents").length).toBe(1);
  });
});

// ── Snapshot (unchanged) ──────────────────────────────────────────────────────

describe("SimStateStore — snapshot", () => {
  it("snapshot is a deep copy — mutations do not affect store", () => {
    const store = createSimStateStore();
    store.addChatMessage("#inc", buildChatMessage({ channel: "#inc" }));
    const snap = store.snapshot();
    snap.chatChannels["#inc"].push(
      buildChatMessage({ channel: "#inc", text: "injected" }),
    );
    expect(store.getChatChannel("#inc").length).toBe(1);
  });

  it("snapshot includes throttles field", () => {
    const store = createSimStateStore();
    const snap: SimStateStoreSnapshot = store.snapshot();
    expect(Array.isArray(snap.throttles)).toBe(true);
  });
});

// ── Throttles (NEW) ───────────────────────────────────────────────────────────

describe("SimStateStore — throttles", () => {
  function makeThrottle(
    overrides: Partial<ActiveThrottle> = {},
  ): ActiveThrottle {
    return {
      remediationActionId: "throttle_payment",
      targetId: "checkout",
      scope: "endpoint",
      label: "POST /v1/charges",
      unit: "rps",
      limitRate: 80,
      appliedAtSimTime: 120,
      customerId: undefined,
      ...overrides,
    };
  }

  it("applyThrottle adds a throttle entry", () => {
    const store = createSimStateStore();
    store.applyThrottle(makeThrottle());
    expect(store.getAllThrottles().length).toBe(1);
  });

  it("applyThrottle replaces an existing throttle for the same targetId", () => {
    const store = createSimStateStore();
    store.applyThrottle(makeThrottle({ limitRate: 80, appliedAtSimTime: 100 }));
    store.applyThrottle(makeThrottle({ limitRate: 50, appliedAtSimTime: 200 }));
    const throttles = store.getAllThrottles();
    expect(throttles.length).toBe(1);
    expect(throttles[0].limitRate).toBe(50);
    expect(throttles[0].appliedAtSimTime).toBe(200);
  });

  it("applyThrottle with customerId keeps separate entries per customerId", () => {
    const store = createSimStateStore();
    store.applyThrottle(
      makeThrottle({
        targetId: "per_customer",
        customerId: "acme_corp",
        limitRate: 100,
      }),
    );
    store.applyThrottle(
      makeThrottle({
        targetId: "per_customer",
        customerId: "globex",
        limitRate: 60,
      }),
    );
    expect(store.getAllThrottles().length).toBe(2);
  });

  it("applyThrottle with same targetId + customerId replaces existing", () => {
    const store = createSimStateStore();
    store.applyThrottle(
      makeThrottle({
        targetId: "per_customer",
        customerId: "acme_corp",
        limitRate: 100,
      }),
    );
    store.applyThrottle(
      makeThrottle({
        targetId: "per_customer",
        customerId: "acme_corp",
        limitRate: 60,
      }),
    );
    const throttles = store.getAllThrottles();
    expect(throttles.length).toBe(1);
    expect(throttles[0].limitRate).toBe(60);
  });

  it("removeThrottle removes the correct entry by targetId", () => {
    const store = createSimStateStore();
    store.applyThrottle(makeThrottle({ targetId: "checkout" }));
    store.applyThrottle(makeThrottle({ targetId: "global" }));
    store.removeThrottle("checkout", undefined);
    const throttles = store.getAllThrottles();
    expect(throttles.length).toBe(1);
    expect(throttles[0].targetId).toBe("global");
  });

  it("removeThrottle with customerId removes only that customer entry", () => {
    const store = createSimStateStore();
    store.applyThrottle(
      makeThrottle({ targetId: "per_customer", customerId: "acme_corp" }),
    );
    store.applyThrottle(
      makeThrottle({ targetId: "per_customer", customerId: "globex" }),
    );
    store.removeThrottle("per_customer", "acme_corp");
    const throttles = store.getAllThrottles();
    expect(throttles.length).toBe(1);
    expect(throttles[0].customerId).toBe("globex");
  });

  it("removeThrottle on non-existent targetId is a no-op", () => {
    const store = createSimStateStore();
    expect(() => store.removeThrottle("nonexistent", undefined)).not.toThrow();
  });

  it("getAllThrottles returns copies — mutations do not affect store", () => {
    const store = createSimStateStore();
    store.applyThrottle(makeThrottle());
    const all = store.getAllThrottles();
    all[0].limitRate = 9999;
    expect(store.getAllThrottles()[0].limitRate).toBe(80);
  });

  it("getThrottle returns the active throttle for a targetId + customerId", () => {
    const store = createSimStateStore();
    store.applyThrottle(makeThrottle({ targetId: "checkout", limitRate: 80 }));
    const t = store.getThrottle("checkout", undefined);
    expect(t).not.toBeNull();
    expect(t!.limitRate).toBe(80);
  });

  it("getThrottle returns null when no throttle active", () => {
    const store = createSimStateStore();
    expect(store.getThrottle("checkout", undefined)).toBeNull();
  });

  it("snapshot includes all active throttles", () => {
    const store = createSimStateStore();
    store.applyThrottle(makeThrottle({ targetId: "checkout" }));
    store.applyThrottle(makeThrottle({ targetId: "global" }));
    const snap = store.snapshot();
    expect(snap.throttles.length).toBe(2);
  });

  it("snapshot throttles are deep copies", () => {
    const store = createSimStateStore();
    store.applyThrottle(makeThrottle({ limitRate: 80 }));
    const snap = store.snapshot();
    snap.throttles[0].limitRate = 9999;
    expect(store.getAllThrottles()[0].limitRate).toBe(80);
  });
});
