export type PriorityLevel = "urgent" | "high" | "medium" | "low" | "none";

export interface PriorityStyle {
  label: string;
  badgeClass: string;
  dot: string;
  border: string;
}

export const PRIORITY_STYLES: Record<PriorityLevel, PriorityStyle> = {
  urgent: {
    label: "URGENT",
    badgeClass: "bg-red-500/15 text-[var(--pw-urgent)] border border-red-500/30",
    dot: "bg-red-500",
    border: "border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300",
  },
  high: {
    label: "HIGH",
    badgeClass: "bg-orange-500/15 text-[var(--pw-high)] border border-orange-500/30",
    dot: "bg-amber-500",
    border: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300",
  },
  medium: {
    label: "MED",
    badgeClass: "bg-blue-500/15 text-[var(--pw-medium)] border border-blue-500/30",
    dot: "bg-blue-500",
    border: "border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-300",
  },
  low: {
    label: "LOW",
    badgeClass: "bg-teal-500/15 text-[var(--pw-low)] border border-teal-500/30",
    dot: "bg-slate-400",
    border: "border-slate-500/30 bg-slate-500/5 text-slate-700 dark:text-slate-300",
  },
  none: {
    label: "NONE",
    badgeClass:
      "bg-[var(--pw-surface-muted)] text-[var(--pw-ink-secondary)] border border-[var(--pw-border)]",
    dot: "bg-slate-300",
    border: "border-slate-400/20 bg-slate-400/5 text-slate-600 dark:text-slate-400",
  },
};
