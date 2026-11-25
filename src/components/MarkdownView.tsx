import React from "react";

/**
 * Lightweight, safe Markdown renderer for ticket descriptions and comments.
 * Supports headings, bold, inline code, fenced code blocks, lists, blockquotes, and links.
 */
export function MarkdownView({
  content,
  className = "",
  mentionUsers,
}: {
  content: string;
  className?: string;
  mentionUsers?: Record<string, { id: string; name: string }>;
}) {
  if (!content || !content.trim()) {
    return <p className="text-xs italic opacity-60">No description provided.</p>;
  }

  const lines = content.split(/\r?\n/);
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  const renderInline = (
    text: string,
    keyPrefix: string,
    allowMentions = true
  ): React.ReactNode[] => {
    const tokens = text.split(
      /(`[^`]+`|\*\*[^*]+\*\*|@\[[^\]]+\]\(mention:[0-9a-fA-F-]{36}\)|\[[^\]]+\]\([^)]+\))/g
    );
    return tokens.map((tok, idx) => {
      const k = `${keyPrefix}-${idx}`;
      if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
        return (
          <code
            key={k}
            className="rounded bg-[var(--pw-surface-muted)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--pw-accent)]"
          >
            {tok.slice(1, -1)}
          </code>
        );
      }
      if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) {
        return (
          <strong key={k} className="font-semibold text-[var(--pw-ink)]">
            {tok.slice(2, -2)}
          </strong>
        );
      }
      if (allowMentions) {
        const mentionMatch = tok.match(
          /^@\[([^\]]+)\]\(mention:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)$/
        );
        if (mentionMatch) {
          const uid = mentionMatch[2].toLowerCase();
          const displayName = mentionUsers?.[uid]?.name || mentionMatch[1];
          return (
            <span
              key={k}
              data-mention-user-id={uid}
              className="inline-flex items-center rounded bg-[var(--pw-accent-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--pw-accent)]"
            >
              @{displayName}
            </span>
          );
        }
      }
      const linkMatch = tok.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (linkMatch) {
        return (
          <a
            key={k}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-[var(--pw-accent)] underline-offset-3 text-[var(--pw-accent)] hover:opacity-80"
          >
            {linkMatch[1]}
          </a>
        );
      }
      return tok;
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={`code-${i}`}
            className="my-2 overflow-x-auto rounded border border-[var(--pw-border)] bg-[var(--pw-surface-muted)] p-2.5 font-mono text-xs leading-relaxed"
          >
            <code>{codeLines.join("\n")}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    if (line.startsWith("### ")) {
      elements.push(
        <h4 key={i} className="mt-3 mb-1 text-xs font-semibold tracking-tight text-[var(--pw-ink)]">
          {renderInline(line.slice(4), `h4-${i}`)}
        </h4>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h3 key={i} className="mt-3.5 mb-1 text-sm font-semibold tracking-tight text-[var(--pw-ink)]">
          {renderInline(line.slice(3), `h3-${i}`)}
        </h3>
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <h2 key={i} className="mt-4 mb-1.5 text-base font-semibold tracking-tight text-[var(--pw-ink)]">
          {renderInline(line.slice(2), `h2-${i}`)}
        </h2>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} className="flex items-start gap-2 pl-2 text-xs leading-relaxed text-[var(--pw-ink)]">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--pw-accent)]" />
          <span>{renderInline(line.slice(2), `li-${i}`)}</span>
        </div>
      );
    } else if (line.startsWith("> ")) {
      elements.push(
        <blockquote
          key={i}
          className="my-1.5 border-l border-[var(--pw-border)] pl-3 text-xs italic text-[var(--pw-ink-secondary)]"
        >
          {renderInline(line.slice(2), `bq-${i}`, false)}
        </blockquote>
      );
    } else {
      elements.push(
        <p key={i} className="my-1 text-xs leading-relaxed text-[var(--pw-ink)] max-w-[70ch]">
          {renderInline(line, `p-${i}`)}
        </p>
      );
    }
  }

  return <div className={`space-y-1 ${className}`}>{elements}</div>;
}

