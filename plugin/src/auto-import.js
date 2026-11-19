// `autoImport`: an app file that uses a component's tag gets the component's import written for
// it. These are the two halves that only read and write text: which tags a file uses, and where
// in a file of each kind an import goes. index.js knows which component each tag is.

/** The kind of file an import can be added to, or null: Svelte, Vue, or JSX. */
export function kindOf(path) {
  if (path.endsWith('.svelte')) return 'svelte';
  if (path.endsWith('.vue')) return 'vue';
  if (/\.[jt]sx$/.test(path)) return 'jsx';
  return null;
}

/**
 * Custom element tags opened in `code`, in order, each once. Read as text: a tag inside a string
 * or a comment counts too, which costs at most an import the file didn't need.
 */
export function tagsIn(code) {
  const found = new Set();
  for (const match of code.matchAll(/<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?=[\s/>])/g)) found.add(match[1]);
  return [...found];
}

/**
 * `code` with a side-effect import of each of `specifiers`. They go on a line that is already
 * there, so every line of the file keeps its number:
 * - JSX: at the top, after a directive (`'use client'`) if the file starts with one;
 * - Svelte: at the start of the component's `<script>` (not its `module` one), or in a new one;
 * - Vue: at the start of `<script setup>`, else of `<script>`, or in a new `<script setup>`.
 */
export function withImports(code, kind, specifiers) {
  if (!specifiers.length) return code;
  const imports = specifiers.map((specifier) => `import ${JSON.stringify(specifier)};`).join('');
  const after = (index) => code.slice(0, index) + imports + code.slice(index);
  if (kind === 'jsx') {
    // Comments and blank lines, then directives: an import before a directive would undo it.
    const prologue = code.match(/^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*(?:(?:'use [^'\n]*'|"use [^"\n]*")[ \t]*;?[ \t]*)+/);
    if (!prologue) return after(0);
    // `'use client'` with no semicolon ends at its line's end, which the import would take away.
    const at = prologue[0].length;
    return code.slice(0, at) + (/;\s*$/.test(prologue[0]) ? '' : ';') + imports + code.slice(at);
  }
  // A block's opening tag at the start of a line, so one inside the template isn't taken for it.
  const scripts = [...code.matchAll(/^<script\b([^>]*)>/gm)];
  if (kind === 'svelte') {
    const own = scripts.find((script) => !/\bmodule\b/.test(script[1]));
    return own ? after(own.index + own[0].length) : `<script>${imports}</script>${code}`;
  }
  const block = scripts.find((script) => /\bsetup\b/.test(script[1])) ?? scripts[0];
  return block ? after(block.index + block[0].length) : `${code}${code.endsWith('\n') ? '' : '\n'}<script setup>${imports}</script>\n`;
}
