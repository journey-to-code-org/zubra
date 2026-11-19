import { getSlice } from '#lib/server/slice.js';

/** What's left on the menu, pushed as server-sent events whenever it changes. */
export async function GET({ request }) {
  const slice = await getSlice();
  const rows = (menu) => JSON.stringify(menu.flatMap(({ items }) => items.map((item) => [item.key, item.left])));
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (menu) => controller.enqueue(encoder.encode(`data: ${rows(menu)}\n\n`));
      send(slice.menu());
      const unsubscribe = slice.subscribe(send);
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
