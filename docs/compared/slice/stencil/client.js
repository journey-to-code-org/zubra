// Follow the live feeds: set each item's `left` and the order's `status`; Stencil re-renders them.
if (document.querySelector('slice-item')) {
  new EventSource('/live').onmessage = (event) => {
    for (const [key, left] of JSON.parse(event.data)) {
      const item = document.querySelector(`slice-item[item="${key}"]`);
      if (!item) continue;
      item.left = left;
      item.closest('li')?.classList.toggle('out', left != null && left <= 0);
    }
  };
}
const order = /^\/orders\/([a-z0-9]+)$/.exec(location.pathname);
if (order) {
  new EventSource(`/live/orders/${order[1]}`).onmessage = (event) => {
    document.querySelector('slice-steps').status = JSON.parse(event.data);
  };
}
