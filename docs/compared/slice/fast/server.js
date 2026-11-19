// The slice in FAST: FAST 3 declarative templates, compiled and rendered per request by WebUI's
// fast-v3 plugin (FAST's recommended production renderer), the item hydrated by FAST,
// and the menu kept live with server-sent events.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Protocol } from '@microsoft/webui';
import { createSlice, money, pickupWords } from 'counter-slice-backend';

const here = import.meta.dirname;
const css = readFileSync(join(here, 'node_modules', 'counter-slice-backend', 'slice.css'));
const client = readFileSync(join(here, 'dist', 'client.js'));
const protocol = new Protocol(readFileSync(join(here, 'dist', 'protocol.bin')), { plugin: "fast-v3" });

export async function createApp(options = {}) {
  const slice = await createSlice(options);
  const { shop } = slice;

  // Everything the templates bind to. Templates can't do arithmetic, so the server works it out.
  const menuState = () => ({
    page: 'menu',
    live: true,
    title: 'Menu',
    sections: slice.menu().map(({ section, items }) => ({
      section,
      items: items.map((item) => ({ key: item.key, name: item.name, unit: item.unit, price: money(item.cents), left: item.left ?? -1, out: item.left != null && item.left <= 0 })),
    })),
  });
  const orderState = (guest) => {
    const cart = slice.cart(guest);
    const times = slice.times();
    const chosen = slice.pickup(guest);
    return {
      page: 'order',
      title: 'Your order',
      ready: cart.lines.length > 0 && Boolean(chosen),
      lines: cart.lines.map((line) => ({ item: line.item, name: line.name, each: money(line.cents), total: money(line.total), qty: line.qty, less: line.qty - 1, more: line.qty + 1 })),
      total: money(cart.cents),
      times: times.map((one) => ({ slot: one.slot, text: `${one.day} ${one.label}${one.full ? ' (full)' : ''}`, full: one.full, chosen: one.slot === chosen })),
      pickup: chosen ? pickupWords(times, chosen) : '',
    };
  };

  const checkoutState = (guest) => {
    const cart = slice.cart(guest);
    return {
      page: 'checkout',
      title: 'Check out',
      summary: `${cart.count} item${cart.count === 1 ? '' : 's'} · ${money(cart.cents)} · pickup ${pickupWords(slice.times(), slice.pickup(guest))}`,
      total: money(cart.cents),
      checkout: slice.checkoutKey(),
    };
  };

  /** A server-sent event stream: `first` now, then whatever `watch` sends, as `encode` writes it. */
  const stream = (req, res, first, watch, encode) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    res.write(`data: ${encode(first)}\n\n`);
    const unsubscribe = watch((value) => res.write(`data: ${encode(value)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      unsubscribe();
      clearInterval(ping);
    });
  };

  const readForm = (req) =>
    new Promise((resolve, reject) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 10_000) req.destroy();
      });
      req.on('end', () => resolve(new URLSearchParams(body)));
      req.on('error', reject);
    });
  const back = (res, location, headers = {}) => res.writeHead(303, { location, ...headers }).end();
  const send = (res, state, headers = {}, status = 200) => res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers }).end(protocol.render(state));
  const rows = (menu) => JSON.stringify(menu.flatMap(({ items }) => items.map((item) => [item.key, item.left])));

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://slice');
      if (url.pathname === '/slice.css') return res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'public, max-age=3600' }).end(css);
      if (url.pathname === '/client.js') return res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=3600' }).end(client);
      if (url.pathname === '/live') return stream(req, res, slice.menu(), (send) => slice.subscribe(send), rows);
      const watching = /^\/live\/orders\/([a-z0-9]+)$/.exec(url.pathname);
      if (watching) {
        const order = slice.order(slice.guest(req.headers.cookie).guest, watching[1]);
        if (!order) return res.writeHead(404).end();
        return stream(req, res, order, (send) => slice.watchOrder(order.key, send), (one) => JSON.stringify(one.status));
      }
      const { guest, setCookie } = slice.guest(req.headers.cookie);
      const cookie = setCookie ? { 'set-cookie': setCookie } : {};
      if (req.method === 'POST') {
        const form = await readForm(req);
        if (url.pathname === '/add') {
          const done = await slice.add(guest, { item: form.get('item'), qty: form.get('qty') });
          return back(res, slice.back('/', done.ok ? { done: 'Added to your order.' } : { problem: done.error }), cookie);
        }
        if (url.pathname === '/change') {
          const done = await slice.change(guest, { item: form.get('item'), qty: form.get('qty') });
          return back(res, slice.back('/order', done.ok ? {} : { problem: done.error }), cookie);
        }
        if (url.pathname === '/place') {
          const done = await slice.place(guest, { checkout: form.get('checkout'), name: form.get('name'), email: form.get('email'), card: form.get('card') });
          return back(res, done.ok ? `/orders/${done.key}` : slice.back(done.back ?? '/checkout', { problem: done.error }), cookie);
        }
        if (url.pathname === '/time') {
          const done = await slice.choose(guest, form.get('slot'));
          return back(res, slice.back('/order', done.ok ? {} : { problem: done.error }), cookie);
        }
        return res.writeHead(404).end();
      }
      const common = { shop: shop.name, count: slice.cart(guest).count, ...slice.said(url) };
      if (url.pathname === '/') return send(res, { ...common, ...menuState() }, cookie);
      if (url.pathname === '/order') return send(res, { ...common, ...orderState(guest) }, cookie);
      if (url.pathname === '/checkout') {
        if (!slice.cart(guest).lines.length) return back(res, slice.back('/order', { problem: 'Your bag is empty.' }), cookie);
        if (!slice.pickup(guest)) return back(res, slice.back('/order', { problem: 'Choose a pickup time first.' }), cookie);
        return send(res, { ...common, ...checkoutState(guest) }, cookie);
      }
      const ordered = /^\/orders\/([a-z0-9]+)$/.exec(url.pathname);
      if (ordered) {
        const order = slice.order(guest, ordered[1]);
        if (!order) return send(res, { ...common, page: 'missing', title: 'Not found' }, cookie, 404);
        return send(res, { ...common, page: 'placed', title: 'Your order', live: true, order }, cookie);
      }
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('Something went wrong.');
    }
  });
  return server;
}

if (import.meta.main) {
  const server = await createApp();
  server.listen(Number(process.env.PORT ?? 3109), () => console.log(`FAST slice on http://localhost:${server.address().port}`));
}
