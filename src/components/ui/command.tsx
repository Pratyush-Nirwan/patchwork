"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search, X } from "lucide-react";
import { Presence, Scale } from "@/components/ui/motion";

function cn(...classes: Array<string | undefined | false | null>): string {
  return classes.filter(Boolean).join(" ");
}

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-lg bg-[var(--pw-surface)] text-[var(--pw-ink)]",
      className
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

interface CommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEscapeKeyDown?: (e: KeyboardEvent) => void;
  children: React.ReactNode;
  ariaLabel?: string;
}

function CommandDialog({
  open,
  onOpenChange,
  onEscapeKeyDown,
  children,
  ariaLabel = "Command Bar",
}: CommandDialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onEscapeKeyDown?.(e);
        if (e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onOpenChange, onEscapeKeyDown]);

  return (
    <Presence show={open} duration="fast">
      {(phase) => (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-3 pt-[10vh] sm:pt-[14vh] backdrop-blur-[2px] transition-opacity"
          style={{
            opacity: phase === "entered" ? 1 : 0,
            transitionDuration: "120ms",
          }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              onOpenChange(false);
            }
          }}
        >
          <Scale show={phase === "entered"} from={0.97} duration="fast" className="w-full max-w-2xl">
            <div
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel}
              data-testid="command-palette"
              className="w-full overflow-hidden rounded-xl border border-[var(--pw-border)] bg-[var(--pw-surface)] shadow-[var(--pw-shadow)]"
            >
              {children}
            </div>
          </Scale>
        </div>
      )}
    </Presence>
  );
}

export interface CommandGhostConfig {
  /** Text immediately after typed value (e.g. command completion "ve" or active arg "‹column›") */
  activeText: string;
  /** Whether activeText should be rendered as an argument pill (false for command-name completion) */
  activeIsPill?: boolean;
  /** Whether the active argument is mandatory (pastel red pill) vs optional (gray pill) */
  activeRequired?: boolean;
  /** Remaining arguments after the active one (e.g. ["[priority:level]"]) */
  remainingText: string;
  /** Structured remaining argument items for pill rendering */
  remainingItems?: Array<{ text: string; required: boolean }>;
  /** Whether a leading space is needed before the ghost hint */
  needsLeadingSpace?: boolean;
  /** Whether a ~4px gap is needed after a colon (e.g. `priority:`) */
  needsColonGap?: boolean;
  /** Whether to show the faint `↵ Run` keycap after remaining hints */
  readyToRun?: boolean;
  /** Whether the right-edge `Tab` keycap hint should appear */
  showTabHint?: boolean;
  /** Screen-reader description of the active argument */
  ariaDescription?: string;
  /** Polite live-region announcement when the active argument changes */
  liveAnnouncement?: string;
  /** Optional offending token span [start, end] to underline subtly without changing text color */
  errorSpan?: { start: number; end: number } | null;
}

interface CommandInputProps
  extends React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> {
  onClear?: () => void;
  showClear?: boolean;
  ghost?: CommandGhostConfig | null;
  onCaretChange?: (atEnd: boolean, hasSelection: boolean) => void;
}

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  CommandInputProps
>(({ className, onClear, showClear, ghost, onCaretChange, value, ...props }, ref) => {
  const innerInputRef = React.useRef<HTMLInputElement | null>(null);
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const mirrorRef = React.useRef<HTMLSpanElement | null>(null);
  const errorMirrorStartRef = React.useRef<HTMLSpanElement | null>(null);
  const errorMirrorSpanRef = React.useRef<HTMLSpanElement | null>(null);

  const [isComposing, setIsComposing] = React.useState(false);
  const [caretOk, setCaretOk] = React.useState(true);
  const [measure, setMeasure] = React.useState({
    textWidth: 0,
    containerWidth: 0,
    scrollLeft: 0,
    isRtl: false,
    errorLeft: 0,
    errorWidth: 0,
  });

  const strValue = typeof value === "string" ? value : "";
  const descId = React.useId();

  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      innerInputRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
    },
    [ref]
  );

  const syncCaretState = React.useCallback(() => {
    const el = innerInputRef.current;
    if (!el) return;
    const len = el.value.length;
    const selStart = el.selectionStart ?? len;
    const selEnd = el.selectionEnd ?? len;
    const hasSelection = selStart !== selEnd;
    const atEnd = selStart === len && selEnd === len;
    setCaretOk(atEnd && !hasSelection);
    onCaretChange?.(atEnd, hasSelection);
  }, [onCaretChange]);

  const measureNow = React.useCallback(() => {
    const inputEl = innerInputRef.current;
    const boxEl = boxRef.current;
    const mirrorEl = mirrorRef.current;
    if (!inputEl || !boxEl || !mirrorEl) return;

    const style = window.getComputedStyle(inputEl);
    mirrorEl.style.font = style.font;
    mirrorEl.style.letterSpacing = style.letterSpacing;
    mirrorEl.style.fontWeight = style.fontWeight;
    mirrorEl.style.fontSize = style.fontSize;
    mirrorEl.style.fontFamily = style.fontFamily;

    const boxRect = boxEl.getBoundingClientRect();
    const zoomScale = boxEl.offsetWidth > 0 ? boxRect.width / boxEl.offsetWidth : 1;
    const textWidth = mirrorEl.getBoundingClientRect().width / zoomScale;
    const containerWidth = boxRect.width / zoomScale;
    const scrollLeft = Math.abs(inputEl.scrollLeft);
    const isRtl = style.direction === "rtl";

    let errorLeft = 0;
    let errorWidth = 0;
    if (ghost?.errorSpan && errorMirrorStartRef.current && errorMirrorSpanRef.current) {
      const s1 = errorMirrorStartRef.current;
      const s2 = errorMirrorSpanRef.current;
      s1.style.font = style.font;
      s1.style.letterSpacing = style.letterSpacing;
      s2.style.font = style.font;
      s2.style.letterSpacing = style.letterSpacing;
      errorLeft = s1.getBoundingClientRect().width / zoomScale - scrollLeft;
      errorWidth = s2.getBoundingClientRect().width / zoomScale;
    }

    setMeasure((prev) =>
      prev.textWidth === textWidth &&
      prev.containerWidth === containerWidth &&
      prev.scrollLeft === scrollLeft &&
      prev.isRtl === isRtl &&
      prev.errorLeft === errorLeft &&
      prev.errorWidth === errorWidth
        ? prev
        : {
            textWidth,
            containerWidth,
            scrollLeft,
            isRtl,
            errorLeft,
            errorWidth,
          }
    );
  }, [ghost?.errorSpan]);

  const scheduleMeasure = React.useCallback(() => {
    const rafId = window.requestAnimationFrame(measureNow);
    return () => window.cancelAnimationFrame(rafId);
  }, [measureNow]);

  React.useLayoutEffect(() => {
    measureNow();
    syncCaretState();
  }, [strValue, ghost?.activeText, ghost?.remainingText, ghost?.errorSpan, measureNow, syncCaretState]);

  React.useEffect(() => {
    const boxEl = boxRef.current;
    if (!boxEl) return;

    const ro = new ResizeObserver(() => {
      scheduleMeasure();
    });
    ro.observe(boxEl);

    let cancelled = false;
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!cancelled) scheduleMeasure();
      });
    }

    const onResize = () => scheduleMeasure();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [scheduleMeasure]);

  const hasGhostContent = Boolean(
    ghost && (ghost.activeText || ghost.remainingText || ghost.readyToRun)
  );
  const textOffsetInView = Math.max(0, measure.textWidth - measure.scrollLeft);
  const textOverflows =
    measure.containerWidth > 0 && textOffsetInView >= measure.containerWidth - 8;
  const showGhost = Boolean(hasGhostContent && caretOk && !isComposing && !textOverflows);
  const availableGhostWidth =
    measure.containerWidth > 0
      ? Math.max(0, measure.containerWidth - textOffsetInView)
      : undefined;

  const errStart = ghost?.errorSpan ? Math.max(0, ghost.errorSpan.start) : 0;
  const errEnd = ghost?.errorSpan ? Math.min(strValue.length, ghost.errorSpan.end) : 0;

  return (
    <div
      className="flex items-center gap-2 border-b border-[var(--pw-border)] px-3.5 py-2.5"
      cmdk-input-wrapper=""
    >
      <Search className="h-4 w-4 shrink-0 text-[var(--pw-ink-muted)]" />
      <div ref={boxRef} className="relative flex-1 min-w-0 overflow-hidden">
        {/* Hidden mirror elements for exact pixel width measurement */}
        <span
          ref={mirrorRef}
          aria-hidden="true"
          className="pointer-events-none invisible fixed -left-[9999px] -top-[9999px] whitespace-pre text-sm"
        >
          {strValue}
        </span>
        {ghost?.errorSpan && (
          <>
            <span
              ref={errorMirrorStartRef}
              aria-hidden="true"
              className="pointer-events-none invisible fixed -left-[9999px] -top-[9999px] whitespace-pre text-sm"
            >
              {strValue.slice(0, errStart)}
            </span>
            <span
              ref={errorMirrorSpanRef}
              aria-hidden="true"
              className="pointer-events-none invisible fixed -left-[9999px] -top-[9999px] whitespace-pre text-sm"
            >
              {strValue.slice(errStart, errEnd)}
            </span>
          </>
        )}

        <CommandPrimitive.Input
          ref={setRefs}
          value={value}
          aria-describedby={ghost?.ariaDescription ? descId : undefined}
          onSelect={syncCaretState}
          onKeyUp={syncCaretState}
          onMouseUp={syncCaretState}
          onScroll={scheduleMeasure}
          className={cn(
            "relative z-10 flex h-7 w-full bg-transparent text-sm text-[var(--pw-ink)] outline-none placeholder:text-[var(--pw-ink-muted)] disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...props}
          onKeyDown={(e) => {
            if (e.key === "Home" || e.key === "End") {
              e.stopPropagation();
            }
            if (
              e.key === "Home" ||
              e.key === "End" ||
              e.key === "ArrowLeft" ||
              e.key === "ArrowRight"
            ) {
              window.requestAnimationFrame(syncCaretState);
            }
            props.onKeyDown?.(e);
          }}
          onCompositionStart={(e) => {
            setIsComposing(true);
            props.onCompositionStart?.(e);
          }}
          onCompositionEnd={(e) => {
            setIsComposing(false);
            syncCaretState();
            scheduleMeasure();
            props.onCompositionEnd?.(e);
          }}
        />

        {/* Subtle underline on offending argument only */}
        {ghost?.errorSpan && measure.errorWidth > 0 && (
          <span
            aria-hidden="true"
            data-testid="command-arg-error-underline"
            style={{
              left: measure.isRtl ? undefined : `${Math.max(0, measure.errorLeft)}px`,
              right: measure.isRtl ? `${Math.max(0, measure.errorLeft)}px` : undefined,
              width: `${measure.errorWidth}px`,
            }}
            className="pointer-events-none absolute bottom-0.5 h-[2px] rounded-full bg-amber-500/80"
          />
        )}

        {/* Inline Discord-style Ghost Hint Layer */}
        {showGhost && ghost && (
          <div
            aria-hidden="true"
            data-testid="command-ghost-layer"
            style={{
              left: measure.isRtl
                ? undefined
                : `${textOffsetInView + (ghost.needsColonGap ? 4 : 0) + (strValue.endsWith(" ") && !ghost.needsLeadingSpace ? 4 : 0)}px`,
              right: measure.isRtl
                ? `${textOffsetInView + (ghost.needsColonGap ? 4 : 0) + (strValue.endsWith(" ") && !ghost.needsLeadingSpace ? 4 : 0)}px`
                : undefined,
              maxWidth: availableGhostWidth !== undefined ? `${availableGhostWidth}px` : undefined,
            }}
            className="pw-ghost-enter pointer-events-none absolute top-0 flex h-7 select-none items-center overflow-hidden whitespace-pre text-sm leading-7"
          >
            <span className="inline-flex items-center gap-2 truncate">
              {ghost.needsLeadingSpace ? <span className="inline-block w-2" /> : null}
              {ghost.activeText && (
                <span
                  data-testid="command-ghost-active"
                  className={
                    ghost.activeIsPill
                      ? cn(
                          "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium leading-4",
                          ghost.activeRequired
                            ? "border border-red-500/25 bg-red-500/15 text-red-700 dark:text-red-300"
                            : "border border-slate-500/25 bg-slate-500/15 text-slate-600 dark:text-slate-300"
                        )
                      : "text-[var(--pw-ghost-active)]"
                  }
                >
                  {ghost.activeText}
                </span>
              )}
              {(ghost.remainingItems && ghost.remainingItems.length > 0) ? (
                <span
                  data-testid="command-ghost-rest"
                  className="inline-flex items-center gap-1.5"
                >
                  {ghost.remainingItems.map((item, idx) => (
                    <span
                      key={`${item.text}-${idx}`}
                      className={cn(
                        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium leading-4",
                        item.required
                          ? "border border-red-500/25 bg-red-500/15 text-red-700 dark:text-red-300"
                          : "border border-slate-500/25 bg-slate-500/15 text-slate-600 dark:text-slate-300"
                      )}
                    >
                      {item.text}
                    </span>
                  ))}
                </span>
              ) : ghost.remainingText ? (
                <span
                  data-testid="command-ghost-rest"
                  className="text-[var(--pw-ghost-rest)]"
                >
                  {ghost.remainingText}
                </span>
              ) : null}
              {ghost.readyToRun && (
                <span
                  data-testid="command-ghost-run"
                  className="ml-0.5 inline-flex items-center rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-1 py-0 font-mono text-[10px] leading-4 text-[var(--pw-ghost-rest)]"
                >
                  ↵ Run
                </span>
              )}
            </span>
          </div>
        )}

        {/* Screen-reader description & live region */}
        {ghost?.ariaDescription && (
          <span id={descId} className="sr-only">
            {ghost.ariaDescription}
          </span>
        )}
        <span className="sr-only" aria-live="polite" data-testid="command-aria-live">
          {ghost?.liveAnnouncement || ""}
        </span>
      </div>

      {ghost?.showTabHint && (
        <kbd
          data-testid="command-tab-hint"
          className="hidden sm:inline-flex shrink-0 items-center rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--pw-ink-muted)]"
        >
          Tab
        </kbd>
      )}

      {showClear && onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear command input"
          className="rounded p-1 text-[var(--pw-ink-muted)] hover:bg-[var(--pw-surface-hover)] hover:text-[var(--pw-ink)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
});
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn(
      "max-h-[60vh] overflow-y-auto overflow-x-hidden p-2",
      className
    )}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className={cn(
      "py-8 text-center text-xs text-[var(--pw-ink-secondary)]",
      className
    )}
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden py-1 text-[var(--pw-ink)] [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--pw-ink-muted)]",
      className
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-[var(--pw-border)]", className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex min-h-[44px] sm:min-h-0 cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-xs outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-[var(--pw-surface-hover)] data-[selected=true]:text-[var(--pw-ink)] data-[disabled=true]:opacity-50",
      className
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

function CommandShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "ml-auto rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--pw-ink-muted)]",
        className
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
};
