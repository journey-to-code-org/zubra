// `npm start`: the help desk on http://localhost:3000 (PORT), with MongoDB when MONGODB_URI is
// set and an in-memory store otherwise.
import { createApp } from './src/app.js';
import { createStore } from './src/store/index.js';

let store;
try {
  store = await createStore();
} catch (error) {
  console.error(`Couldn't open the store (${process.env.MONGODB_URI ? 'MongoDB at MONGODB_URI' : 'memory'}): ${error.message}`);
  process.exit(1);
}
let app;
try {
  // (Production unless NODE_ENV=development: then an edited component shows on the next request,
  // and an error's page says what went wrong.)
  app = createApp({ store });
} catch (error) {
  console.error(error.message); // no compiler: what to do about it
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`help desk on http://localhost:${port} (${store.kind} store)`));
