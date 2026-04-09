import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { SessionProvider, useSession } from "../../src/context/SessionContext";
import {
  buildTestSnapshot,
  buildChatMessage,
  buildEmail,
  buildTicket,
  buildTicketComment,
  buildLogEntry,
  buildAlarm,
  buildDeployment,
  buildCoachMessage,
  buildMockGameLoop,
  buildLoadedScenario,
  resetIdCounter,
} from "../../src/testutil/index";
import type { MockGameLoop } from "../../src/testutil/index";
import type { SimEvent, PageAlert } from "@shared/types/events";
import { server } from "../../src/testutil/setup";
import { http, HttpResponse } from "msw";

// ── Helper ─────────────────────────────────────────────────────────────────────

interface TestProviderProps {
  mockLoop?: MockGameLoop;
  onExpired?: () => void;
  onDebrief?: () => void;
  onError?: (msg: string) => void;
  children: React.ReactNode;
}

function makeWrapper(opts: Omit<TestProviderProps, "children"> = {}) {
  const mockLoop = opts.mockLoop ?? buildMockGameLoop();
  const scenario = buildLoadedScenario();
  return {
    mockLoop,
    Wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <SessionProvider
          scenario={scenario}
          _testGameLoop={mockLoop}
          onExpired={opts.onExpired ?? vi.fn()}
          onDebriefReady={opts.onDebrief ?? vi.fn()}
          onError={opts.onError ?? vi.fn()}
        >
          {children}
        </SessionProvider>
      );
    },
  };
}

beforeEach(() => {
  resetIdCounter();
});

describe("SessionContext", () => {
  describe("initial state", () => {
    it("connected=false before session_snapshot", () => {
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      expect(result.current.state.connected).toBe(false);
    });

    it("status=active before session_expired", () => {
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      expect(result.current.state.status).toBe("active");
    });
  });

  describe("session_snapshot", () => {
    it("populates state and sets connected=true", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ simTime: 42 }),
        });
      });
      expect(result.current.state.connected).toBe(true);
      expect(result.current.state.simTime).toBe(42);
    });

    it("populates snapshot.pages", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      const page: PageAlert = {
        id: "p1",
        personaId: "fp",
        message: "help",
        simTime: 5,
      };
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ pages: [page] }),
        });
      });
      expect(result.current.state.pages).toHaveLength(1);
    });
  });

  describe("sim_time", () => {
    it("updates simTime/speed/paused — does NOT wipe other state", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ emails: [buildEmail()] }),
        });
      });
      act(() => {
        mockLoop.emit({
          type: "sim_time",
          simTime: 300,
          speed: 5,
          paused: false,
        });
      });
      expect(result.current.state.simTime).toBe(300);
      expect(result.current.state.speed).toBe(5);
      expect(result.current.state.emails).toHaveLength(1);
    });

    it("paused=true reflected", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({ type: "sim_time", simTime: 0, speed: 1, paused: true });
      });
      expect(result.current.state.paused).toBe(true);
    });
  });

  describe("chat_message", () => {
    it("appends to correct channel", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      const msg = buildChatMessage({ channel: "#incidents" });
      act(() => {
        mockLoop.emit({
          type: "chat_message",
          channel: "#incidents",
          message: msg,
        });
      });
      expect(result.current.state.chatMessages["#incidents"]).toHaveLength(1);
    });

    it("does not affect other channels", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        mockLoop.emit({
          type: "chat_message",
          channel: "#incidents",
          message: buildChatMessage(),
        });
      });
      expect(result.current.state.chatMessages["#other"]).toBeUndefined();
    });

    it("creates array for new channel", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        mockLoop.emit({
          type: "chat_message",
          channel: "dm:new-persona",
          message: buildChatMessage(),
        });
      });
      expect(result.current.state.chatMessages["dm:new-persona"]).toHaveLength(
        1,
      );
    });
  });

  describe("email_received", () => {
    it("appends to emails array", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        mockLoop.emit({ type: "email_received", email: buildEmail() });
      });
      expect(result.current.state.emails).toHaveLength(1);
    });

    it("suppresses server echo of trainee reply (same body/threadId within 5s)", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      const reply = buildEmail({
        from: "trainee",
        threadId: "thread-1",
        body: "body",
        simTime: 10,
      });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ emails: [reply] }),
        });
      });
      act(() => {
        mockLoop.emit({
          type: "email_received",
          email: { ...reply, id: "echo-id", simTime: 13 },
        });
      });
      expect(result.current.state.emails).toHaveLength(1);
    });

    it("does NOT suppress if body differs", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      const reply = buildEmail({
        from: "trainee",
        threadId: "thread-1",
        body: "original",
        simTime: 10,
      });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ emails: [reply] }),
        });
      });
      act(() => {
        mockLoop.emit({
          type: "email_received",
          email: { ...reply, id: "new", body: "different", simTime: 11 },
        });
      });
      expect(result.current.state.emails).toHaveLength(2);
    });
  });

  describe("log_entry", () => {
    it("appends to logs array", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        mockLoop.emit({ type: "log_entry", entry: buildLogEntry() });
      });
      expect(result.current.state.logs).toHaveLength(1);
    });
  });

  describe("alarm_fired", () => {
    it("appends to alarms array", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        mockLoop.emit({ type: "alarm_fired", alarm: buildAlarm() });
      });
      expect(result.current.state.alarms).toHaveLength(1);
    });
  });

  describe("alarm_silenced", () => {
    it("sets correct alarm status to suppressed", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      const a1 = buildAlarm({ id: "a1", status: "firing" });
      const a2 = buildAlarm({ id: "a2", status: "firing" });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ alarms: [a1, a2] }),
        });
      });
      act(() => {
        mockLoop.emit({ type: "alarm_silenced", alarmId: "a1" });
      });
      expect(
        result.current.state.alarms.find((a) => a.id === "a1")!.status,
      ).toBe("suppressed");
      expect(
        result.current.state.alarms.find((a) => a.id === "a2")!.status,
      ).toBe("firing");
    });
  });

  describe("alarm_acknowledged", () => {
    it("sets correct alarm status to acknowledged", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      const alarm = buildAlarm({ id: "alm-1", status: "firing" });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ alarms: [alarm] }),
        });
      });
      act(() => {
        mockLoop.emit({
          type: "alarm_acknowledged" as SimEvent["type"],
          alarmId: "alm-1",
        } as SimEvent);
      });
      expect(result.current.state.alarms[0].status).toBe("acknowledged");
    });
  });

  describe("ticket_created", () => {
    it("appends to tickets array", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        mockLoop.emit({ type: "ticket_created", ticket: buildTicket() });
      });
      expect(result.current.state.tickets).toHaveLength(1);
    });
  });

  describe("ticket_updated", () => {
    it("merges changes into existing ticket (not replaced)", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      const t = buildTicket({
        id: "t1",
        status: "open",
        severity: "SEV2",
        title: "Original",
      });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ tickets: [t] }),
        });
      });
      act(() => {
        mockLoop.emit({
          type: "ticket_updated",
          ticketId: "t1",
          changes: { status: "in_progress" },
        });
      });
      const updated = result.current.state.tickets[0];
      expect(updated.status).toBe("in_progress");
      expect(updated.title).toBe("Original");
      expect(updated.severity).toBe("SEV2");
    });

    it("does not affect other tickets", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      const t1 = buildTicket({ id: "t1", status: "open" });
      const t2 = buildTicket({ id: "t2", status: "open" });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ tickets: [t1, t2] }),
        });
      });
      act(() => {
        mockLoop.emit({
          type: "ticket_updated",
          ticketId: "t1",
          changes: { status: "resolved" },
        });
      });
      expect(
        result.current.state.tickets.find((t) => t.id === "t2")!.status,
      ).toBe("open");
    });
  });

  describe("ticket_comment", () => {
    it("appends to correct ticket comments", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      const t = buildTicket({ id: "t1" });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ tickets: [t] }),
        });
      });
      act(() => {
        mockLoop.emit({
          type: "ticket_comment",
          ticketId: "t1",
          comment: buildTicketComment("t1"),
        });
      });
      expect(result.current.state.ticketComments["t1"]).toHaveLength(1);
    });

    it("does not affect other ticket comments", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        mockLoop.emit({
          type: "ticket_comment",
          ticketId: "t1",
          comment: buildTicketComment("t1"),
        });
      });
      expect(result.current.state.ticketComments["t2"]).toBeUndefined();
    });
  });

  describe("deployment_update", () => {
    it("updates correct service deployments", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        mockLoop.emit({
          type: "deployment_update",
          service: "payment-service",
          deployment: buildDeployment(),
        });
      });
      expect(result.current.state.deployments["payment-service"]).toHaveLength(
        1,
      );
    });

    it("does not affect other service deployments", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        mockLoop.emit({
          type: "deployment_update",
          service: "svc-a",
          deployment: buildDeployment(),
        });
      });
      expect(result.current.state.deployments["svc-b"]).toBeUndefined();
    });
  });

  describe("page_sent", () => {
    it("appends PageAlert to pages", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      const alert: PageAlert = {
        id: "pg1",
        personaId: "fp",
        message: "urgent",
        simTime: 20,
      };
      act(() => {
        mockLoop.emit({ type: "page_sent", alert });
      });
      expect(result.current.state.pages).toHaveLength(1);
      expect(result.current.state.pages[0].message).toBe("urgent");
    });
  });

  describe("coach_message", () => {
    it("appends to coachMessages", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        mockLoop.emit({ type: "coach_message", message: buildCoachMessage() });
      });
      expect(result.current.state.coachMessages).toHaveLength(1);
    });
  });

  describe("session_expired", () => {
    it("calls onExpired callback and sets status=expired", () => {
      const onExpired = vi.fn();
      const { mockLoop, Wrapper } = makeWrapper({ onExpired });
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        mockLoop.emit({ type: "session_expired", reason: "timeout" });
      });
      expect(onExpired).toHaveBeenCalledOnce();
      expect(result.current.state.status).toBe("expired");
    });
  });

  describe("debrief_ready", () => {
    it("does not change session status", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        mockLoop.emit({ type: "debrief_ready", sessionId: "test-session-id" });
      });
      expect(result.current.state.status).toBe("active");
    });
  });

  describe("error event", () => {
    it("calls console.error with code and message", () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const { mockLoop, Wrapper } = makeWrapper();
      renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({ type: "error", code: "E_TEST", message: "test error" });
      });
      expect(consoleSpy).toHaveBeenCalledWith("E_TEST", "test error");
      consoleSpy.mockRestore();
    });

    it("does not change state on error event", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ simTime: 5 }),
        });
      });
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      act(() => {
        mockLoop.emit({ type: "error", code: "E", message: "m" });
      });
      expect(result.current.state.simTime).toBe(5);
      consoleSpy.mockRestore();
    });
  });

  describe("metric_update", () => {
    it("adds point to metrics state (metric must exist in snapshot)", () => {
      const { mockLoop, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          // Seed the metric in the snapshot — metric_update only appends to existing metrics
          snapshot: buildTestSnapshot({
            simTime: 1,
            metrics: { svc: { m: [] } },
          }),
        });
      });
      act(() => {
        mockLoop.emit({
          type: "metric_update",
          service: "svc",
          metricId: "m",
          point: { t: 0, v: 1 },
        });
      });
      expect(result.current.state.metrics["svc"]?.["m"]).toHaveLength(1);
    });
  });

  describe("dispatchAction", () => {
    it("calls gameLoop.handleAction", () => {
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      const { Wrapper } = makeWrapper({ mockLoop });
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        result.current.dispatchAction("open_tab", { tab: "email" });
      });
      expect(handleAction).toHaveBeenCalledWith("open_tab", { tab: "email" });
    });

    it("is a no-op when status !== active", () => {
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      const onExpired = vi.fn();
      const { Wrapper } = makeWrapper({ mockLoop, onExpired });
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        mockLoop.emit({ type: "session_expired", reason: "timeout" });
      });
      act(() => {
        result.current.dispatchAction("open_tab", { tab: "email" });
      });
      expect(handleAction).not.toHaveBeenCalled();
    });
  });

  describe("postChatMessage", () => {
    it("calls gameLoop.handleChatMessage", () => {
      const mockLoop = buildMockGameLoop();
      const handleChat = vi.spyOn(mockLoop, "handleChatMessage");
      const { Wrapper } = makeWrapper({ mockLoop });
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        result.current.postChatMessage("#incidents", "hello world");
      });
      expect(handleChat).toHaveBeenCalledWith("#incidents", "hello world");
    });
  });

  describe("replyEmail", () => {
    it("calls gameLoop.handleEmailReply", () => {
      const mockLoop = buildMockGameLoop();
      const handleReply = vi.spyOn(mockLoop, "handleEmailReply");
      const { Wrapper } = makeWrapper({ mockLoop });
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        result.current.replyEmail("thread-001", "my reply");
      });
      expect(handleReply).toHaveBeenCalledWith("thread-001", "my reply");
    });
  });

  describe("setSpeed / setPaused", () => {
    it("setSpeed calls gameLoop.setSpeed and updates state", () => {
      const mockLoop = buildMockGameLoop();
      const setSpeedSpy = vi.spyOn(mockLoop, "setSpeed");
      const { Wrapper } = makeWrapper({ mockLoop });
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        result.current.setSpeed(5);
      });
      expect(setSpeedSpy).toHaveBeenCalledWith(5);
      expect(result.current.state.speed).toBe(5);
    });

    it("setPaused(true) calls gameLoop.pause and updates state", () => {
      const mockLoop = buildMockGameLoop();
      const pauseSpy = vi.spyOn(mockLoop, "pause");
      const { Wrapper } = makeWrapper({ mockLoop });
      const { result } = renderHook(() => useSession(), { wrapper: Wrapper });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      act(() => {
        result.current.setPaused(true);
      });
      expect(pauseSpy).toHaveBeenCalled();
      expect(result.current.state.paused).toBe(true);
    });
  });

  describe("useSession hook", () => {
    it("throws when used outside SessionProvider", () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      expect(() => renderHook(() => useSession())).toThrow();
      consoleSpy.mockRestore();
    });
  });
});
