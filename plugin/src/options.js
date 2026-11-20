// The plugin's options, checked as @zubra/server checks its own: which reactive engine, and
// option names it doesn't know. (server/src/options.js is the same file: keep the two in step.)

export const ENGINES = ['zubra', 'signals'];

/**
 * The engine `options` ask for: `'zubra'` (the default) or `'signals'` (experimental: the TC39
 * Signals API). `signals: true`, which 6.0.0-rc.0 shipped, still means `engine: 'signals'`, and
 * `say` is told to write that instead. Anything else is an error that names the two engines.
 */
export function engineOf(options, who, say) {
  const { engine, signals } = options;
  if (engine !== undefined && !ENGINES.includes(engine)) {
    throw new TypeError(`${who}: engine: ${describe(engine)} isn't an engine; it is 'zubra' (the default) or 'signals' (experimental: the TC39 Signals API)`);
  }
  if (signals === undefined) return engine ?? 'zubra';
  if (typeof signals !== 'boolean') {
    throw new TypeError(`${who}: signals: ${describe(signals)} isn't true or false; write engine: 'signals' (or 'zubra', the default)`);
  }
  const named = signals ? 'signals' : 'zubra';
  if (engine !== undefined && engine !== named) {
    throw new TypeError(`${who}: engine: '${engine}' and signals: ${signals} disagree; write engine alone`);
  }
  say?.(`${who}: signals: ${signals} is engine: '${named}' since 6.0; write engine: '${named}'`);
  return named;
}

/**
 * Option names `known` doesn't have, each with the nearest known one: `signal` (or `signals`
 * misspelled) is `engine: 'signals'`.
 */
export function unknownOptions(options, known, who) {
  const found = [];
  for (const name of Object.keys(options)) {
    if (known.includes(name) || options[name] === undefined) continue;
    const near = /^signal|^tc39/i.test(name) ? "engine: 'signals'" : nearest(name, known);
    found.push(`${who}: unknown option \`${name}\`${near ? `; did you mean \`${near}\`?` : ''} (it has ${known.filter((one) => one !== 'signals').join(', ')})`);
  }
  return found;
}

function describe(value) {
  return typeof value === 'string' ? `'${value}'` : String(value);
}

function nearest(name, known) {
  let best = null;
  let bestDistance = Infinity;
  for (const one of known) {
    const distance = editDistance(name.toLowerCase(), one.toLowerCase());
    if (distance < bestDistance) [best, bestDistance] = [one, distance];
  }
  return bestDistance <= Math.max(1, Math.floor(Math.max(name.length, best?.length ?? 0) / 3)) ? best : null;
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length];
}
