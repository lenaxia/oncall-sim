import { Marked } from "marked";
import DOMPurifyFactory from "dompurify";

// Configure a synchronous Marked instance — no async renderer extensions
const _marked = new Marked({ async: false, gfm: true, breaks: false });

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const ALLOWED_TAGS = [
  "p",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "code",
  "pre",
  "blockquote",
  "a",
  "strong",
  "em",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

// Lazily initialised DOMPurify instance with security hooks applied once.
let _purifyReady = false;

function getPurify() {
  const purify = DOMPurifyFactory(window);

  if (!_purifyReady) {
    _purifyReady = true;

    // Strip any href that isn't http:// or https:// — blocks javascript:, data:, vbscript:, etc.
    purify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        const href = node.getAttribute("href") ?? "";
        if (href && !/^https?:\/\//i.test(href)) {
          node.removeAttribute("href");
        }
        // Prevent reverse-tabnapping: any link that opens in a new tab must have rel set.
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  }

  return purify;
}

export function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  const rawHtml = _marked.parse(content) as string;

  const clean = getPurify().sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "rel"],
  });

  return (
    <div
      className={`sim-prose ${className ?? ""}`.trim()}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
