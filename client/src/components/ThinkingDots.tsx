// ThinkingDots.tsx — shared "LLM is thinking" indicator used by the coach
// panel, scenario builder, and any other LLM-driven UI.
// Dots bounce (Tailwind default) and pulse between grey and accent blue.

export function ThinkingDots() {
  return (
    <span
      data-testid="thinking-dots"
      className="inline-flex items-center gap-1"
      aria-label="Thinking"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full animate-bounce animate-dot-pulse"
          style={{
            animationDelay: `${i * 150}ms`,
          }}
        />
      ))}
    </span>
  );
}
