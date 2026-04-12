import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import { MetricChart } from "../../src/components/tabs/MetricChart";
import type { TimeSeriesPoint } from "@shared/types/events";
import {
  prepareChartSeries,
  downsampleSeries,
} from "../../src/metrics/downsample";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePoints(
  fromT: number,
  toT: number,
  step: number,
  valueFn: (t: number) => number = () => 50,
): TimeSeriesPoint[] {
  const pts: TimeSeriesPoint[] = [];
  for (let t = fromT; t <= toT; t += step) {
    pts.push({ t, v: valueFn(t) });
  }
  return pts;
}

const BASE_PROPS = {
  metricId: "error_rate",
  service: "recommendation-service",
  label: "Error Rate",
  unit: "%",
  clockAnchorMs: Date.now(),
};

// ── ResizeObserver mock ───────────────────────────────────────────────────────
// jsdom doesn't implement ResizeObserver. We need to mock it so containerReady
// state transitions can be tested.

class MockResizeObserver {
  private callback: ResizeObserverCallback;
  private static instances: MockResizeObserver[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe(_el: Element) {}
  unobserve(_el: Element) {}
  disconnect() {}

  static triggerAll(width: number) {
    for (const ro of MockResizeObserver.instances) {
      ro.callback(
        [{ contentRect: { width } } as ResizeObserverEntry],
        ro as unknown as ResizeObserver,
      );
    }
  }

  static reset() {
    MockResizeObserver.instances = [];
  }
}

beforeEach(() => {
  MockResizeObserver.reset();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── MetricChart ───────────────────────────────────────────────────────────────

describe("MetricChart", () => {
  describe("header", () => {
    it("renders the metric label", () => {
      const { getByText } = render(
        <MetricChart
          {...BASE_PROPS}
          series={makePoints(0, 300, 60)}
          simTime={300}
        />,
      );
      expect(getByText("Error Rate")).toBeInTheDocument();
    });

    it("shows current value from last visible point", () => {
      const series = makePoints(0, 300, 60, () => 42);
      const { getByText } = render(
        <MetricChart {...BASE_PROPS} series={series} simTime={300} />,
      );
      expect(getByText(/42\.0\s*%/)).toBeInTheDocument();
    });

    it("shows — when no visible points", () => {
      const { getByText } = render(
        <MetricChart
          {...BASE_PROPS}
          series={makePoints(100, 300, 60)}
          simTime={50}
        />,
      );
      expect(getByText("—")).toBeInTheDocument();
    });

    it("shows ALARM badge when value breaches criticalThreshold", () => {
      const { getByText } = render(
        <MetricChart
          {...BASE_PROPS}
          series={makePoints(0, 300, 60, () => 10)}
          simTime={300}
          criticalThreshold={5}
        />,
      );
      expect(getByText("ALARM")).toBeInTheDocument();
    });

    it("does not show ALARM badge when below threshold", () => {
      const { queryByText } = render(
        <MetricChart
          {...BASE_PROPS}
          series={makePoints(0, 300, 60, () => 3)}
          simTime={300}
          criticalThreshold={5}
        />,
      );
      expect(queryByText("ALARM")).not.toBeInTheDocument();
    });
  });

  describe("chart container", () => {
    it("renders the chart container div with correct height class", () => {
      const { container } = render(
        <MetricChart
          {...BASE_PROPS}
          series={makePoints(0, 300, 60)}
          simTime={300}
        />,
      );
      expect(container.querySelector(".h-\\[220px\\]")).toBeInTheDocument();
    });
  });

  describe("containerReady / Brush deferral", () => {
    it("does not crash when containerReady is false (Brush not rendered)", () => {
      // MockResizeObserver never fires — containerReady stays false.
      const series = makePoints(0, 14400, 60);
      const { container } = render(
        <MetricChart {...BASE_PROPS} series={series} simTime={14400} />,
      );
      // Component renders without error
      expect(container.querySelector(".h-\\[220px\\]")).toBeInTheDocument();
      // No recharts-brush elements (Brush not yet mounted)
      expect(
        container.querySelector("g.recharts-layer.recharts-brush"),
      ).not.toBeInTheDocument();
    });

    it("does not crash after ResizeObserver fires with positive width", async () => {
      const series = makePoints(0, 14400, 60);
      const { container } = render(
        <MetricChart {...BASE_PROPS} series={series} simTime={14400} />,
      );
      await act(async () => {
        MockResizeObserver.triggerAll(600);
      });
      expect(container.querySelector(".h-\\[220px\\]")).toBeInTheDocument();
    });

    it("does not mount Brush when series has <= 2 visible points", async () => {
      // condition is visible.length > 2 — exactly 2 points should NOT show brush
      const series = [
        { t: 0, v: 1 },
        { t: 60, v: 2 },
      ];
      const { container } = render(
        <MetricChart {...BASE_PROPS} series={series} simTime={60} />,
      );
      await act(async () => {
        MockResizeObserver.triggerAll(600);
      });
      expect(
        container.querySelector("g.recharts-layer.recharts-brush"),
      ).not.toBeInTheDocument();
    });

    it("remains stable with > 2 visible points after container is ready", async () => {
      const series = makePoints(0, 180, 60); // 4 points
      const { container } = render(
        <MetricChart {...BASE_PROPS} series={series} simTime={180} />,
      );
      await act(async () => {
        MockResizeObserver.triggerAll(600);
      });
      expect(container.querySelector(".h-\\[220px\\]")).toBeInTheDocument();
    });
  });

  describe("onFirstHover", () => {
    it("calls onFirstHover when chart container is hovered", () => {
      const onFirstHover = vi.fn();
      const { container } = render(
        <MetricChart
          {...BASE_PROPS}
          series={makePoints(0, 300, 60)}
          simTime={300}
          onFirstHover={onFirstHover}
        />,
      );
      const chartDiv = container.querySelector(".h-\\[220px\\]")!;
      fireEvent.mouseEnter(chartDiv);
      expect(onFirstHover).toHaveBeenCalledTimes(1);
    });
  });
});

// ── prepareChartSeries ────────────────────────────────────────────────────────

describe("prepareChartSeries", () => {
  it("returns empty array for empty input", () => {
    expect(prepareChartSeries([])).toEqual([]);
  });

  it("returns original array reference when all points are within 6h cutoff", () => {
    const pts = makePoints(-21000, 300, 60); // all t >= -21600
    const result = prepareChartSeries(pts);
    expect(result).toBe(pts); // fast path — same reference
  });

  it("downsamples points older than 6h to 5-minute resolution", () => {
    const pts = makePoints(-25200, 0, 60);
    const result = prepareChartSeries(pts);
    const cutoff = -21600;
    const oldPts = result.filter((p) => p.t < cutoff);
    for (const p of oldPts) {
      expect(Math.abs(Math.round(p.t) % 300)).toBe(0);
    }
  });

  it("preserves positive-t live points at full resolution", () => {
    const pts = makePoints(-25200, 300, 60);
    const result = prepareChartSeries(pts);
    const livePts = result.filter((p) => p.t > 0);
    const expectedLive = pts.filter((p) => p.t > 0);
    expect(livePts.length).toBe(expectedLive.length);
  });

  it("output is sorted ascending by t", () => {
    const pts = makePoints(-25200, 300, 60);
    const result = prepareChartSeries(pts);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].t).toBeGreaterThanOrEqual(result[i - 1].t);
    }
  });
});

// ── downsampleSeries ──────────────────────────────────────────────────────────

describe("downsampleSeries", () => {
  it("returns empty array for empty input", () => {
    expect(downsampleSeries([], 300)).toEqual([]);
  });

  it("keeps only points whose t is a multiple of targetResolution", () => {
    const pts = makePoints(0, 600, 60);
    const result = downsampleSeries(pts, 300);
    expect(result.map((p) => p.t)).toEqual([0, 300, 600]);
  });

  it("handles negative timestamps correctly", () => {
    const pts = makePoints(-600, 0, 60);
    const result = downsampleSeries(pts, 300);
    expect(result.map((p) => p.t)).toEqual([-600, -300, 0]);
  });
});
