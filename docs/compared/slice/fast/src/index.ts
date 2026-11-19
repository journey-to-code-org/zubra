// Reuse the server-rendered items, then follow the live feed.
import { enableHydration } from '@microsoft/fast-element/hydration.js';

enableHydration();
const { SliceItem } = await import('./slice-item/slice-item.js');
await import('./slice-steps/slice-steps.js');

if (document.querySelector('slice-item')) new EventSource('/live').onmessage = (event) => {
  for (const [key, left] of JSON.parse(event.data) as [string, number | null][]) {
    const item = document.querySelector<InstanceType<typeof SliceItem>>(`slice-item[item="${key}"]`);
    if (!item) continue;
    item.left = left ?? -1;
    item.closest('li')?.toggleAttribute('data-out', left != null && left <= 0);
  }
};

const order = /^\/orders\/([a-z0-9]+)$/.exec(location.pathname);
if (order) {
  new EventSource(`/live/orders/${order[1]}`).onmessage = (event) => {
    const steps = document.querySelector('slice-steps') as (HTMLElement & { status: string }) | null;
    if (steps) steps.status = JSON.parse(event.data);
  };
}
