// Importing a .zb file defines its element. These three are the page; the examples import the rest.
import './components/zubra-welcome.zb';
import './components/hello-counter.zb';
import './components/zubra-examples.zb';

// The element is a standard custom element: listen for its events like any other.
const counter = document.querySelector('hello-counter');
counter.addEventListener('countchange', (event) => {
  document.querySelector('#seen').textContent = event.detail;
});
