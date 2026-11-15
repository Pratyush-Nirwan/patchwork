"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
ArrowLeft,
ArrowRight,
GitPullRequest,
GripVertical,
MessageSquare,
Paperclip,
Plus,
Trash2,
} from "lucide-react";
import { PRIORITY_STYLES } from "@/lib/priority";
import { checkSubRoleTransition } from "@/lib/workflow-stages";
import type { BoardData,ColumnItem,TicketItem } from "./types";

interface WorkspaceSortableColumnProps {
  col: ColumnItem;
  colIdx: number;
  totalColumns: number;
  colTickets: TicketItem[];
  overWip: boolean;
  canEditStructure: boolean;
  canMutateTickets: boolean;
  userRole?: string;
  userSubRole?: string;
  draggedTicketId: string | null;
  rollbackTicketId?: string | null;
  setDraggedTicketId: (id: string | null) => void;
  handleMoveTicket: (ticketId: string, targetColId: string, targetIndex?: number) => void;
  handleRenameColumn: (col: ColumnItem) => void;
  handleDeleteColumn: (columnId: string) => void;
  handleMoveColumnOrder: (index: number, direction: -1 | 1) => void;
  setNewTicketColumnId: (colId: string) => void;
  setShowNewTicket: (show: boolean) => void;
  selectedTicketId: string | null;
  setSelectedTicketId: (id: string | null) => void;
  boardMembers: BoardData["members"];
  allColumns: ColumnItem[];
  allTickets: TicketItem[];
  setErrorBanner: (msg: string | null) => void;
}

export function WorkspaceSortableColumnItem({
  col,
  colIdx,
  totalColumns,
  colTickets,
  overWip,
  canEditStructure,
  canMutateTickets,
  draggedTicketId,
  rollbackTicketId,
  setDraggedTicketId,
  handleMoveTicket,
  handleRenameColumn,
  handleDeleteColumn,
  handleMoveColumnOrder,
  setNewTicketColumnId,
  setShowNewTicket,
  selectedTicketId,
  setSelectedTicketId,
  boardMembers,
  allColumns,
  allTickets,
  setErrorBanner,
  userRole = "viewer",
  userSubRole = "developer",
}: WorkspaceSortableColumnProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: col.id,
    disabled: !canEditStructure,
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const draggedTicket = draggedTicketId
    ? allTickets.find((t) => t.id === draggedTicketId)
    : null;
  const sourceColIdx = draggedTicket
    ? allColumns.findIndex((c) => c.id === draggedTicket.columnId)
    : -1;
  const sourceCol = sourceColIdx !== -1 ? allColumns[sourceColIdx] : null;

  const subRoleDisallowedReason =
    sourceCol && draggedTicket && sourceCol.id !== col.id
      ? checkSubRoleTransition(userRole, userSubRole, sourceCol.name, col.name)
      : null;

  const isSequentialDisallowed =
    !canEditStructure &&
    sourceColIdx !== -1 &&
    colIdx > sourceColIdx + 1;

  const isJumpDisallowed = Boolean(isSequentialDisallowed || subRoleDisallowedReason);

  return (
    <section
      ref={setNodeRef}
      style={style}
      data-testid={`board-column-${col.name}`}
      onDragOver={(e) => {
        if (isJumpDisallowed) {
          e.dataTransfer.dropEffect = "none";
        } else {
          e.preventDefault();
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (draggedTicketId && canMutateTickets) {
          if (isJumpDisallowed) {
            setDraggedTicketId(null);
            const sourceCol = allColumns[sourceColIdx];
            const nextCol = allColumns[sourceColIdx + 1];
            setErrorBanner(
              `Cannot advance ticket directly from "${sourceCol?.name || "current column"}" to "${col.name}". Tickets must advance sequentially (next step: "${nextCol?.name || "next column"}").`
            );
            if (subRoleDisallowedReason) {
              setErrorBanner(subRoleDisallowedReason);
            } else {
              const nextCol = allColumns[sourceColIdx + 1];
              setErrorBanner(
                `Cannot advance ticket directly from "${sourceCol?.name || "current column"}" to "${col.name}". Tickets must advance sequentially (next step: "${nextCol?.name || "next column"}").`
              );
            }
            return;
          }
          handleMoveTicket(draggedTicketId, col.id);
          setDraggedTicketId(null);
        }
      }}
      className={`flex w-76 shrink-0 flex-col rounded border max-h-full transition ${
        isDragging
          ? "border-dashed border-[var(--pw-accent)] bg-[var(--pw-surface-muted)] opacity-60"
          : isJumpDisallowed && draggedTicketId
          ? "border-dashed border-red-500/40 bg-red-500/5 opacity-70 cursor-not-allowed"
          : overWip
          ? "border-red-500/60 bg-[var(--pw-surface)]"
          : "border-[var(--pw-border)] bg-[var(--pw-surface)]"
      }`}
    >
      {/* Column Header */}
      <div className="border-b border-[var(--pw-border)] p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {canEditStructure && (
              <button
                type="button"
                {...attributes}
                {...listeners}
                data-testid={`drag-handle-${col.id}`}
                aria-label={`Drag to reorder column ${col.name}`}
                className="cursor-grab active:cursor-grabbing p-0.5 text-[var(--pw-ink-muted)] hover:text-[var(--pw-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--pw-accent)] rounded"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
            )}
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: col.color }}
            />
            <h3
              onClick={() => canEditStructure && handleRenameColumn(col)}
              className={`text-xs font-semibold tracking-tight truncate ${
                canEditStructure ? "cursor-pointer hover:underline" : ""
              }`}
              title={canEditStructure ? "Click to rename column" : col.name}
            >
              {col.name}
            </h3>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${
                overWip
                  ? "bg-red-500/15 font-bold text-[var(--pw-urgent)]"
                  : "bg-[var(--pw-surface-muted)] text-[var(--pw-ink-secondary)]"
              }`}
            >
              {col.wipLimit ? `${colTickets.length}/${col.wipLimit}` : colTickets.length}
            </span>

            {canEditStructure && (
              <div className="flex items-center">
                <button
                  type="button"
                  aria-label="Move column left"
                  disabled={colIdx === 0}
                  onClick={() => handleMoveColumnOrder(colIdx, -1)}
                  className="rounded p-1 sm:p-0.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center text-[var(--pw-ink-muted)] hover:text-[var(--pw-ink)] disabled:opacity-30"
                  title="Move Column Left"
                >
                  <ArrowLeft className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label="Move column right"
                  disabled={colIdx === totalColumns - 1}
                  onClick={() => handleMoveColumnOrder(colIdx, 1)}
                  className="rounded p-1 sm:p-0.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center text-[var(--pw-ink-muted)] hover:text-[var(--pw-ink)] disabled:opacity-30"
                  title="Move Column Right"
                >
                  <ArrowRight className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label="Delete column"
                  onClick={() => handleDeleteColumn(col.id)}
                  className="rounded p-1 sm:p-0.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center text-[var(--pw-ink-muted)] hover:text-[var(--pw-urgent)]"
                  title="Delete Column"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Precision WIP Capacity Gauge */}
        {col.wipLimit !== null && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--pw-surface-muted)]">
            <div
              className={`h-full transition-all duration-300 ease-out-dispatch ${
                overWip ? "bg-[var(--pw-urgent)]" : "bg-[var(--pw-accent)]"
              }`}
              style={{
                width: `${Math.min(
                  100,
                  Math.round((colTickets.length / col.wipLimit) * 100)
                )}%`,
              }}
            />
          </div>
        )}
      </div>

      {/* Column Tickets List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {colTickets.map((ticket, idx) => {
          const assignee = boardMembers.find((m) => m.id === ticket.assigneeId);
          const prio = PRIORITY_STYLES[ticket.priority];

          return (
            <article
              key={ticket.id}
              data-testid={`ticket-card-${ticket.key}`}
              draggable={canMutateTickets}
              onDragStart={() => setDraggedTicketId(ticket.id)}
              onDragEnd={() => setDraggedTicketId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (draggedTicketId && draggedTicketId !== ticket.id && canMutateTickets) {
                  if (isJumpDisallowed) {
                    setDraggedTicketId(null);
                    const sourceCol = allColumns[sourceColIdx];
                    const nextCol = allColumns[sourceColIdx + 1];
                    setErrorBanner(
                      `Cannot advance ticket directly from "${sourceCol?.name || "current column"}" to "${col.name}". Tickets must advance sequentially (next step: "${nextCol?.name || "next column"}").`
                    );
                    return;
                  }
                  handleMoveTicket(draggedTicketId, col.id, idx);
                  setDraggedTicketId(null);
                }
              }}
              onClick={() => setSelectedTicketId(ticket.id)}
              className={`group cursor-pointer rounded border p-2.5 transition-[transform,opacity,border-color,background-color] duration-150 ${
                draggedTicketId === ticket.id ? "opacity-50 scale-[0.98]" : ""
              } ${rollbackTicketId === ticket.id ? "pw-dnd-rollback border-[var(--pw-urgent)]" : ""} ${
                selectedTicketId === ticket.id
                  ? "border-[var(--pw-accent)] bg-[var(--pw-surface-hover)]"
                  : "border-[var(--pw-border)] bg-[var(--pw-bg)] hover:border-[var(--pw-ink-muted)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="font-mono text-[11px] font-semibold text-[var(--pw-accent)] tabular-nums">
                  {ticket.key}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${prio.badgeClass}`}
                >
                  {prio.label}
                </span>
              </div>

              <h4 className="text-xs font-medium leading-snug text-[var(--pw-ink)] mb-2">
                {ticket.title}
              </h4>

              {ticket.labels.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {ticket.labels.map((lbl) => (
                    <span
                      key={lbl}
                      className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--pw-ink-secondary)]"
                    >
                      {lbl}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between pt-1.5 border-t border-[var(--pw-border)]/60 text-[11px] text-[var(--pw-ink-secondary)] gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate font-mono text-[10px]">
                    {assignee ? assignee.name : "Unassigned"}
                  </span>
                  <div className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-[var(--pw-ink-muted)] shrink-0">
                    <span className="flex items-center gap-0.5" title="Comments">
                      <MessageSquare className="h-2.5 w-2.5" />
                      {ticket.commentCount ?? 0}
                    </span>
                    <span className="flex items-center gap-0.5" title="Attachments">
                      <Paperclip className="h-2.5 w-2.5" />
                      {ticket.attachmentCount ?? 0}
                    </span>
                    {(ticket.linkCount ?? 0) > 0 && (
                      <span className="flex items-center gap-0.5" title="Git Links">
                        <GitPullRequest className="h-2.5 w-2.5" />
                        {ticket.linkCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </article>
          );
        })}

        {colTickets.length === 0 && (
          <div className="rounded border border-dashed border-[var(--pw-border)] p-4 text-center text-xs text-[var(--pw-ink-muted)]">
            Drop tickets here
          </div>
        )}
      </div>

      {canMutateTickets && (
        <div className="border-t border-[var(--pw-border)] p-2">
          <button
            type="button"
            onClick={() => {
              setNewTicketColumnId(col.id);
              setShowNewTicket(true);
            }}
            className="flex w-full items-center justify-center gap-1 rounded py-1 text-xs font-medium text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)] hover:text-[var(--pw-ink)]"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Ticket</span>
          </button>
        </div>
      )}
    </section>
  );
}
