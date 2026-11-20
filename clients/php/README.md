# zubra for PHP

Render [Zubra](https://github.com/zubra-js/zubra) web components from Laravel, or any PHP app, with no Node.js anywhere. The components are compiled by the Zubra compiler (a Rust binary) running as one long-lived `zubra serve` process; the browser hydrates the HTML your server wrote.

It isn't on Packagist yet, and Composer can't install it straight from GitHub: its `composer.json` is in `clients/php/`, not at the repository's root, which is where a `vcs` repository looks. Install it from a checkout instead, as a `path` repository, and put a compiler where it can find it (see "Finding the compiler"):

```sh
git clone https://github.com/zubra-js/zubra ../zubra
```

```json
"repositories": [{ "type": "path", "url": "../zubra/clients/php" }]
```

then `composer require zubra/zubra:@dev`. (`@dev`, because a `path` package's version is its checkout's branch, `dev-main`. Composer symlinks it, so `git pull` in the checkout updates it; add `"options": { "symlink": false }` to copy it instead, for a deploy.)

```php
$zubra = new Zubra\Zubra(__DIR__ . '/components');      // a folder of .zb files
$page = $zubra->page();                                 // one per request
echo $page->render('price-tag', ['amount' => 12]);      // server-rendered HTML
echo $page->head();                                     // <style data-zb-components>…</style>, for <head>
echo $page->scripts();                                  // <script type="module">…</script>, before </body>
```

Serve `$zubra->js($name)` at `/components/<name>.js` and `@zubra/runtime`'s ES modules (from the npm package) wherever your import map points; the page works without them, and they make it interactive.

## Laravel

The service provider is discovered automatically. Components go in `resources/components` (or set `zubra.components` in `config/zubra.php`, with `compiler`, `route` and `scripts_base` beside it).

```blade
@zubra('plot-map', ['plots' => $plots, 'columns' => 4])   {{-- in a view --}}
@zubraHead                                                 {{-- in the layout's <head> --}}
@zubraScripts                                              {{-- before </body> --}}
```

The provider registers a page per request, a route for the modules (`/components/{name}.js`), and a global middleware that fills in `@zubraHead` and `@zubraScripts` after the response is rendered, so the layout's `<head>` gets the CSS of components the view renders further down.

## Finding the compiler

In order: the `$compiler` argument (`zubra.compiler` in Laravel), `$ZUBRA_COMPILER`, then `zubra` on the `PATH`. Download a binary from the project's [releases](https://github.com/zubra-js/zubra/releases). `proc_open` must be enabled.

## When the compiler misbehaves

Every failure is a `Zubra\ZubraException`: a component that doesn't compile, a compiler that can't run, one that stops or answers with something that isn't JSON, and a request that takes longer than the timeout (30 seconds by default; `null` waits). After any of the last three the compiler process is replaced, so a later request can never be handed an earlier one's answer.

## Tests

```sh
php tests/run.php      # against $ZUBRA_COMPILER, or the repository's cargo build; no dependencies
```

The Laravel middleware runs there with stand-ins for a request and a response, and the Blade directives are checked by what they compile to. The provider itself (`ZubraServiceProvider`) needs Laravel to run and isn't exercised by these tests.
