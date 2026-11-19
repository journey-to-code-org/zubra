import { currentGuest } from '../../../../lib/slice.js';

export const dynamic = 'force-dynamic';

/** This guest's order's status, pushed as server-sent events whenever the kitchen moves it. */
export async function GET(request, { params }) {
  const { slice, guest } = await currentGuest();
  const order = slice.order(guest, (await params).key);
  if (!order) return new Response(null, { status: 404 });
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (one) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(one.status)}\n\n`));
      send(order);
      const unsubscribe = slice.watchOrder(order.key, send);
      const ping = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 25_000);
      stop = () => {
        unsubscribe();
        clearInterval(ping);
      };
      request.signal.addEventListener('abort', () => {
        stop();
        try { controller.close(); } catch {}
      });
    },
    cancel: () => stop(),
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
}
