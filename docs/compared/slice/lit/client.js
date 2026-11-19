// Hydrate the server-rendered elements, then follow the live feeds: the menu, and this page's order.
import '@lit-labs/ssr-client/lit-element-hydrate-support.js';
import './slice-item.js';
import './slice-steps.js';

if (document.querySelector('slice-item')) {
  new EventSource('/live').onmessage = (event) => {
    for (const [key, left] of JSON.parse(event.data)) {
      const item = document.querySelector(`slice-item[item="${key}"]`);
      if (item) item.left = left;
    }
  };
}
const order = /^\/orders\/([a-z0-9]+)$/.exec(location.pathname);
if (order) {
  new EventSource(`/live/orders/${order[1]}`).onmessage = (event) => {
    document.querySelector('slice-steps').status = JSON.parse(event.data);
  };
}
