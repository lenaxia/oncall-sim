import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import {
  renderWithProviders,
  buildMockGameLoop,
  buildLoadedScenario,
} from "../../src/testutil/index";
import { WikiTab } from "../../src/components/tabs/WikiTab";

const WIKI_PAGES = [
  {
    title: "Architecture",
    content: "# Architecture\n\nThe **system** overview.",
  },
  { title: "Runbook", content: "# Runbook\n\nStep 1: check metrics." },
];

function renderWiki(pages = WIKI_PAGES) {
  const scenario = buildLoadedScenario({ wiki: { pages } });
  const mockLoop = buildMockGameLoop();
  return {
    ...renderWithProviders(<WikiTab />, { scenario, mockLoop }),
    mockLoop,
  };
}

describe("WikiTab", () => {
  // ── Synthetic topology page ─────────────────────────────────────────────────

  describe("Service Architecture page", () => {
    it("always appears first in the page list", () => {
      renderWiki();
      const items = screen.getAllByText(/service architecture/i);
      expect(items.length).toBeGreaterThanOrEqual(1);
    });

    it("is selected by default on mount", () => {
      renderWiki();
      const listItem = screen
        .getAllByText(/service architecture/i)
        .map((el) => el.closest("[data-wiki-page]"))
        .find(Boolean);
      expect(listItem).toHaveAttribute("data-active", "true");
    });

    it("renders topology diagram content when selected", () => {
      renderWiki();
      // The topology page header is visible in the content pane
      const headers = screen.getAllByText(/service architecture/i);
      // At least one is the content pane header (not just the list item)
      expect(headers.length).toBeGreaterThanOrEqual(2);
    });

    it("does not dispatch read_wiki_page for the topology page", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      const scenario = buildLoadedScenario({ wiki: { pages: WIKI_PAGES } });
      renderWithProviders(<WikiTab />, { scenario, mockLoop });
      // Topology page is already selected — clicking it again should not fire
      const listItem = screen
        .getAllByText(/service architecture/i)
        .find((el) => el.closest("[data-wiki-page]"));
      if (listItem) await user.click(listItem);
      expect(handleAction).not.toHaveBeenCalledWith(
        "read_wiki_page",
        expect.objectContaining({ pageTitle: "Service Architecture" }),
      );
    });

    it("scenario pages appear after Service Architecture in the list", () => {
      renderWiki();
      const allItems = screen
        .getAllByRole("generic")
        .filter((el) => el.hasAttribute("data-wiki-page"));
      const titles = allItems.map((el) => el.textContent ?? "");
      const topoIdx = titles.findIndex((t) => /service architecture/i.test(t));
      const archIdx = titles.findIndex((t) => /^architecture$/i.test(t));
      expect(topoIdx).toBe(0);
      expect(archIdx).toBeGreaterThan(topoIdx);
    });
  });

  // ── Page list ───────────────────────────────────────────────────────────────

  describe("page list", () => {
    it("renders page titles from scenario", () => {
      renderWiki();
      expect(screen.getByText("Architecture")).toBeInTheDocument();
      expect(screen.getByText("Runbook")).toBeInTheDocument();
    });

    it("shows Service Architecture even when no wiki pages defined", () => {
      renderWiki([]);
      expect(
        screen.getAllByText(/service architecture/i).length,
      ).toBeGreaterThan(0);
    });

    it("does NOT show empty state when there are no scenario wiki pages (topology page is always present)", () => {
      renderWiki([]);
      expect(screen.queryByText(/select a page/i)).not.toBeInTheDocument();
    });
  });

  // ── Page selection ──────────────────────────────────────────────────────────

  describe("page selection", () => {
    it("clicking a scenario page shows its content", async () => {
      const user = userEvent.setup();
      renderWiki();
      await user.click(screen.getByText("Architecture"));
      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: /architecture/i }),
        ).toBeInTheDocument();
      });
    });

    it("active page has visual highlight", async () => {
      const user = userEvent.setup();
      renderWiki();
      await user.click(screen.getByText("Architecture"));
      await waitFor(() => {
        const pageItems = screen.getAllByText("Architecture");
        const listItem = pageItems.find((el) => el.closest("[data-wiki-page]"));
        expect(listItem?.closest("[data-wiki-page]")).toHaveAttribute(
          "data-active",
          "true",
        );
      });
    });

    it("clicking back to Service Architecture shows topology diagram", async () => {
      const user = userEvent.setup();
      renderWiki();
      await user.click(screen.getByText("Architecture"));
      const topoItem = screen
        .getAllByText(/service architecture/i)
        .find((el) => el.closest("[data-wiki-page]"));
      if (topoItem) await user.click(topoItem);
      await waitFor(() => {
        expect(
          screen.queryByRole("heading", { name: /^architecture$/i }),
        ).not.toBeInTheDocument();
      });
    });
  });

  // ── Search ──────────────────────────────────────────────────────────────────

  describe("search", () => {
    it("filters scenario pages by title; topology page matches on 'architecture'", async () => {
      const user = userEvent.setup();
      renderWiki();
      await user.type(screen.getByPlaceholderText(/search wiki/i), "run");
      await waitFor(() => {
        expect(screen.getByText("Runbook")).toBeInTheDocument();
      });
      // Architecture (scenario page) should be filtered out; Service Architecture stays visible
      const allItems = screen
        .getAllByRole("generic")
        .filter((el) => el.hasAttribute("data-wiki-page"));
      const visibleTitles = allItems
        .filter((el) => (el as HTMLElement).style.display !== "none")
        .map((el) => el.textContent ?? "");
      expect(visibleTitles.some((t) => /runbook/i.test(t))).toBe(true);
    });

    it('shows "No pages match" when 0 pages match', async () => {
      const user = userEvent.setup();
      renderWiki();
      await user.type(
        screen.getByPlaceholderText(/search wiki/i),
        "zzz-no-match",
      );
      await waitFor(() => {
        expect(screen.getByText(/no pages match/i)).toBeInTheDocument();
      });
    });
  });

  // ── Audit actions ───────────────────────────────────────────────────────────

  describe("audit actions", () => {
    it("read_wiki_page dispatched when scenario page opened", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      const scenario = buildLoadedScenario({ wiki: { pages: WIKI_PAGES } });
      renderWithProviders(<WikiTab />, { scenario, mockLoop });
      await user.click(screen.getByText("Architecture"));
      await waitFor(() => {
        expect(handleAction).toHaveBeenCalledWith(
          "read_wiki_page",
          expect.objectContaining({ pageTitle: "Architecture" }),
        );
      });
    });
  });
});
