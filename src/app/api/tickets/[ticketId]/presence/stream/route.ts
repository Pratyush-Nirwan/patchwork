import { NextRequest } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { requireTicketRole } from "@/lib/rbac";
import { validateSessionTokenDetailed } from "@/lib/auth";
import { presenceHub } from "@/lib/presence";
import { canUserViewTicket } from "@/lib/watchers";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ ticketId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true, skipTouch: true });
    const { ticketId } = await context.params;
    const { ticket } = await requireTicketRole(auth.user.id, ticketId, "viewer");

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        const initial = presenceHub.getSnapshot(ticket.id);
        controller.enqueue(
          encoder.encode(`event: presence\ndata: ${JSON.stringify(initial)}\n\n`)
        );

        unsubscribe = await presenceHub.subscribe(ticket.id, async (snapshot) => {
          const stillAllowed = await canUserViewTicket(auth.user.id, ticket).catch(() => false);
          if (!stillAllowed) {
            presenceHub.removeUserEverywhere(auth.user.id);
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            if (unsubscribe) unsubscribe();
            try {
              controller.close();
            } catch {
              // closed
            }
            return;
          }
          try {
            controller.enqueue(
              encoder.encode(`event: presence\ndata: ${JSON.stringify(snapshot)}\n\n`)
            );
          } catch {
            // closed
          }
        });

        heartbeatTimer = setInterval(async () => {
          try {
            const check = await validateSessionTokenDetailed(auth.session.id, {
              skipTouch: true,
            });
            const stillAllowed =
              check.auth && (await canUserViewTicket(auth.user.id, ticket).catch(() => false));
            if (!stillAllowed) {
              presenceHub.removeUserEverywhere(auth.user.id);
              if (heartbeatTimer) clearInterval(heartbeatTimer);
              if (unsubscribe) unsubscribe();
              try {
                controller.close();
              } catch {
                // closed
              }
              return;
            }
            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
          } catch {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
          }
        }, 15000);

        req.signal.addEventListener("abort", () => {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          if (unsubscribe) unsubscribe();
          try {
            controller.close();
          } catch {
            // closed
          }
        });
      },
      cancel() {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (unsubscribe) unsubscribe();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
