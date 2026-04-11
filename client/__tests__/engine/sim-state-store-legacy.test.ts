import { describe, it, expect, beforeEach } from "vitest";
import { createSimStateStore } from "../../src/engine/sim-state-store";
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

beforeEach(() => resetIdCounter());

describe("SimStateStore — chat", () => {
  it("addChatMessage adds to correct channel", () => {
    const store = createSimStateStore();
    const msg = buildChatMessage({ channel: "#incidents" });
    store.addChatMessage("#incidents", msg);
    expect(store.getChatChannel("#incidents").length).toBe(1);
  });

  it("getChatChannel returns messages in insertion order", () => {
    const store = createSimStateStore();
    const a = buildChatMessage({ channel: "#incidents", text: "first" });
    const b = buildChatMessage({ channel: "#incidents", text: "second" });
    store.addChatMessage("#incidents", a);
    store.addChatMessage("#incidents", b);
    const msgs = store.getChatChannel("#incidents");
    expect(msgs[0].text).toBe("first");
    expect(msgs[1].text).toBe("second");
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

  it("getAllChatChannels returns all channels", () => {
    const store = createSimStateStore();
    store.addChatMessage("#incidents", buildChatMessage());
    store.addChatMessage("#general", buildChatMessage());
    const all = store.getAllChatChannels();
    expect(Object.keys(all).sort()).toEqual(["#general", "#incidents"]);
  });
});

describe("SimStateStore — email", () => {
  it("addEmail stored and retrievable by threadId", () => {
    const store = createSimStateStore();
    const email = buildEmail({ threadId: "thread-x" });
    store.addEmail(email);
    expect(store.getEmailThread("thread-x").length).toBe(1);
  });

  it("getAllEmails returns all emails", () => {
    const store = createSimStateStore();
    store.addEmail(buildEmail({ threadId: "a" }));
    store.addEmail(buildEmail({ threadId: "b" }));
    expect(store.getAllEmails().length).toBe(2);
  });

  it("emails in same thread grouped correctly", () => {
    const store = createSimStateStore();
    store.addEmail(buildEmail({ threadId: "thread-1" }));
    store.addEmail(buildEmail({ threadId: "thread-1" }));
    store.addEmail(buildEmail({ threadId: "thread-2" }));
    expect(store.getEmailThread("thread-1").length).toBe(2);
    expect(store.getEmailThread("thread-2").length).toBe(1);
  });
});

describe("SimStateStore — tickets", () => {
  it("addTicket stored and retrievable", () => {
    const store = createSimStateStore();
    const ticket = buildTicket({ id: "ticket-001" });
    store.addTicket(ticket);
    expect(store.getTicket("ticket-001")).not.toBeNull();
    expect(store.getTicket("ticket-001")!.id).toBe("ticket-001");
  });

  it("updateTicket merges changes — does not replace entire ticket", () => {
    const store = createSimStateStore();
    const ticket = buildTicket({
      id: "ticket-001",
      severity: "SEV2",
      status: "open",
    });
    store.addTicket(ticket);
    store.updateTicket("ticket-001", { status: "in_progress" });
    const updated = store.getTicket("ticket-001")!;
    expect(updated.status).toBe("in_progress");
    expect(updated.severity).toBe("SEV2");
  });

  it("updateTicket on non-existent ticket is a no-op", () => {
    expect(() =>
      createSimStateStore().updateTicket("ghost", { status: "resolved" }),
    ).not.toThrow();
  });

  it("addTicketComment stored under correct ticketId", () => {
    const store = createSimStateStore();
    const ticket = buildTicket({ id: "ticket-001" });
    store.addTicket(ticket);
    const comment = buildTicketComment("ticket-001");
    store.addTicketComment("ticket-001", comment);
    expect(store.getTicketComments("ticket-001").length).toBe(1);
  });

  it("getAllTickets returns all tickets", () => {
    const store = createSimStateStore();
    store.addTicket(buildTicket({ id: "t1" }));
    store.addTicket(buildTicket({ id: "t2" }));
    expect(store.getAllTickets().length).toBe(2);
  });
});

describe("SimStateStore — logs", () => {
  it("addLogEntry stored and retrievable", () => {
    const store = createSimStateStore();
    store.addLogEntry(buildLogEntry());
    expect(store.getAllLogs().length).toBe(1);
  });

  it("logs in insertion order", () => {
    const store = createSimStateStore();
    store.addLogEntry(buildLogEntry({ message: "first" }));
    store.addLogEntry(buildLogEntry({ message: "second" }));
    const logs = store.getAllLogs();
    expect(logs[0].message).toBe("first");
    expect(logs[1].message).toBe("second");
  });
});

describe("SimStateStore — alarms", () => {
  it("addAlarm stores with status=firing", () => {
    const store = createSimStateStore();
    store.addAlarm(buildAlarm({ id: "a1", status: "firing" }));
    const alarms = store.getAllAlarms();
    expect(alarms.length).toBe(1);
    expect(alarms[0].status).toBe("firing");
  });

  it("updateAlarmStatus changes status only", () => {
    const store = createSimStateStore();
    store.addAlarm(
      buildAlarm({ id: "a1", severity: "SEV2", status: "firing" }),
    );
    store.updateAlarmStatus("a1", "acknowledged");
    const alarms = store.getAllAlarms();
    expect(alarms[0].status).toBe("acknowledged");
    expect(alarms[0].severity).toBe("SEV2");
  });
});

describe("SimStateStore — deployments", () => {
  it("addDeployment stored per service", () => {
    const store = createSimStateStore();
    store.addDeployment("svc-a", buildDeployment({ version: "v1.0.0" }));
    store.addDeployment("svc-a", buildDeployment({ version: "v1.0.1" }));
    store.addDeployment("svc-b", buildDeployment({ version: "v2.0.0" }));
    expect(store.getDeployments("svc-a").length).toBe(2);
    expect(store.getDeployments("svc-b").length).toBe(1);
    expect(store.getDeployments("svc-c").length).toBe(0);
  });

  it("getAllDeployments returns all services", () => {
    const store = createSimStateStore();
    store.addDeployment("svc-a", buildDeployment());
    store.addDeployment("svc-b", buildDeployment());
    const all = store.getAllDeployments();
    expect(Object.keys(all).sort()).toEqual(["svc-a", "svc-b"]);
  });
});

describe("SimStateStore — snapshot", () => {
  it("snapshot returns all state", () => {
    const store = createSimStateStore();
    store.addChatMessage("#inc", buildChatMessage({ channel: "#inc" }));
    store.addEmail(buildEmail());
    store.addTicket(buildTicket({ id: "t1" }));
    store.addLogEntry(buildLogEntry());
    store.addAlarm(buildAlarm({ id: "a1" }));
    store.addDeployment("svc", buildDeployment());
    const snap = store.snapshot();
    expect(Object.keys(snap.chatChannels)).toContain("#inc");
    expect(snap.emails.length).toBe(1);
    expect(snap.tickets.length).toBe(1);
    expect(snap.logs.length).toBe(1);
    expect(snap.alarms.length).toBe(1);
    expect(snap.deployments["svc"].length).toBe(1);
  });

  it("snapshot is a deep copy — mutations to snapshot do not affect store", () => {
    const store = createSimStateStore();
    store.addChatMessage("#inc", buildChatMessage({ channel: "#inc" }));
    const snap = store.snapshot();
    snap.chatChannels["#inc"].push(
      buildChatMessage({ channel: "#inc", text: "injected" }),
    );
    expect(store.getChatChannel("#inc").length).toBe(1);
  });

  it("ticket comments included in snapshot", () => {
    const store = createSimStateStore();
    store.addTicket(buildTicket({ id: "ticket-001" }));
    store.addTicketComment("ticket-001", buildTicketComment("ticket-001"));
    const snap = store.snapshot();
    expect(snap.ticketComments["ticket-001"].length).toBe(1);
  });
});
