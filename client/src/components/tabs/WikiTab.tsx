import { useState } from "react";
import { useScenario } from "../../context/ScenarioContext";
import { useSession } from "../../context/SessionContext";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { EmptyState } from "../EmptyState";
import { TopologyDiagram } from "../TopologyDiagram";

const TOPOLOGY_PAGE_TITLE = "Service Architecture";

export function WikiTab() {
  const { scenario } = useScenario();
  const { dispatchAction } = useSession();

  const [selectedTitle, setSelectedTitle] =
    useState<string>(TOPOLOGY_PAGE_TITLE);
  const [query, setQuery] = useState("");

  const scenarioPages = scenario?.wikiPages ?? [];

  // Synthetic topology page is always first; scenario pages follow
  const allTitles = [TOPOLOGY_PAGE_TITLE, ...scenarioPages.map((p) => p.title)];
  const filteredTitles =
    query.length > 0
      ? allTitles.filter((t) => {
          if (t === TOPOLOGY_PAGE_TITLE)
            return t.toLowerCase().includes(query.toLowerCase());
          const page = scenarioPages.find((p) => p.title === t)!;
          return matchesSearch(page, query);
        })
      : allTitles;

  const noMatch = query.length > 0 && filteredTitles.length === 0;

  function handleSelectPage(title: string) {
    setSelectedTitle(title);
    if (title !== TOPOLOGY_PAGE_TITLE) {
      dispatchAction("read_wiki_page", { pageTitle: title });
    }
  }

  const isTopologySelected = selectedTitle === TOPOLOGY_PAGE_TITLE;
  const selectedPage = isTopologySelected
    ? null
    : (scenarioPages.find((p) => p.title === selectedTitle) ?? null);

  return (
    <div className="flex h-full">
      {/* Left — page list */}
      <div className="w-44 border-r border-sim-border overflow-auto flex-shrink-0 bg-sim-surface flex flex-col">
        {/* Search */}
        <div className="border-b border-sim-border flex-shrink-0">
          <input
            type="text"
            placeholder="Search wiki..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full px-3 py-2 bg-sim-surface text-sim-text text-xs font-mono
                       outline-none placeholder:text-sim-text-faint"
          />
        </div>

        {/* Page list */}
        <div className="flex-1 overflow-auto">
          {filteredTitles.map((title) => {
            const isActive = title === selectedTitle;
            return (
              <div
                key={title}
                data-wiki-page=""
                data-active={isActive ? "true" : "false"}
                className={[
                  "px-3 py-2 border-b border-sim-border-muted cursor-pointer text-xs transition-colors duration-75",
                  isActive
                    ? "bg-sim-surface-2 text-sim-text border-l-2 border-l-sim-accent pl-[10px]"
                    : "text-sim-text-muted hover:bg-sim-surface-2",
                  title === TOPOLOGY_PAGE_TITLE ? "font-medium" : "",
                ].join(" ")}
                onClick={() => handleSelectPage(title)}
              >
                {title}
              </div>
            );
          })}
          {noMatch && (
            <div className="text-xs text-sim-text-faint px-3 py-4 text-center">
              No pages match
            </div>
          )}
        </div>
      </div>

      {/* Right — content pane */}
      <div className="flex-1 overflow-auto">
        {isTopologySelected ? (
          <>
            <div className="px-3 py-2 border-b border-sim-border flex-shrink-0 bg-sim-surface">
              <span className="text-sm font-semibold text-sim-text">
                Service Architecture
              </span>
            </div>
            <div className="p-4">
              {scenario ? (
                <TopologyDiagram topology={scenario.topology} />
              ) : (
                <EmptyState
                  title="No scenario"
                  message="Topology not available."
                />
              )}
            </div>
          </>
        ) : selectedPage === null ? (
          <EmptyState
            title="Select a page"
            message="Choose a wiki page from the list."
          />
        ) : (
          <>
            <div className="px-3 py-2 border-b border-sim-border flex-shrink-0 bg-sim-surface">
              <span className="text-sm font-semibold text-sim-text">
                {selectedPage.title}
              </span>
            </div>
            <div className="p-4">
              <MarkdownRenderer content={selectedPage.content} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function matchesSearch(
  page: { title: string; content: string },
  query: string,
): boolean {
  const q = query.toLowerCase();
  const snippet = page.content.slice(0, 200).toLowerCase();
  return page.title.toLowerCase().includes(q) || snippet.includes(q);
}
