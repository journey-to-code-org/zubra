// Follow the server's event streams: what's left on the menu, and this page's order.
const order = /^\/orders\/([a-z0-9]+)$/.exec(location.pathname);
if (document.querySelector('slice-item')) {
  new EventSource('/live').onmessage = (event) => {
    for (const [key, left] of JSON.parse(event.data)) {
      const item = document.querySelector(`slice-item[item="${key}"]`);
      if (item) item.leftNow = left;
    }
  };
}
if (order) {
  new EventSource(`/live/orders/${order[1]}`).onmessage = (event) => {
    const steps = document.querySelector('slice-steps');
    if (steps) steps.status = JSON.parse(event.data);
  };
}
