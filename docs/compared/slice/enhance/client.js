// Enhance the server's elements, then follow the live feeds: the menu, and this page's order.
import enhance from '@enhance/element';
import SliceItem from './slice-item.js';
import SliceSteps from './slice-steps.js';

enhance('slice-item', { ...SliceItem });
enhance('slice-steps', { ...SliceSteps });

if (document.querySelector('slice-item')) {
  new EventSource('/live').onmessage = (event) => {
    for (const [key, left] of JSON.parse(event.data)) {
      const item = document.querySelector(`slice-item[item="${key}"]`);
      if (!item) continue;
      item.setAttribute('left', left ?? '');
      item.closest('li')?.classList.toggle('out', left != null && left <= 0);
    }
  };
}
const order = /^\/orders\/([a-z0-9]+)$/.exec(location.pathname);
if (order) {
  new EventSource(`/live/orders/${order[1]}`).onmessage = (event) => {
    document.querySelector('slice-steps').setAttribute('status', JSON.parse(event.data));
  };
}
