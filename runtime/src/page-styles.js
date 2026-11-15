// A light-DOM component whose CSS the bundler already put in the page (@zubra/unplugin imports
// the component's stylesheet): the page has the CSS, so the module needn't carry it as text too.
// Only an element inside someone else's shadow root, where page CSS doesn't reach, needs a sheet
// of its own: this copies the component's rules from the page's stylesheets into one, with the
// `@layer`, `@media` and `@supports` blocks they're in. (The compiler scopes a light-DOM
// component's CSS as `@scope (tag) to (…)`, which is how its rules are found.)

/** @internal What interface 4 output names as `stylesFromPage`: the tag's rules from the page, as a sheet, or null. */
export function $pageStyles(tag) {
  const scoped = new RegExp(`^@scope\\s*\\(\\s*${tag}\\s*\\)`);
  const found = [];
  const visit = (rules, before, after) => {
    for (const rule of rules) {
      const text = rule.cssText;
      if (scoped.test(text)) found.push(before + text + after);
      else if (rule.cssRules && text.startsWith('@')) visit(rule.cssRules, `${before}${text.slice(0, text.indexOf('{') + 1)}\n`, `\n}${after}`);
    }
  };
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // another origin's stylesheet, which a page can't read
    }
    visit(rules, '', '');
  }
  // Not there yet (a stylesheet still loading): nothing now, and asked again for the next element.
  if (!found.length) return null;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(found.join('\n'));
  return sheet;
}
