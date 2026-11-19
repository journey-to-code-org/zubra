// What the pane shows, as HTML, from what `__ZUBRA_DEVTOOLS__.inspect($0)` returned (see
// runtime/src/devtools.js for the shape). A pure function, so it's tested without a browser.

export const VERSION = 1;

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fileName = (file) => String(file).split(/[\\/]/).pop();

/** A source location: a button that opens the editor there, or plain text without a file. */
function where(file, at, label = null) {
  if (!at) return '<span class="where none" title="Compile with --devtools (Vite\'s dev server does) for source lines">no line</span>';
  const text = label ?? `${file ? `${fileName(file)}:` : 'line '}${at.line}`;
  if (!file) return `<span class="where">${escape(text)}</span>`;
  return `<button type="button" class="where" data-file="${escape(file)}" data-line="${at.line}" data-column="${at.column}" title="Open ${escape(file)}:${at.line}:${at.column} in the editor">${escape(text)}</button>`;
}

function values(title, list, empty) {
  const rows = list.length
    ? list.map(({ name, value }) => `<div class="row"><dt>${escape(name)}</dt><dd><code>${escape(value)}</code></dd></div>`).join('')
    : `<p class="quiet">${escape(empty)}</p>`;
  return `<section><h2>${escape(title)}</h2><dl>${rows}</dl></section>`;
}

function bindings(list, file) {
  return `<ul class="bindings">${list.map((binding) => `<li class="${binding.ranLast ? 'ran' : ''}">
  <div class="op"><code>${escape(binding.operation)}</code>${binding.ranLast ? '<span class="badge" title="Re-ran in the last update">ran</span>' : ''}</div>
  <div class="meta"><span class="target">${escape(binding.target)}</span> ${where(file, binding.at, binding.at ? `line ${binding.at.line}` : null)}</div>
  ${binding.dependsOn.length ? `<div class="reads">reads ${binding.dependsOn.map((name) => `<code>${escape(name)}</code>`).join(', ')}</div>` : ''}
  ${why(binding)}
</li>`).join('')}</ul>`;
}

/** Why a binding re-ran in the last update (a runtime from before 6.0 doesn't say). */
function why(binding) {
  if (!binding.ranLast || !Array.isArray(binding.because)) return '';
  if (!binding.because.length) return '<div class="why quiet">re-ran: what changed has no name here</div>';
  return `<div class="why">re-ran because ${list(binding.because)} changed</div>`;
}

const list = (names) => names.map((name) => `<code>${escape(name)}</code>`).join(', ');
const count = (n) => Number(n).toLocaleString('en-US');

/** Which engine the page runs (older runtimes only say native or not). */
function engine(result) {
  if (result.engine === 'zubra') return "Zubra's engine";
  if (result.engine === 'tc39') return `TC39 Signals, ${result.native ? 'native <code>Signal</code>' : "Zubra's implementation"}`;
  return `Signals: ${result.native ? 'native <code>Signal</code>' : 'polyfill'}`;
}

/** The component's signals: value, changes, what reads each, what a computed reads. */
function signals(items) {
  if (!Array.isArray(items) || !items.length) return '';
  const rows = items.map((item) => `<li>
  <div class="op"><code>${escape(item.name)}</code><span class="kind">${escape(item.kind)}</span>${item.changes === null || item.changes === undefined ? '' : `<span class="quiet" title="Times it was given a new value. A change inside an array or object it holds counts on that property's own signal, not here.">changed ${count(item.changes)}×</span>`}</div>
  <div class="meta"><code>${escape(item.value)}</code></div>
  ${item.reads?.length ? `<div class="reads">reads ${list(item.reads)}</div>` : ''}
  <div class="reads">${item.readers ? `read by ${list(item.readBy)}${item.readers > item.readBy.length ? ` and ${count(item.readers - item.readBy.length)} more` : ''}` : 'read by nothing live'}</div>
</li>`).join('');
  return `<section><details open><summary><h2>Signals (${items.length})</h2></summary><ul class="signals">${rows}</ul></details></section>`;
}

/** A small line of the page's live effects over the last updates. */
function sparkline(history) {
  if (history.length < 2) return '';
  const values = history.map((point) => point.effects);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const points = values.map((value, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(18 - ((value - low) / span) * 16).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}"/></svg>`;
}

/** Live effects in the component and on the page, and how the page's count moved. */
function live(counts) {
  if (!counts) return '';
  const history = counts.history ?? [];
  let trend = '';
  if (history.length >= 2) {
    const first = history[0];
    const change = history[history.length - 1].effects - first.effects;
    const span = history.length - 1;
    trend = `<p class="quiet small">${change === 0 ? 'unchanged' : `${change > 0 ? '+' : '−'}${count(Math.abs(change))}`} over the last ${span} update${span === 1 ? '' : 's'}${change > 0 && onlyGrew(history) ? ' <span class="note">(it has only grown)</span>' : ''}</p>${sparkline(history)}`;
  }
  return `<section><h2>Live</h2><p class="small">${count(counts.component)} effects in this component · ${count(counts.components)} component${counts.components === 1 ? '' : 's'} on the page · ${count(counts.page)} effects alive of those made since the pane connected</p>${trend}<p class="quiet small">Alive: not disposed, and not yet collected (a removed element's effects leave when the browser collects them).</p></section>`;
}

/** Whether the page's count only grew over the history (never fell): worth a look for a leak. */
const onlyGrew = (history) => history.length >= 5 && history.every((point, i) => i === 0 || point.effects >= history[i - 1].effects) && history[history.length - 1].effects > history[0].effects;

/** The last updates on the page, newest first. */
function timeline(entries) {
  if (!Array.isArray(entries) || !entries.length) return '';
  const items = [...entries].reverse().map((update) => {
    const wrote = update.written.map((write) => `<code>${escape(write.name ?? 'an unnamed signal')}</code>${write.from === null ? ` → <code>${escape(write.to)}</code>` : ` <code>${escape(write.from)}</code> → <code>${escape(write.to)}</code>`}`);
    if (update.writes > update.written.length) wrote.push(`and ${count(update.writes - update.written.length)} more`);
    const reran = update.reran.slice(0, 6).map((name) => `<code>${escape(name)}</code>`);
    if (update.ran > 6) reran.push(`and ${count(update.ran - 6)} more`);
    return `<li><div class="op"><b>${count(update.number)}</b><span class="quiet">${escape(update.took)} ms</span></div>
  ${wrote.length ? `<div class="reads">wrote ${wrote.join(', ')}</div>` : '<div class="reads">no named writes</div>'}
  <div class="reads">re-ran ${count(update.ran)}: ${reran.join(', ')}</div></li>`;
  }).join('');
  return `<section><details><summary><h2>Updates (${entries.length})</h2></summary><ul class="timeline">${items}</ul></details></section>`;
}

/** The pane's content for one reading. */
export function render(result) {
  if (!result || result.missing) {
    return `<p class="note">No Zubra development runtime on this page.</p>
<p class="quiet">Run the app with Vite's dev server and <code>@zubra/unplugin</code>, which compiles components for this pane. A production build has no hook, by design.</p>`;
  }
  if (result.error) return `<p class="note">Couldn't read the page: ${escape(result.error)}</p>`;
  if (result.loading) return '<p class="quiet">Connecting…</p>';
  if (result.version !== VERSION) {
    return `<p class="note">This page's runtime speaks DevTools version ${escape(result.version)}; this extension reads version ${VERSION}. Update whichever is older.</p>`;
  }
  if (!result.component) {
    return '<p class="quiet">Not inside a Zubra component. Select an element a <code>.zb</code> component renders, or its host.</p>';
  }
  const { component } = result;
  const file = component.file;
  const here = result.bindings.filter((binding) => binding.here);
  const rest = result.bindings.filter((binding) => !binding.here);
  const update = result.lastUpdate;
  return `<header>
  <h1><code>&lt;${escape(component.tag)}&gt;</code></h1>
  ${file ? where(file, component.at, `${fileName(file)}:${component.at?.line ?? 1}`) : '<span class="where none" title="Compile with --devtools (Vite\'s dev server does) for its file and lines">not located</span>'}
</header>
<p class="quiet small">${engine(result)}${update.number ? ` · update ${update.number}: ${update.written.length ? `wrote ${update.written.map((name) => `<code>${escape(name)}</code>`).join(', ')}` : 'no named writes'}, ${update.ran} of this component's bindings re-ran` : ''}</p>
${values('Props', result.props, 'No props.')}
${values('State', result.state, component.located ? 'No state.' : 'Names need a --devtools build.')}
${here.length ? `<section><h2>On this node</h2>${bindings(here, file)}</section>` : ''}
${result.setBy ? `<section><h2>Set by <code>&lt;${escape(result.setBy.tag)}&gt;</code></h2>${bindings(result.setBy.bindings, result.setBy.file)}</section>` : ''}
<section><details${here.length ? '' : ' open'}><summary><h2>All bindings (${rest.length + here.length})</h2></summary>${bindings(rest, file)}</details></section>
${signals(result.signals)}
${live(result.live)}
${timeline(result.timeline)}`;
}
