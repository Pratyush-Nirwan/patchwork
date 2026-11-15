import React, { useState, useMemo } from "react";
import { Presence, Scale } from "@/components/ui/motion";
import { PRIORITY_STYLES as PRIORITY_COLORS } from "@/lib/priority";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Inbox,
  Clock,
  AlertCircle,
  X,
  User,
} from "lucide-react";

export interface CalendarTicketItem {
  id: string;
  key: string;
  title: string;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  columnId: string;
  assigneeId: string | null;
  dueDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarColumnItem {
  id: string;
  name: string;
  position: number;
}

export interface CalendarMemberItem {
  id: string;
  name: string;
  email: string;
  role: string;
  subRole?: string | null;
}

interface BoardCalendarViewProps {
  tickets: CalendarTicketItem[];
  columns: CalendarColumnItem[];
  members: CalendarMemberItem[];
  canMutateTickets: boolean;
  onSelectTicket: (ticketId: string) => void;
  onUpdateTicketDueDate: (ticketId: string, dueDate: string | null) => Promise<void>;
}

function formatDateToYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function BoardCalendarView({
  tickets,
  columns,
  members,
  canMutateTickets,
  onSelectTicket,
  onUpdateTicketDueDate,
}: BoardCalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [showUnscheduled, setShowUnscheduled] = useState(true);
  const [selectedDayModal, setSelectedDayModal] = useState<{
    dateStr: string;
    label: string;
    tickets: CalendarTicketItem[];
  } | null>(null);

  const columnsMap = useMemo(() => {
    const map = new Map<string, CalendarColumnItem>();
    for (const c of columns) {
      map.set(c.id, c);
    }
    return map;
  }, [columns]);

  const membersMap = useMemo(() => {
    const map = new Map<string, CalendarMemberItem>();
    for (const m of members) {
      map.set(m.id, m);
    }
    return map;
  }, [members]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthName = useMemo(() => {
    return currentDate.toLocaleString("default", { month: "long", year: "numeric" });
  }, [currentDate]);

  // Build grid days (Monday to Sunday)
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Monday-first index: Mon = 0, Sun = 6
    const startDayIndex = (firstDay.getDay() + 6) % 7;
    const totalDays = lastDay.getDate();

    const days: Array<{
      date: Date;
      dateStr: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isToday: boolean;
    }> = [];

    const todayStr = formatDateToYMD(new Date());

    // Previous month trailing days
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayIndex - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevMonthLastDay - i);
      days.push({
        date: d,
        dateStr: formatDateToYMD(d),
        dayNumber: d.getDate(),
        isCurrentMonth: false,
        isToday: formatDateToYMD(d) === todayStr,
      });
    }

    // Current month days
    for (let i = 1; i <= totalDays; i++) {
      const d = new Date(year, month, i);
      const str = formatDateToYMD(d);
      days.push({
        date: d,
        dateStr: str,
        dayNumber: i,
        isCurrentMonth: true,
        isToday: str === todayStr,
      });
    }

    // Next month leading days to complete row (multiples of 7)
    const remaining = (7 - (days.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      days.push({
        date: d,
        dateStr: formatDateToYMD(d),
        dayNumber: i,
        isCurrentMonth: false,
        isToday: formatDateToYMD(d) === todayStr,
      });
    }

    return days;
  }, [year, month]);

  // Group tickets by date
  const { scheduledMap, unscheduledTickets } = useMemo(() => {
    const map = new Map<string, CalendarTicketItem[]>();
    const unscheduled: CalendarTicketItem[] = [];

    for (const t of tickets) {
      if (!t.dueDate) {
        unscheduled.push(t);
      } else {
        const d = new Date(t.dueDate);
        const ymd = formatDateToYMD(d);
        const list = map.get(ymd) || [];
        list.push(t);
        map.set(ymd, list);
      }
    }

    return { scheduledMap: map, unscheduledTickets: unscheduled };
  }, [tickets]);

  const handlePrevMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const handleDropOnDay = async (e: React.DragEvent, targetDateStr: string) => {
    e.preventDefault();
    if (!canMutateTickets) return;
    const ticketId = e.dataTransfer.getData("text/plain");
    if (!ticketId) return;

    // Use noon UTC to avoid date shifting across timezones
    const isoDueDate = new Date(`${targetDateStr}T12:00:00Z`).toISOString();
    await onUpdateTicketDueDate(ticketId, isoDueDate);
  };

  const handleDropOnUnscheduled = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!canMutateTickets) return;
    const ticketId = e.dataTransfer.getData("text/plain");
    if (!ticketId) return;
    await onUpdateTicketDueDate(ticketId, null);
  };

  const todayYMD = formatDateToYMD(new Date());

  const renderTicketCard = (ticket: CalendarTicketItem) => {
    const prio = PRIORITY_COLORS[ticket.priority] || PRIORITY_COLORS.medium;
    const col = columnsMap.get(ticket.columnId);
    const assignee = ticket.assigneeId ? membersMap.get(ticket.assigneeId) : null;
    const isCompleted = col?.name.toLowerCase().includes("completed") || col?.name.toLowerCase().includes("done");
    const isOverdue = ticket.dueDate && formatDateToYMD(new Date(ticket.dueDate)) < todayYMD && !isCompleted;

    return (
      <div
        key={ticket.id}
        draggable={canMutateTickets}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", ticket.id);
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelectTicket(ticket.id);
        }}
        data-testid={`calendar-ticket-${ticket.key}`}
        className={`group relative flex flex-col gap-1 rounded border px-2 py-1.5 text-xs transition cursor-pointer select-none hover:shadow-sm ${
          prio.border
        } ${isOverdue ? "ring-1 ring-red-500/50" : ""}`}
      >
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`h-2 w-2 rounded-full shrink-0 ${prio.dot}`} />
            <span className="font-mono text-[10px] font-bold text-[var(--pw-ink)] shrink-0">
              {ticket.key}
            </span>
          </div>
          {col && (
            <span className="truncate rounded bg-[var(--pw-surface)] px-1.5 py-0.2 font-mono text-[9px] text-[var(--pw-ink-secondary)] border border-[var(--pw-border)]">
              {col.name}
            </span>
          )}
        </div>

        <div className="text-[11px] font-medium text-[var(--pw-ink)] line-clamp-1 leading-tight">
          {ticket.title}
        </div>

        <div className="flex items-center justify-between gap-1 pt-0.5 text-[10px] text-[var(--pw-ink-secondary)]">
          {assignee ? (
            <div className="flex items-center gap-1 truncate">
              <User className="h-2.5 w-2.5 shrink-0 text-[var(--pw-ink-muted)]" />
              <span className="truncate">{assignee.name}</span>
              {assignee.subRole && (
                <span className="text-[9px] text-[var(--pw-accent)]">
                  · {assignee.subRole}
                </span>
              )}
            </div>
          ) : (
            <span className="italic text-[var(--pw-ink-tertiary)]">Unassigned</span>
          )}

          {isOverdue && (
            <span className="flex items-center gap-0.5 text-red-500 font-semibold text-[9px]">
              <AlertCircle className="h-2.5 w-2.5" />
              Late
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      data-testid="board-calendar-view"
      className="flex flex-1 flex-col overflow-hidden bg-[var(--pw-bg)]"
    >
      {/* Calendar Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--pw-border)] bg-[var(--pw-surface)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-[var(--pw-accent)]" />
          <h2
            data-testid="calendar-month-heading"
            className="text-sm font-semibold text-[var(--pw-ink)] tracking-tight"
          >
            {monthName}
          </h2>

          <div className="flex items-center gap-1 ml-2">
            <button
              type="button"
              data-testid="calendar-prev-month-btn"
              onClick={handlePrevMonth}
              aria-label="Previous Month"
              className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-1 text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)] hover:text-[var(--pw-ink)] transition"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid="calendar-today-btn"
              onClick={handleToday}
              className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 py-0.5 text-xs font-medium text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)] hover:text-[var(--pw-ink)] transition"
            >
              Today
            </button>
            <button
              type="button"
              data-testid="calendar-next-month-btn"
              onClick={handleNextMonth}
              aria-label="Next Month"
              className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-1 text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)] hover:text-[var(--pw-ink)] transition"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="unscheduled-tray-toggle"
            onClick={() => setShowUnscheduled((p) => !p)}
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition ${
              showUnscheduled
                ? "border-[var(--pw-accent)] bg-[var(--pw-accent)]/10 text-[var(--pw-accent)]"
                : "border-[var(--pw-border)] bg-[var(--pw-surface)] text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)]"
            }`}
          >
            <Inbox className="h-3.5 w-3.5" />
            <span>Unscheduled</span>
            {unscheduledTickets.length > 0 && (
              <span className="rounded-full bg-[var(--pw-accent)] px-1.5 py-0.2 text-[10px] font-bold text-white">
                {unscheduledTickets.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Main Grid Area & Unscheduled Drawer */}
      <div className="flex flex-1 overflow-hidden">
        {/* Calendar Day Grid */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {/* Day of Week Headers */}
          <div className="grid grid-cols-7 border-b border-[var(--pw-border)] bg-[var(--pw-surface-muted)] text-center text-xs font-semibold text-[var(--pw-ink-secondary)]">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((dayName) => (
              <div key={dayName} className="py-2 border-r last:border-r-0 border-[var(--pw-border)]">
                {dayName}
              </div>
            ))}
          </div>

          {/* Grid Cells */}
          <div className="grid grid-cols-7 auto-rows-fr flex-1 border-b border-[var(--pw-border)] min-h-[560px]">
            {calendarDays.map((cell) => {
              const dayTickets = scheduledMap.get(cell.dateStr) || [];
              const maxVisible = 2;
              const visibleTickets = dayTickets.slice(0, maxVisible);
              const remaining = dayTickets.length - maxVisible;

              return (
                <div
                  key={cell.dateStr}
                  data-testid={`calendar-day-${cell.dateStr}`}
                  onDragOver={(e) => {
                    if (canMutateTickets) e.preventDefault();
                  }}
                  onDrop={(e) => handleDropOnDay(e, cell.dateStr)}
                  className={`min-h-[100px] p-1.5 border-b border-r last:border-r-0 border-[var(--pw-border)] flex flex-col transition ${
                    cell.isCurrentMonth
                      ? "bg-[var(--pw-surface)]"
                      : "bg-[var(--pw-surface-muted)]/50 opacity-60"
                  } ${cell.isToday ? "ring-2 ring-inset ring-[var(--pw-accent)]" : ""}`}
                >
                  <div className="flex items-center justify-between pb-1">
                    <span
                      className={`text-[11px] font-bold font-mono px-1 rounded ${
                        cell.isToday
                          ? "bg-[var(--pw-accent)] text-white"
                          : cell.isCurrentMonth
                          ? "text-[var(--pw-ink)]"
                          : "text-[var(--pw-ink-muted)]"
                      }`}
                    >
                      {cell.dayNumber}
                    </span>
                    {dayTickets.length > 0 && (
                      <span className="text-[10px] text-[var(--pw-ink-muted)] font-mono">
                        {dayTickets.length}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 space-y-1 overflow-hidden">
                    {visibleTickets.map((t) => renderTicketCard(t))}

                    {remaining > 0 && (
                      <button
                        type="button"
                        data-testid={`more-tickets-day-${cell.dateStr}`}
                        onClick={() =>
                          setSelectedDayModal({
                            dateStr: cell.dateStr,
                            label: cell.date.toLocaleDateString("default", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            }),
                            tickets: dayTickets,
                          })
                        }
                        className="w-full text-center rounded bg-[var(--pw-surface-muted)] py-0.5 text-[10px] font-medium text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-border)] transition"
                      >
                        +{remaining} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Collapsible Unscheduled Tray */}
        {showUnscheduled && (
          <aside
            data-testid="unscheduled-tickets-tray"
            onDragOver={(e) => {
              if (canMutateTickets) e.preventDefault();
            }}
            onDrop={handleDropOnUnscheduled}
            className="w-72 shrink-0 border-l border-[var(--pw-border)] bg-[var(--pw-surface)] flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-[var(--pw-border)] p-3">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-[var(--pw-ink-secondary)]" />
                <h3 className="text-xs font-semibold text-[var(--pw-ink)]">
                  No Due Date ({unscheduledTickets.length})
                </h3>
              </div>
              <button
                type="button"
                aria-label="Close unscheduled drawer"
                onClick={() => setShowUnscheduled(false)}
                className="text-[var(--pw-ink-muted)] hover:text-[var(--pw-ink)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="p-2 text-[11px] text-[var(--pw-ink-secondary)] bg-[var(--pw-surface-muted)] border-b border-[var(--pw-border)]">
              Drag tickets onto a calendar day to schedule them.
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {unscheduledTickets.length === 0 ? (
                <div className="p-4 text-center text-xs text-[var(--pw-ink-muted)] italic">
                  All tickets have scheduled due dates!
                </div>
              ) : (
                unscheduledTickets.map((t) => renderTicketCard(t))
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Day Details Modal (when +N is clicked) */}
      <Presence show={Boolean(selectedDayModal)} duration="fast">
        {(phase) =>
          selectedDayModal ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 transition-opacity"
              style={{ opacity: phase === "entered" ? 1 : 0 }}
            >
              <Scale show={phase === "entered"} duration="fast" className="w-full max-w-md">
                <div
                  data-testid="calendar-day-modal"
                  className="w-full rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] p-5 shadow-xl max-h-[85vh] flex flex-col"
                >
                  <div className="flex items-center justify-between pb-3 border-b border-[var(--pw-border)]">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--pw-ink)]">
                        Tickets for {selectedDayModal.label}
                      </h3>
                      <p className="text-[11px] text-[var(--pw-ink-secondary)] font-mono">
                        {selectedDayModal.tickets.length} ticket(s) scheduled
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedDayModal(null)}
                      className="rounded p-1 text-[var(--pw-ink-muted)] hover:text-[var(--pw-ink)]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto py-3 space-y-2">
                    {selectedDayModal.tickets.map((t) => renderTicketCard(t))}
                  </div>

                  <div className="pt-2 border-t border-[var(--pw-border)] flex justify-end">
                    <button
                      type="button"
                      onClick={() => setSelectedDayModal(null)}
                      className="rounded bg-[var(--pw-surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--pw-ink)] hover:bg-[var(--pw-border)] transition"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </Scale>
            </div>
          ) : null
        }
      </Presence>
    </div>
  );
}
