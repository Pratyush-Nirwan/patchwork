import { describe, it, expect, beforeAll } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db";
import {
  users,
  orgs,
  orgMembers,
  teams,
  teamMembers,
  projects,
  boards,
  columns,
} from "@/db/schema";
import { hashPassword, createSession } from "@/lib/auth";
import { createTicket } from "@/lib/tickets";
import { getBoardWithDetails } from "@/lib/hierarchy";
import { BoardCalendarView } from "@/components/BoardCalendarView";
import { NextRequest } from "next/server";
import { PATCH as patchTicketRoute } from "@/app/api/tickets/[ticketId]/route";

describe("Board Calendar View & Due Date Scheduling", () => {
  let testUser: { id: string; email: string };
  let testBoard: { id: string };
  let testCol: { id: string };
  let sessionToken: string;
  let sessionCsrfToken: string;

  beforeAll(async () => {
    const pass = await hashPassword("CalendarPass123!");
    const [u] = await db
      .insert(users)
      .values({
        name: "Calendar Tester",
        email: `calendar-test-${Date.now()}@patchwork.dev`,
        passwordHash: pass,
      })
      .returning();
    testUser = u;

    const [o] = await db
      .insert(orgs)
      .values({
        name: "Calendar Org",
        slug: `cal-org-${Date.now()}`,
      })
      .returning();

    await db.insert(orgMembers).values({
      orgId: o.id,
      userId: u.id,
      role: "admin",
    });

    const [t] = await db
      .insert(teams)
      .values({
        orgId: o.id,
        name: "Core Calendar Team",
        slug: `cal-team-${Date.now()}`,
      })
      .returning();

    await db.insert(teamMembers).values({
      teamId: t.id,
      userId: u.id,
      role: "lead",
    });

    const [p] = await db
      .insert(projects)
      .values({
        orgId: o.id,
        teamId: t.id,
        name: "Calendar Project",
        key: "CAL",
      })
      .returning();

    const [b] = await db
      .insert(boards)
      .values({
        orgId: o.id,
        teamId: t.id,
        projectId: p.id,
        name: "Calendar Board",
      })
      .returning();
    testBoard = b;

    const [c] = await db
      .insert(columns)
      .values({
        boardId: b.id,
        name: "In Progress",
        position: 1000,
      })
      .returning();
    testCol = c;

    const session = await createSession(u.id);
    sessionToken = session.id;
    sessionCsrfToken = session.csrfToken;
  });

  describe("BoardCalendarView Component Rendering", () => {
    it("renders month heading, navigation controls, and unscheduled tray toggle", () => {
      const html = renderToStaticMarkup(
        React.createElement(BoardCalendarView, {
          tickets: [],
          columns: [{ id: "c1", name: "In Progress", position: 1000 }],
          members: [{ id: "m1", name: "Alice", email: "alice@test.dev", role: "lead" }],
          canMutateTickets: true,
          onSelectTicket: () => {},
          onUpdateTicketDueDate: async () => {},
        })
      );

      expect(html).toContain('data-testid="board-calendar-view"');
      expect(html).toContain('data-testid="calendar-month-heading"');
      expect(html).toContain('data-testid="calendar-prev-month-btn"');
      expect(html).toContain('data-testid="calendar-today-btn"');
      expect(html).toContain('data-testid="calendar-next-month-btn"');
      expect(html).toContain('data-testid="unscheduled-tray-toggle"');
      expect(html).toContain('data-testid="unscheduled-tickets-tray"');
    });

    it("plots scheduled tickets on their matching calendar day cell and places unscheduled in tray", () => {
      const scheduledDate = new Date();
      scheduledDate.setDate(15);
      const year = scheduledDate.getFullYear();
      const month = String(scheduledDate.getMonth() + 1).padStart(2, "0");
      const dateStr = `${year}-${month}-15`;

      const mockTickets = [
        {
          id: "t1",
          key: "CAL-1",
          title: "Scheduled Ticket",
          priority: "urgent" as const,
          columnId: "c1",
          assigneeId: "m1",
          dueDate: `${dateStr}T12:00:00.000Z`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "t2",
          key: "CAL-2",
          title: "Unscheduled Ticket",
          priority: "medium" as const,
          columnId: "c1",
          assigneeId: null,
          dueDate: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const html = renderToStaticMarkup(
        React.createElement(BoardCalendarView, {
          tickets: mockTickets,
          columns: [{ id: "c1", name: "In Progress", position: 1000 }],
          members: [{ id: "m1", name: "Alice", email: "alice@test.dev", role: "member", subRole: "developer" }],
          canMutateTickets: true,
          onSelectTicket: () => {},
          onUpdateTicketDueDate: async () => {},
        })
      );

      // Scheduled ticket in day cell
      expect(html).toContain(`data-testid="calendar-day-${dateStr}"`);
      expect(html).toContain('data-testid="calendar-ticket-CAL-1"');
      expect(html).toContain("Scheduled Ticket");
      expect(html).toContain("CAL-1");

      // Sub-role displayed
      expect(html).toContain("developer");

      // Unscheduled ticket in unscheduled tray
      expect(html).toContain('data-testid="unscheduled-tickets-tray"');
      expect(html).toContain('data-testid="calendar-ticket-CAL-2"');
      expect(html).toContain("Unscheduled Ticket");
      expect(html).toContain("CAL-2");
    });

    it("displays +N more button when multiple tickets exist on the same day", () => {
      const scheduledDate = new Date();
      scheduledDate.setDate(20);
      const year = scheduledDate.getFullYear();
      const month = String(scheduledDate.getMonth() + 1).padStart(2, "0");
      const dateStr = `${year}-${month}-20`;

      const mockTickets = [1, 2, 3, 4].map((i) => ({
        id: `t-${i}`,
        key: `CAL-${i}`,
        title: `Task #${i}`,
        priority: "high" as const,
        columnId: "c1",
        assigneeId: null,
        dueDate: `${dateStr}T12:00:00.000Z`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      const html = renderToStaticMarkup(
        React.createElement(BoardCalendarView, {
          tickets: mockTickets,
          columns: [{ id: "c1", name: "In Progress", position: 1000 }],
          members: [],
          canMutateTickets: true,
          onSelectTicket: () => {},
          onUpdateTicketDueDate: async () => {},
        })
      );

      expect(html).toContain(`data-testid="more-tickets-day-${dateStr}"`);
      expect(html).toContain("+2 more");
    });
  });

  describe("API & Database Due Date Persistence", () => {
    it("creates ticket with due date and returns it via API", async () => {
      const targetDate = new Date("2026-11-25T12:00:00Z");
      const created = await createTicket(testUser.id, testBoard.id, {
        title: "Database Due Date Test",
        columnId: testCol.id,
        priority: "high",
        dueDate: targetDate,
      });

      expect(created.id).toBeDefined();
      expect(created.dueDate).toBeDefined();
      expect(new Date(created.dueDate!).toISOString()).toBe(targetDate.toISOString());

      // Verify board details load includes dueDate
      const boardDetails = await getBoardWithDetails(testUser.id, testBoard.id);
      const ticketInBoard = boardDetails.tickets.find((t) => t.id === created.id);
      expect(ticketInBoard).toBeDefined();
      expect(ticketInBoard?.dueDate).toBeDefined();
      expect(new Date(ticketInBoard!.dueDate!).toISOString()).toBe(targetDate.toISOString());
    });

    it("updates and clears ticket due date via PATCH route", async () => {
      const created = await createTicket(testUser.id, testBoard.id, {
        title: "Rescheduling Test Ticket",
        columnId: testCol.id,
      });

      // 1. Update due date via PATCH
      const newDueDate = "2026-12-01T12:00:00.000Z";
      const patchReq = new NextRequest(`http://localhost:3000/api/tickets/${created.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${sessionToken}`,
          "x-csrf-token": sessionCsrfToken,
        },
        body: JSON.stringify({ dueDate: newDueDate }),
      });

      const patchRes = await patchTicketRoute(patchReq, {
        params: Promise.resolve({ ticketId: created.id }),
      });
      expect(patchRes.status).toBe(200);
      const patchData = await patchRes.json();
      expect(patchData.ticket.dueDate).toBeDefined();
      expect(new Date(patchData.ticket.dueDate).toISOString()).toBe(newDueDate);

      // 2. Clear due date (set to null)
      const clearReq = new NextRequest(`http://localhost:3000/api/tickets/${created.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${sessionToken}`,
          "x-csrf-token": sessionCsrfToken,
        },
        body: JSON.stringify({ dueDate: null }),
      });
      const clearRes = await patchTicketRoute(clearReq, {
        params: Promise.resolve({ ticketId: created.id }),
      });
      expect(clearRes.status).toBe(200);
      const clearData = await clearRes.json();
      expect(clearData.ticket.dueDate).toBeNull();
    });
  });
});
