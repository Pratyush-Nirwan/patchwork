import { NextRequest } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { validateSessionTokenDetailed } from "@/lib/auth";
import { userNotificationHub } from "@/lib/notification-realtime";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true, skipTouch: true });
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(
          encoder.encode(
            `event: connected\ndata: ${JSON.stringify({ status: "connected" })}\n\n`
          )
        );

        unsubscribe = await userNotificationHub.subscribe(auth.user.id, (notificationId) => {
          try {
            controller.enqueue(
              encoder.encode(
                `event: notification\ndata: ${JSON.stringify({ notificationId })}\n\n`
              )
            );
          } catch {
            // Stream closed
          }
        });

        heartbeatTimer = setInterval(async () => {
          try {
            const check = await validateSessionTokenDetailed(auth.session.id, {
              skipTouch: true,
            });
            if (!check.auth) {
              if (heartbeatTimer) clearInterval(heartbeatTimer);
              if (unsubscribe) unsubscribe();
              try {
                controller.enqueue(
                  encoder.encode(
                    `event: session_expired\ndata: ${JSON.stringify({
                      reason: check.reason || "invalid",
                    })}\n\n`
                  )
                );
                controller.close();
              } catch {
                // already closed
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
            // already closed
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
