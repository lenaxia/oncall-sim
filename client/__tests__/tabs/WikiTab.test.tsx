import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  describe("page list", () => {
    it("renders page titles from scenario", () => {
      renderWiki();
      expect(screen.getByText("Architecture")).toBeInTheDocument();
      expect(screen.getByText("Runbook")).toBeInTheDocument();
    });

    it("empty state when no pages", () => {
      renderWiki([]);
      expect(screen.getByText(/select a page/i)).toBeInTheDocument();
    });
  });

  describe("page selection", () => {
    it("clicking page shows content via MarkdownRenderer", async () => {
      const user = userEvent.setup();
      renderWiki();
      await user.click(screen.getByText("Architecture"));
      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: /architecture/i }),
        ).toBeInTheDocument();
      });
    });

    it("no page selected shows empty state initially", () => {
      renderWiki();
      expect(screen.getByText(/select a page/i)).toBeInTheDocument();
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
  });

  describe("search", () => {
    it("filters pages by title (case-insensitive)", async () => {
      const user = userEvent.setup();
      renderWiki();
      await user.type(screen.getByPlaceholderText(/search wiki/i), "run");
      await waitFor(() => {
        expect(screen.getByText("Runbook")).toBeInTheDocument();
      });
      const archItem = screen
        .getByText("Architecture")
        .closest("[data-wiki-page]") as HTMLElement;
      expect(archItem.style.display).toBe("none");
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

  describe("audit actions", () => {
    it("read_wiki_page dispatched when page opened", async () => {
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
