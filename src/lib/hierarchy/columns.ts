import { eq,asc } from "drizzle-orm";
import { db } from "@/db";
import {
columns
} from "@/db/schema";
import {
requireBoardRole
} from "../rbac";
import { AppError,NotFoundError } from "../errors";
import { realtimeHub } from "../realtime";

export async function createColumn(
  actorId: string,
  boardId: string,
  input: { name: string; wipLimit?: number | null; color?: string }
) {
  const { board } = await requireBoardRole(actorId, boardId, "lead");
  const name = input.name.trim();
  if (!name) throw new AppError("Column name is required", 400);

  const existing = await db
    .select()
    .from(columns)
    .where(eq(columns.boardId, boardId))
    .orderBy(asc(columns.position));

  const position = existing.length > 0 ? existing[existing.length - 1].position + 1 : 0;

  const [col] = await db
    .insert(columns)
    .values({
      boardId,
      name,
      position,
      wipLimit: input.wipLimit ?? null,
      color: input.color || "#64748B",
    })
    .returning();

  await realtimeHub.publish({
    type: "column.created",
    orgId: board.orgId,
    teamId: board.teamId,
    boardId: board.id,
    actorId,
    payload: { column: col },
  });

  return col;
}

export async function updateColumn(
  actorId: string,
  columnId: string,
  input: { name?: string; wipLimit?: number | null; color?: string }
) {
  const [col] = await db.select().from(columns).where(eq(columns.id, columnId)).limit(1);
  if (!col) throw new NotFoundError("Column not found");
  const { board } = await requireBoardRole(actorId, col.boardId, "lead");

  const updates: Partial<typeof columns.$inferInsert> = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new AppError("Column name cannot be empty", 400);
    updates.name = trimmed;
  }
  if (input.wipLimit !== undefined) {
    updates.wipLimit = input.wipLimit === null || input.wipLimit <= 0 ? null : input.wipLimit;
  }
  if (input.color !== undefined) {
    updates.color = input.color;
  }

  const [updated] = await db
    .update(columns)
    .set(updates)
    .where(eq(columns.id, columnId))
    .returning();

  await realtimeHub.publish({
    type: "column.updated",
    orgId: board.orgId,
    teamId: board.teamId,
    boardId: board.id,
    actorId,
    payload: { column: updated },
  });

  return updated;
}

export async function reorderColumns(
  actorId: string,
  boardId: string,
  input:
    | string[]
    | {
        columnId?: string;
        position?: number;
        columnIds?: string[];
        targetIndex?: number;
      }
) {
  const { board } = await requireBoardRole(actorId, boardId, "lead");
  const existingColumns = await db
    .select()
    .from(columns)
    .where(eq(columns.boardId, boardId))
    .orderBy(asc(columns.position), asc(columns.createdAt));

  const existingMap = new Map(existingColumns.map((c) => [c.id, c]));

  if (Array.isArray(input)) {
    const newOrderedIds = input;
    for (const id of newOrderedIds) {
      if (!existingMap.has(id)) {
        throw new AppError("Column does not belong to this board", 400);
      }
    }

    if (newOrderedIds.length === existingColumns.length && existingColumns.length > 0) {
      let movedId: string | null = null;
      let targetIdx = -1;

      for (let k = 0; k < newOrderedIds.length; k++) {
        const candidateId = newOrderedIds[k];
        const withoutCandidate = newOrderedIds.filter((id) => id !== candidateId);
        const origWithout = existingColumns.map((c) => c.id).filter((id) => id !== candidateId);
        if (withoutCandidate.every((id, idx) => id === origWithout[idx])) {
          movedId = candidateId;
          targetIdx = k;
          break;
        }
      }

      if (movedId && targetIdx !== -1) {
        const otherCols = existingColumns.filter((c) => c.id !== movedId);
        let newPos: number;
        if (targetIdx === 0) {
          newPos = otherCols.length > 0 ? otherCols[0].position - 1000 : 0;
        } else if (targetIdx >= otherCols.length) {
          newPos = otherCols[otherCols.length - 1].position + 1000;
        } else {
          const prevPos = otherCols[targetIdx - 1].position;
          const nextPos = otherCols[targetIdx].position;
          newPos = (prevPos + nextPos) / 2;
        }

        await db
          .update(columns)
          .set({ position: newPos })
          .where(eq(columns.id, movedId));
      } else {
        for (let i = 0; i < newOrderedIds.length; i++) {
          await db
            .update(columns)
            .set({ position: i * 1000 })
            .where(eq(columns.id, newOrderedIds[i]));
        }
      }
    }
  } else if (input && typeof input === "object") {
    if (input.columnId && typeof input.position === "number") {
      if (!existingMap.has(input.columnId)) {
        throw new AppError("Column does not belong to this board", 400);
      }
      await db
        .update(columns)
        .set({ position: input.position })
        .where(eq(columns.id, input.columnId));
    } else if (input.columnId && Array.isArray(input.columnIds)) {
      const targetIdx = input.columnIds.indexOf(input.columnId);
      if (!existingMap.has(input.columnId) || targetIdx === -1) {
        throw new AppError("Column does not belong to this board", 400);
      }
      const otherCols = existingColumns.filter((c) => c.id !== input.columnId);
      let newPos: number;
      if (targetIdx === 0) {
        newPos = otherCols.length > 0 ? otherCols[0].position - 1000 : 0;
      } else if (targetIdx >= otherCols.length) {
        newPos = otherCols[otherCols.length - 1].position + 1000;
      } else {
        const prevPos = otherCols[targetIdx - 1].position;
        const nextPos = otherCols[targetIdx].position;
        newPos = (prevPos + nextPos) / 2;
      }

      await db
        .update(columns)
        .set({ position: newPos })
        .where(eq(columns.id, input.columnId));
    }
  }

  const updatedColumns = await db
    .select()
    .from(columns)
    .where(eq(columns.boardId, boardId))
    .orderBy(asc(columns.position), asc(columns.createdAt));

  await realtimeHub.publish({
    type: "column.reordered",
    orgId: board.orgId,
    teamId: board.teamId,
    boardId: board.id,
    actorId,
    payload: { columns: updatedColumns },
  });

  return updatedColumns;
}

export async function deleteColumn(actorId: string, columnId: string) {
  const [col] = await db.select().from(columns).where(eq(columns.id, columnId)).limit(1);
  if (!col) throw new NotFoundError("Column not found");
  const { board } = await requireBoardRole(actorId, col.boardId, "lead");

  await db.delete(columns).where(eq(columns.id, columnId));

  await realtimeHub.publish({
    type: "column.deleted",
    orgId: board.orgId,
    teamId: board.teamId,
    boardId: board.id,
    actorId,
    payload: { columnId },
  });
}
