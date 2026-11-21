// Which pushes start CI (.github/workflows/ci.yml). release-check.yml creates a tag named
// release-check-<run id>-<attempt> with RELEASE_TOKEN and deletes it in the same step. A token
// other than the workflow's own starts push workflows, so that tag must not be a CI ref: the
// checkout fails once the tag is gone. Branch pushes and a release's own tag still start CI.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflows = new URL('../.github/workflows/', import.meta.url);
const ci = readFileSync(new URL('ci.yml', workflows), 'utf8');
const releaseCheck = readFileSync(new URL('release-check.yml', workflows), 'utf8');

function quotedList(source, key) {
  const match = source.match(new RegExp(`^ {4}${key}:\\n((?: {6}- .*\\n)*)`, 'm'));
  assert.ok(match, `push.${key}`);
  return [...match[1].matchAll(/- "([^"]*)"/g)].map((hit) => hit[1]);
}

function pushFilters(source) {
  const header = source.split(/^jobs:/m)[0];
  const push = header.split(/^ {2}pull_request:/m)[0];
  return { branches: quotedList(push, 'branches'), tagsIgnore: quotedList(push, 'tags-ignore') };
}

// GitHub's push filter: `*` does not match `/`, `**` does, and a later matching pattern wins.
function glob(pattern, name) {
  let expression = '';
  for (let i = 0; i < pattern.length; i++) {
    if (pattern.startsWith('**', i)) {
      expression += '.*';
      i += 1;
    } else if (pattern[i] === '*') expression += '[^/]*';
    else if (pattern[i] === '?') expression += '[^/]';
    else expression += pattern[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${expression}$`).test(name);
}

function matches(patterns, name) {
  let result = false;
  for (const pattern of patterns) {
    const negate = pattern.startsWith('!');
    if (glob(negate ? pattern.slice(1) : pattern, name)) result = !negate;
  }
  return result;
}

function runsOnPush(filters, ref) {
  if (ref.startsWith('refs/heads/')) return matches(filters.branches, ref.slice('refs/heads/'.length));
  // tags-ignore runs a tag push unless the tag name matches. A tags filter with no
  // branches filter would drop branch pushes, so both lists have to be present.
  if (ref.startsWith('refs/tags/')) return !matches(filters.tagsIgnore, ref.slice('refs/tags/'.length));
  return false;
}

test('CI runs for branch pushes and release tags, and not for a release-check tag', () => {
  const filters = pushFilters(ci);
  assert.deepEqual(filters.branches, ['**']);
  assert.deepEqual(filters.tagsIgnore, ['release-check-*']);
  assert.doesNotMatch(ci.split(/^jobs:/m)[0], /^ {4}tags:\s*$/m);
  // The same unfiltered `push` is what started the failing run: the tag name matches the prefix.
  assert.equal(matches(['release-check-*'], 'release-check-44873123112-1'), true);

  for (const ref of [
    'refs/heads/main',
    'refs/heads/staging/open-prs',
    'refs/heads/release/5.23.0',
    'refs/heads/fix/server-defaults',
    'refs/tags/v6.0.0',
    'refs/tags/v6.0.0-rc.0',
    'refs/tags/v5.21.0',
  ]) assert.equal(runsOnPush(filters, ref), true, ref);

  for (const ref of [
    'refs/tags/release-check-44873123112-1',
    'refs/tags/release-check-44349889574-1',
    'refs/tags/release-check-1-2',
  ]) assert.equal(runsOnPush(filters, ref), false, ref);

  assert.match(ci, /^ {2}pull_request:\s*$/m);
});

test('the release check tags this repository, then removes that same tag', () => {
  assert.match(releaseCheck, /GH_REPO: \$\{\{ github\.repository \}\}/);
  assert.match(releaseCheck, /SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(releaseCheck, /TAG: release-check-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(releaseCheck, /repos\/\$GH_REPO\/git\/refs" -f ref="refs\/tags\/\$TAG" -f sha="\$SHA"/);
  assert.match(releaseCheck, /gh api -X DELETE "repos\/\$GH_REPO\/git\/refs\/tags\/\$TAG"/);
});

test('workflow checkouts stay on the repository that is running them', () => {
  for (const file of readdirSync(workflows)) {
    const source = readFileSync(new URL(file, workflows), 'utf8');
    assert.doesNotMatch(source, /journey-to-code-org/, file);
    assert.doesNotMatch(source, /^\s*repository:/m, file);
  }
});
