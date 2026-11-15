"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical,Trash2 } from "lucide-react";

interface WizardSortableColumnProps {
  id: string;
  boardIndex: number;
  columnIndex: number;
  col: { name: string; wipLimit?: number | null; color?: string };
  onUpdate: (updated: { name: string; wipLimit?: number | null; color?: string }) => void;
  onDelete: () => void;
}

export function WizardSortableColumnItem({
  id,
  boardIndex,
  columnIndex,
  col,
  onUpdate,
  onDelete,
}: WizardSortableColumnProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`w-64 shrink-0 rounded border p-2.5 space-y-2 transition ${
        isDragging
          ? "border-dashed border-[var(--pw-accent)] bg-[var(--pw-surface-muted)] opacity-60"
          : "border-[var(--pw-border)] bg-[var(--pw-surface)]"
      }`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            {...attributes}
            {...listeners}
            data-testid={`setup-board-${boardIndex}-col-drag-${columnIndex}`}
            aria-label={`Drag to reorder column ${col.name || "column"}`}
            className="cursor-grab active:cursor-grabbing p-1 text-[var(--pw-ink-muted)] hover:text-[var(--pw-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--pw-accent)] rounded"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <span className="font-mono text-[10px] uppercase text-[var(--pw-ink-muted)]">
            Col {columnIndex + 1}
          </span>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-[var(--pw-ink-muted)] hover:text-[var(--pw-urgent)]"
          title="Remove Column"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      <div>
        <label className="block text-[10px] font-medium text-[var(--pw-ink-secondary)] mb-0.5">
          Name
        </label>
        <input
          data-testid={`setup-board-${boardIndex}-col-name-${columnIndex}`}
          type="text"
          value={col.name}
          onChange={(e) => onUpdate({ ...col, name: e.target.value })}
          placeholder="Column name"
          className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2 py-1 text-xs"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-medium text-[var(--pw-ink-secondary)] mb-0.5">
            WIP Limit
          </label>
          <input
            data-testid={`setup-board-${boardIndex}-col-wip-${columnIndex}`}
            type="number"
            min={1}
            value={col.wipLimit ?? ""}
            onChange={(e) =>
              onUpdate({
                ...col,
                wipLimit: e.target.value ? Number(e.target.value) : null,
              })
            }
            placeholder="No limit"
            className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2 py-1 font-mono text-xs"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-[var(--pw-ink-secondary)] mb-0.5">
            Color
          </label>
          <input
            type="color"
            value={col.color || "#64748B"}
            onChange={(e) => onUpdate({ ...col, color: e.target.value })}
            className="h-7 w-full cursor-pointer rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-0.5"
          />
        </div>
      </div>
    </div>
  );
}
