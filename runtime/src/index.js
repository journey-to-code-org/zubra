// @zubra/runtime — everything compiled components and their scripts import: the core, the
// binders and $define. A bundler keeps only what's imported.
export * from './core.js';
// Modules compiled for interfaces 2 and 3, and 5.17's interface 4 output, import these from here
// ($when and $each are the core's); @zubra/server's output imports each from its own entry.
export { $define } from './legacy.js';
export { $await } from './await.js';
export { $slot, $slotted } from './slots.js';
