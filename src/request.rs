//! The compiler as one function: a JSON request in, a JSON response out.
//!
//! This is what the WebAssembly build exposes (and what anything embedding the compiler can
//! use): no filesystem, no process. The request carries every source the compilation needs, so
//! `.zb` imports resolve against `files` the way the CLI resolves them against the disk.
//!
//! ```json
//! { "command": "compile", "emit": "js", "path": "/app/inbox.zb",
//!   "files": { "/app/inbox.zb": "…", "/app/badge.zb": "…" },
//!   "runtime": "@zubra/runtime", "keepImports": true, "devtools": true,
//!   "cssImport": "…", "cssImportInline": "…", "stylesHref": "/_zubra/components/inbox.css",
//!   "framework": "react",
//!   "modulePath": "inbox.js", "props": {}, "slots": {}, "slotSource": "html", "partial": true,
//!   "pending": ["reviews"], "gaps": true }
//! ```
//!
//! The response is `{ "ok", "output", "error", "warnings", "diagnostics" }` (and `omitted`, on
//! success: attributes a render left out because their values weren't safe URLs; and `gaps`, when
//! a partial HTML render is asked for them with `"gaps": true`: what it left for the browser): `output` is the
//! compiled text, `error` and `warnings` are rendered for a terminal, and `diagnostics` has
//! each one as `{ file, line, column, severity, message, help }` for editors. `command: "check"`
//! runs every check without producing output, and `command: "format"` answers with the source
//! as `zubra fmt` lays it out (`indentWidth`, `useTabs`, `printWidth`); `command: "formatRange"`
//! (`start`, `end` in bytes) answers with the one edit that formats the lines the range touches. `command: "refactor"`
//! with `action: "extract"`, `start`/`end` (byte offsets of the markup to extract) and `tag`
//! answers with the edits that turn it into a new component (see `refactor.rs`).
//! `command: "load"` with `files` keeps them and answers with a handle; a request then has
//! `"loaded": "<handle>"` where it would have `"files"`, and gets the answer the files would. A
//! compiler that doesn't have the handle answers not ok with `"reload": true`: load the files
//! again (see `loaded.rs`).
//! `command: "minify"` takes no component either: `code` (an ES module, a component's as
//! this compiler wrote it) answers with it minified, the CSS in its definition's `styles` too (see
//! `minify.rs`); a module that doesn't parse is an error.
//! `command: "join"` takes no component: `modules` (`[{ path, code }]`, browser modules) and `at`
//! (the path the result is served at), and answers with them as one module, or, not ok and with
//! `"apart": true`, with why they have to stay separate (see `joined.rs`).
//!
//! `{ "requests": [ … ] }` is a batch, answered as `{ "ok", "responses": [ … ] }`. The CLI's
//! `zubra serve` answers one request (or batch) per line, for a long-lived process.

use std::collections::HashMap;

use serde_json::{json, Map, Value};

use crate::{Diagnostic, Framework, StyleImports};

/// Handle a request (JSON text); always returns a response (JSON text), never panics on input.
pub fn handle(request: &str) -> String {
    let response = match serde_json::from_str::<Value>(request) {
        // `{ "requests": [ … ] }`: several at once, answered as `{ "ok", "responses": [ … ] }`
        // (each response as if it were sent alone), so a server renders a page in one call.
        Ok(Value::Object(mut request)) if request.contains_key("requests") => {
            match request.remove("requests") {
                Some(Value::Array(requests)) => {
                    let responses: Vec<Value> = requests
                        .into_iter()
                        .map(|request| match request {
                            Value::Object(request) => respond(request),
                            _ => failure("each of `requests` must be a JSON object"),
                        })
                        .collect();
                    json!({ "ok": responses.iter().all(|response| response["ok"] == true), "responses": responses })
                }
                _ => failure("`requests` must be an array of requests"),
            }
        }
        Ok(Value::Object(request)) => respond(request),
        Ok(_) => failure("the request must be a JSON object"),
        Err(error) => failure(&format!("the request isn't JSON: {error}")),
    };
    // Written straight to a string: `Value`'s `Display` goes through a formatter, at twice the cost
    // for a page of HTML.
    serde_json::to_string(&response).unwrap_or_else(|_| response.to_string())
}

fn failure(message: &str) -> Value {
    json!({ "ok": false, "output": null, "error": message, "warnings": [], "diagnostics": [] })
}

fn respond(mut request: Map<String, Value>) -> Value {
    // A render's props are moved into it, not copied: a list of rows is the bulk of a request.
    let props = request.remove("props");
    let request = &request;
    let text = |key: &str| request.get(key).and_then(Value::as_str);
    // `join`: several browser modules (`modules`: `[{ path, code }]`) as one, to be served at
    // `at` (see `joined.rs`). Where joining them would change what one of them sees, the answer
    // is not ok, with the reason as `error` and `"apart": true`: serve them as they are.
    if text("command") == Some("minify") {
        let Some(code) = text("code") else {
            return failure("`code` is required: the module to minify");
        };
        return match crate::minify::minify(code) {
            Ok(output) => {
                json!({ "ok": true, "output": output, "error": null, "warnings": [], "diagnostics": [] })
            }
            Err(reason) => failure(&reason),
        };
    }
    if text("command") == Some("join") {
        let Some(at) = text("at") else {
            return failure("`at` is required: the path the joined module is served at");
        };
        let Some(Value::Array(given)) = request.get("modules") else {
            return failure("`modules` must be an array of `{ path, code }`");
        };
        let mut modules = Vec::new();
        for module in given {
            match (
                module.get("path").and_then(Value::as_str),
                module.get("code").and_then(Value::as_str),
            ) {
                (Some(path), Some(code)) => modules.push(crate::joined::Module { path, code }),
                _ => return failure("each of `modules` is `{ path, code }`"),
            }
        }
        return match crate::joined::join(&modules, at) {
            Ok(output) => {
                json!({ "ok": true, "output": output, "error": null, "warnings": [], "diagnostics": [] })
            }
            Err(crate::joined::Apart(reason)) => {
                let mut response = failure(&reason);
                response["apart"] = json!(true);
                response
            }
        };
    }
    let given = |files: &Map<String, Value>| -> HashMap<String, String> {
        files
            .iter()
            .filter_map(|(path, source)| {
                source
                    .as_str()
                    .map(|source| (normalize(path), source.to_owned()))
            })
            .collect()
    };
    // `load`: keep `files` for the requests that follow, and answer with the handle they name
    // them by (`"loaded"`, where `"files"` would be). See `loaded.rs`.
    if text("command") == Some("load") {
        return match request.get("files") {
            Some(Value::Object(files)) => {
                json!({ "ok": true, "output": crate::loaded::load(given(files)), "error": null, "warnings": [], "diagnostics": [] })
            }
            _ => failure("`files` must map paths to sources"),
        };
    }
    let Some(path) = text("path") else {
        return failure("`path` is required");
    };
    // The request's files: a set loaded before, or its own.
    let set = match (text("loaded"), request.get("files")) {
        (Some(handle), None) => match crate::loaded::get(handle) {
            Some(set) => set,
            // A compiler started since, or one that let the set go: send the files again.
            None => {
                let mut response =
                    failure("`loaded` names no set this compiler has: `load` its files again");
                response["reload"] = json!(true);
                return response;
            }
        },
        (None, Some(Value::Object(files))) => {
            std::rc::Rc::new(crate::loaded::Set::new(given(files)))
        }
        (Some(_), Some(_)) => return failure("a request has `loaded` or `files`, not both"),
        _ => return failure("`files` must map paths to sources"),
    };
    crate::loaded::reading(&set, || answer(request, props, path, &set))
}

/// A request for the component at `path`, answered from `set`'s files.
/// `props`: the request's own, taken out of it to be moved into a render.
fn answer(
    request: &Map<String, Value>,
    props: Option<Value>,
    path: &str,
    set: &crate::loaded::Set,
) -> Value {
    let text = |key: &str| request.get(key).and_then(Value::as_str);
    let files = &set.files;
    let path = normalize(path);
    let Some(source) = files.get(&path) else {
        return failure(&format!("`files` has no source for `{path}`"));
    };
    let loader = |specifier: &str, from: &str| -> Result<(String, String), String> {
        // A package's component (`@acme/kit/components/cart-panel.zb`) is keyed by its specifier,
        // and its own relative imports under it: whoever reads the files found it in node_modules.
        if !is_relative(specifier) {
            let key = normalize(specifier);
            return files.get(&key).map(|source| (key.clone(), source.clone())).ok_or_else(|| {
                format!("`{specifier}` wasn't found: its package isn't installed, or doesn't export that file")
            });
        }
        let resolved = resolve(specifier, from);
        files
            .get(&resolved)
            .map(|source| (resolved.clone(), source.clone()))
            .ok_or_else(|| format!("{resolved}: not among the request's files"))
    };

    // `format`: the source laid out by `zubra fmt` (`indentWidth`, `useTabs`, `printWidth`).
    // `formatRange` (with `start` and `end`, byte offsets): the edit that formats the lines the
    // range touches, as JSON text `{ "edit": null | { start, end, text } }`.
    if matches!(text("command"), Some("format" | "formatRange")) {
        let defaults = crate::FormatOptions::default();
        let number = |key: &str, default: usize| {
            request
                .get(key)
                .and_then(Value::as_u64)
                .and_then(|value| usize::try_from(value).ok())
                .filter(|&value| value > 0)
                .unwrap_or(default)
        };
        let options = crate::FormatOptions {
            indent_width: number("indentWidth", defaults.indent_width),
            use_tabs: request
                .get("useTabs")
                .and_then(Value::as_bool)
                .unwrap_or(defaults.use_tabs),
            print_width: number("printWidth", defaults.print_width),
        };
        let result = if text("command") == Some("formatRange") {
            let offset = |key: &str| {
                request
                    .get(key)
                    .and_then(Value::as_u64)
                    .and_then(|value| usize::try_from(value).ok())
            };
            let (Some(start), Some(end)) = (offset("start"), offset("end")) else {
                return failure("`formatRange` needs `start` and `end` (byte offsets)");
            };
            crate::format_range(source, start, end, &options).map(|edit| {
                json!({ "edit": edit.map(|edit| json!({ "start": edit.start, "end": edit.end, "text": edit.text })) })
                    .to_string()
            })
        } else {
            crate::format(source, &options)
        };
        return match result {
            Ok(output) => {
                json!({ "ok": true, "output": output, "error": null, "warnings": [], "diagnostics": [] })
            }
            Err(error) => json!({
                "ok": false,
                "output": null,
                "error": error.render_in(source, &path),
                "warnings": [],
                "diagnostics": [entry(&path, &error, "error")],
            }),
        };
    }

    // `virtual`: the component as a TypeScript file for `tsc` to check, as JSON text
    // `{ code, mappings: [[generated, source, length], …] }` (byte offsets).
    if text("command") == Some("virtual") {
        return match crate::virtual_typescript_with(source, &path, &loader) {
            Ok((code, mappings)) => json!({
                "ok": true,
                "output": json!({ "code": code, "mappings": mappings }).to_string(),
                "error": null,
                "warnings": [],
                "diagnostics": [],
            }),
            Err(error) => json!({
                "ok": false,
                "output": null,
                "error": error.render_in(source, &path),
                "warnings": [],
                "diagnostics": [entry(&path, &error, "error")],
            }),
        };
    }

    // `typescript`: the JavaScript the compiler reduces a script's TypeScript to (types blanked,
    // enums lowered), for tests that run it against `tsc`'s output, and for tools that show it.
    if text("command") == Some("typescript") {
        // `compilerOptions`: as a tsconfig.json would set them.
        let compiler_options = request.get("compilerOptions").and_then(Value::as_object);
        return match crate::typescript_to_js(source, compiler_options) {
            Ok(output) => {
                json!({ "ok": true, "output": output, "error": null, "warnings": [], "diagnostics": [] })
            }
            Err(error) => json!({
                "ok": false,
                "output": null,
                "error": error.render_in(source, &path),
                "warnings": [],
                "diagnostics": [entry(&path, &error, "error")],
            }),
        };
    }

    // `refactor`: edits for the editor to apply. `action: "extract"` turns the markup in the byte
    // range `start..end` into a new component called `tag`; `output` is JSON text:
    // `{ tag, fileName, fileSource, edits: [{ start, end, text }], props, events }`.
    if text("command") == Some("refactor") {
        if text("action") != Some("extract") {
            return failure("`refactor` needs `action: \"extract\"`");
        }
        let offset = |key: &str| {
            request
                .get(key)
                .and_then(Value::as_u64)
                .and_then(|value| usize::try_from(value).ok())
        };
        let (Some(start), Some(end), Some(tag)) = (offset("start"), offset("end"), text("tag"))
        else {
            return failure("extract needs `start` and `end` (byte offsets) and `tag`");
        };
        return match crate::extract(source, start, end, tag, &path, &loader) {
            Ok(extraction) => {
                let output = json!({
                    "tag": extraction.tag,
                    "fileName": extraction.file_name,
                    "fileSource": extraction.file_source,
                    "edits": extraction.edits.iter().map(|edit| json!({
                        "start": edit.start, "end": edit.end, "text": edit.text,
                    })).collect::<Vec<_>>(),
                    "props": extraction.props,
                    "events": extraction.events,
                });
                json!({ "ok": true, "output": output.to_string(), "error": null, "warnings": [], "diagnostics": [] })
            }
            Err(error) => json!({
                "ok": false,
                "output": null,
                "error": error.render_in(source, &path),
                "warnings": [],
                "diagnostics": [entry(&path, &error, "error")],
            }),
        };
    }

    // `convert`: a React component → a zubra JSX component (`prefix` names a one-word one).
    if text("command") == Some("convert") {
        // A custom element class (`--emit element` output, or written that way): back to `.zb`.
        let element = !path.ends_with(".jsx")
            && !path.ends_with(".tsx")
            && source.contains("extends HTMLElement");
        let converted = if element {
            crate::convert_element_with(source, &path, &loader)
        } else {
            crate::convert_component(source, &path, text("prefix"), text("component"))
        };
        return match converted {
            Ok(mut conversion) => {
                // `"as": "zubra"`: the readable .zb file, once nothing is left to finish.
                if text("as") == Some("zubra")
                    && conversion.unsupported.is_empty()
                    && conversion.compile_error.is_none()
                {
                    if let Some(error) = crate::convert_as_zb(&mut conversion) {
                        conversion.unsupported.push(error);
                    }
                }
                let target = match path.rsplit_once('/') {
                    Some((directory, _)) => format!("{directory}/{}", conversion.file_name),
                    None => conversion.file_name.clone(),
                };
                let mut diagnostics: Vec<Value> = conversion
                    .unsupported
                    .iter()
                    .map(|diagnostic| entry(&path, diagnostic, "warning"))
                    .collect();
                let mut warnings: Vec<String> = conversion
                    .unsupported
                    .iter()
                    .map(|diagnostic| diagnostic.render_warning(source, &path))
                    .collect();
                if let Some(error) = &conversion.compile_error {
                    diagnostics.push(entry(&target, error, "warning"));
                    warnings.push(error.render_warning(&conversion.output, &target));
                }
                json!({
                    "ok": true,
                    "output": conversion.output,
                    "file": target,
                    "tag": conversion.tag,
                    "changes": conversion.changes,
                    "complete": diagnostics.is_empty(),
                    "error": null,
                    "warnings": warnings,
                    "diagnostics": diagnostics,
                })
            }
            Err(error) => json!({
                "ok": false,
                "output": null,
                "error": error.render_in(source, &path),
                "warnings": [],
                "diagnostics": [entry(&path, &error, "error")],
            }),
        };
    }

    let warnings = set.warnings(&path, || crate::warnings_with(source, &path, &loader));
    let mut diagnostics: Vec<Value> = warnings
        .iter()
        .map(|warning| entry(&path, warning, "warning"))
        .collect();
    let rendered_warnings: Vec<String> = warnings
        .iter()
        .map(|warning| warning.render_warning(source, &path))
        .collect();
    let runtime = text("runtime").unwrap_or("@zubra/runtime");
    let command = text("command").unwrap_or("compile");
    crate::validate::take_omitted(); // nothing left over from an earlier request
    let mut render_gaps: Vec<String> = Vec::new();
    let result = match (command, text("emit").unwrap_or("html")) {
        ("check", _) => crate::compile_js_with(source, &path, runtime, Some(".js"), &loader)
            .map(|_| String::new()),
        ("compile", "js") => {
            let style_imports = match (text("cssImport"), text("cssImportInline")) {
                (Some(stylesheet), Some(inline)) => Some(StyleImports { stylesheet, inline }),
                (None, None) => None,
                _ => return failure("`cssImport` and `cssImportInline` go together"),
            };
            let flag = |name: &str| request.get(name).and_then(Value::as_bool).unwrap_or(false);
            crate::compile_js_options(
                source,
                &path,
                &crate::JsOptions {
                    runtime,
                    component_extension: (!flag("keepImports") && style_imports.is_none())
                        .then_some(".js"),
                    style_imports,
                    // `stylesHref`: the page already has this component's CSS; see `JsOptions`.
                    styles_href: text("stylesHref").filter(|_| style_imports.is_none()),
                    devtools: flag("devtools"),
                    // `binderEntries`: each binder from its own entry (`@zubra/server`).
                    binder_entries: flag("binderEntries"),
                    // `clientOnly`: no hydration (@zubra/unplugin's `hydrate: false`).
                    client_only: flag("clientOnly"),
                },
                &loader,
            )
        }
        ("compile", "element") => {
            let keep = request
                .get("keepImports")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            crate::compile_element_with(source, &path, (!keep).then_some(".js"), &loader)
        }
        ("compile", "html") => {
            let none = json!({});
            let props = props.unwrap_or_else(|| json!({}));
            let slots = request.get("slots").unwrap_or(&none);
            let slot_source = match text("slotSource") {
                None | Some("template") => crate::SlotSource::Template,
                Some("html") => crate::SlotSource::Html,
                Some(other) => {
                    return failure(&format!(
                        "unknown slotSource `{other}`; expected template or html"
                    ))
                }
            };
            let partial = request
                .get("partial")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            // `idPrefix`: put before the id bases this render gives hosts (`id()`), so
            // components rendered separately into one page don't share ids.
            let id_prefix = text("idPrefix").unwrap_or("");
            if !id_prefix
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
            {
                return failure("`idPrefix` takes letters, digits, `-` and `_`");
            }
            // `context`: values the page provides (context key → value), see `with_provided`.
            let provided: Vec<(String, Value)> = match request.get("context") {
                None | Some(Value::Null) => Vec::new(),
                Some(Value::Object(values)) => values.clone().into_iter().collect(),
                Some(_) => return failure("`context` maps context keys to values"),
            };
            // `gaps`: also say what this render left for the browser (as `check --server` does),
            // so a server can warn that part of a component's HTML is empty without JavaScript.
            let want_gaps = partial && request.get("gaps").and_then(Value::as_bool) == Some(true);
            let render = || crate::validate::with_provided(provided, || crate::validate::with_id_prefix(id_prefix, || crate::compile_html_values(
                source,
                &path,
                props,
                slots,
                crate::HtmlOptions {
                    slot_source,
                    partial,
                    pending: request
                        .get("pending")
                        .and_then(Value::as_array)
                        .map(|names| {
                            names
                                .iter()
                                .filter_map(Value::as_str)
                                .map(str::to_owned)
                                .collect()
                        })
                        .unwrap_or_default(),
                },
                &loader,
            )));
            if want_gaps {
                let (rendered, gaps) = crate::validate::record_gaps(render);
                render_gaps = crate::describe_gaps(gaps)
                    .into_iter()
                    .map(|(gap, _)| gap.render_warning(source, &path))
                    .collect();
                rendered
            } else {
                render()
            }
        }
        ("compile", "css")
            if request
                .get("noImports")
                .and_then(Value::as_bool)
                .unwrap_or(false) =>
        {
            crate::compile_css(source)
        }
        ("compile", "css") => crate::css_with(source, &path, &loader),
        ("compile", "dts") => {
            let framework = match text("framework") {
                Some("react") => Framework::React,
                Some("vue") => Framework::Vue,
                Some("svelte") => Framework::Svelte,
                Some("solid") => Framework::Solid,
                Some("solid2") => Framework::Solid2,
                None | Some("none") => Framework::None,
                Some(other) => {
                    return failure(&format!(
                        "unknown framework `{other}`; expected react, vue, svelte, solid, solid2 or none"
                    ))
                }
            };
            crate::compile_declarations_for(source, file_name(&path), framework)
        }
        ("compile", "interface") => crate::compile_interface_with(source, &path, &loader),
        // `sourceMap`: the module ends with a map of its functions' lines to this file's.
        ("compile", "server") => crate::compile_server_at(
            source,
            (request.get("sourceMap").and_then(Value::as_bool) == Some(true)).then_some(&path),
        ),
        ("compile", "manifest") => {
            let name = file_name(&path);
            let stem = crate::components::component_extension(name)
                .map_or(name, |extension| &name[..name.len() - extension.len()]);
            let default_module = format!("{stem}.js");
            crate::compile_manifest(source, text("modulePath").unwrap_or(&default_module))
        }
        ("compile", other) => {
            return failure(&format!(
            "unknown emit `{other}`; expected html, js, element, css, dts, manifest, interface or server"
        ))
        }
        (other, _) => {
            return failure(&format!(
                "unknown command `{other}`; expected compile, check, format or convert"
            ))
        }
    };
    // `"server": true` on a check: what a server without JavaScript leaves out.
    let mut gap_errors = Vec::new();
    let mut rendered_warnings = rendered_warnings;
    if command == "check"
        && result.is_ok()
        && request.get("server").and_then(Value::as_bool) == Some(true)
    {
        match crate::server_gaps(source, &path, &loader) {
            Ok(gaps) => {
                for (gap, error) in gaps {
                    if error {
                        diagnostics.push(entry(&path, &gap, "error"));
                        gap_errors.push(gap.render_in(source, &path));
                    } else {
                        diagnostics.push(entry(&path, &gap, "warning"));
                        rendered_warnings.push(gap.render_warning(source, &path));
                    }
                }
            }
            Err(error) => {
                diagnostics.push(entry(&path, &error, "error"));
                gap_errors.push(error.render_in(source, &path));
            }
        }
    }
    if !gap_errors.is_empty() {
        return json!({
            "ok": false,
            "output": null,
            "error": gap_errors.concat(),
            "warnings": rendered_warnings,
            "diagnostics": diagnostics,
        });
    }
    // What a render left out because it wasn't safe (a user's `javascript:` link): the HTML is
    // still whole, and the server can say what it dropped.
    let omitted = crate::validate::take_omitted();
    match result {
        Ok(output) => {
            let mut response = json!({
                "ok": true,
                "output": if command == "check" { Value::Null } else { Value::String(output) },
                "error": null,
                "warnings": rendered_warnings,
                "omitted": omitted,
                "diagnostics": diagnostics,
            });
            if !render_gaps.is_empty() {
                response["gaps"] = json!(render_gaps);
            }
            // `"client": true` on a check: why the component needs its module in the browser
            // (empty when its server HTML is complete on its own).
            if command == "check" && request.get("client").and_then(Value::as_bool) == Some(true) {
                if let Ok(reasons) = crate::client_reasons(source, &path, &loader) {
                    response["client"] = json!(reasons);
                }
            }
            response
        }
        Err(error) => {
            diagnostics.push(entry(&path, &error, "error"));
            json!({
                "ok": false,
                "output": null,
                "error": error.render_in(source, &path),
                "warnings": rendered_warnings,
                "diagnostics": diagnostics,
            })
        }
    }
}

fn entry(path: &str, diagnostic: &Diagnostic, severity: &str) -> Value {
    let file = diagnostic
        .file
        .as_ref()
        .map_or(path, |(file, _)| file.as_str());
    json!({
        "file": file,
        "line": diagnostic.span.line,
        "column": diagnostic.span.column,
        "severity": severity,
        "message": diagnostic.message,
        "help": diagnostic.help,
    })
}

/// `./x.zb`, `../x.zb` or `/x.zb`: a path, not a package.
pub(crate) fn is_relative(specifier: &str) -> bool {
    specifier.starts_with("./") || specifier.starts_with("../") || specifier.starts_with('/')
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Where a relative `specifier` (`./badge.zb`, `../ui/badge.zb`, or `/abs/badge.zb`) points from
/// the file `from`, as a normalized path: the same form the sources are keyed by. A `from`
/// without a directory (`card.zb`) resolves beside it (`badge.zb`), not at the root
/// (`/badge.zb`), which is no key the caller gave.
pub(crate) fn resolve(specifier: &str, from: &str) -> String {
    if specifier.starts_with('/') {
        return normalize(specifier);
    }
    match from.replace('\\', "/").rsplit_once('/') {
        Some((directory, _)) => normalize(&format!("{directory}/{specifier}")),
        None => normalize(specifier),
    }
}

/// `/app/./x/../badge.zb` → `/app/badge.zb` (lexically; the request has no filesystem).
pub(crate) fn normalize(path: &str) -> String {
    let path = path.replace('\\', "/");
    let absolute = path.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.last().is_some_and(|last| *last != "..") {
                    parts.pop();
                } else if !absolute {
                    parts.push("..");
                }
            }
            part => parts.push(part),
        }
    }
    let joined = parts.join("/");
    if absolute {
        format!("/{joined}")
    } else {
        joined
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(request: Value) -> Value {
        serde_json::from_str(&handle(&request.to_string())).unwrap()
    }

    #[test]
    fn styles_href_replaces_a_light_dom_components_css_text_and_nothing_elses() {
        let component = |host: &str| {
            format!("<style>\n  b {{ color: red; }}\n</style>\n<x-tag{host}><b>x</b></x-tag>")
        };
        let js = |source: &str, href: Option<&str>| {
            let mut request = json!({ "path": "/app/x-tag.zb", "files": { "/app/x-tag.zb": source }, "emit": "js" });
            if let Some(href) = href {
                request["stylesHref"] = json!(href);
            }
            call(request)["output"]
                .as_str()
                .unwrap_or_default()
                .to_owned()
        };
        // Light DOM: the address, and that the page has the CSS; not the text.
        let light = js(&component(""), Some("/_zubra/components/x-tag.css"));
        assert!(light.contains("  styled: true,\n  stylesHref: \"/_zubra/components/x-tag.css\",\n  inPage: true,\n"), "{light}");
        assert!(
            !light.contains("styles:") && !light.contains("color: red"),
            "{light}"
        );
        // Without the option, as before.
        let plain = js(&component(""), None);
        assert!(
            plain.contains("  styles: \"")
                && plain.contains("color: red")
                && !plain.contains("stylesHref")
                && !plain.contains("inPage"),
            "{plain}"
        );
        // A shadow component keeps its text: each of its roots adopts the sheet.
        assert_eq!(
            js(&component(" shadow"), Some("/x.css")),
            js(&component(" shadow"), None)
        );
        // Nothing to say for a component with no styles.
        let bare = "<x-tag><b>x</b></x-tag>";
        assert_eq!(js(bare, Some("/x.css")), js(bare, None));
    }

    #[test]
    fn files_loaded_once_answer_every_request_that_names_them_as_the_files_would() {
        let parent = r#"<script>import MyTag from './tag.zb'</script><my-list name="x"><my-tag tone={name}></my-tag><p onclick={() => 1}>{name}</p></my-list>"#;
        let tag = r#"<my-tag tone="plain"><b>{tone}</b></my-tag>"#;
        let files = json!({ "/app/list.zb": parent, "/app/tag.zb": tag });
        let loaded = call(json!({ "command": "load", "files": files }));
        assert_eq!(loaded["ok"], true, "{loaded}");
        let handle = loaded["output"].as_str().unwrap().to_owned();
        // Every kind of answer, several times over (the second from what the set kept), is
        // the answer the files themselves get: output, warnings and diagnostics.
        for _ in 0..3 {
            for (emit, props) in [
                ("html", json!({ "name": "Ada" })),
                ("html", json!({ "name": "Bo" })),
                ("js", json!({})),
                ("css", json!({})),
                ("interface", json!({})),
            ] {
                let with = |source: (&str, Value)| {
                    let mut request = json!({ "path": "/app/list.zb", "emit": emit, "props": props, "partial": true, "gaps": true });
                    request[source.0] = source.1;
                    call(request)
                };
                let by_handle = with(("loaded", json!(handle)));
                assert_eq!(by_handle["ok"], true, "{emit}: {by_handle}");
                assert_eq!(by_handle, with(("files", files.clone())), "{emit}");
            }
        }
        let html = call(
            json!({ "path": "/app/tag.zb", "loaded": handle, "emit": "html", "props": { "tone": "warm" } }),
        );
        assert!(
            html["output"].as_str().unwrap().contains("<b>warm</b>"),
            "any file of the set: {html}"
        );
        // An error is the same error.
        let broken = json!({ "/app/list.zb": "<my-list><p>{missing}</p></my-list>" });
        let broken_handle = call(json!({ "command": "load", "files": broken }))["output"].clone();
        assert_eq!(
            call(json!({ "path": "/app/list.zb", "loaded": broken_handle, "emit": "html" })),
            call(json!({ "path": "/app/list.zb", "files": broken, "emit": "html" }))
        );
        // The child edited is another set, under another handle; the first still answers as it was.
        let edited = json!({ "/app/list.zb": parent, "/app/tag.zb": tag.replace("<b>", "<i>").replace("</b>", "</i>") });
        let edited_handle = call(json!({ "command": "load", "files": edited }))["output"].clone();
        assert_ne!(edited_handle, json!(handle));
        let render = |handle: &Value| {
            call(json!({ "path": "/app/list.zb", "loaded": handle, "emit": "html", "props": { "name": "Ada" } }))["output"].as_str().unwrap().to_owned()
        };
        assert!(render(&edited_handle).contains("<i>Ada</i>"));
        assert!(render(&json!(handle)).contains("<b>Ada</b>"));
    }

    #[test]
    fn a_handle_this_compiler_does_not_have_asks_for_the_files_again() {
        let unknown = call(
            json!({ "path": "/app/list.zb", "loaded": "00000000000000000000000000000000", "emit": "html" }),
        );
        assert_eq!(unknown["ok"], false);
        assert_eq!(unknown["reload"], true, "{unknown}");
        // Other mistakes are not a reason to send the files again.
        let files = json!({ "/app/x.zb": "<x-x></x-x>" });
        let handle = call(json!({ "command": "load", "files": files }))["output"].clone();
        for request in [
            json!({ "path": "/app/x.zb", "loaded": handle, "files": files, "emit": "html" }),
            json!({ "path": "/app/other.zb", "loaded": handle, "emit": "html" }),
            json!({ "path": "/app/x.zb", "emit": "html" }),
            json!({ "command": "load" }),
            json!({ "command": "load", "files": [] }),
        ] {
            let response = call(request.clone());
            assert_eq!(response["ok"], false, "{request}");
            assert!(response.get("reload").is_none(), "{request}: {response}");
        }
    }

    #[test]
    fn a_templates_names_are_resolved_once_and_an_unknown_one_is_still_an_error_every_time() {
        let render = |source: &str, props: Value, slots: Value| {
            call(
                json!({ "path": "/app/x-names.zb", "files": { "/app/x-names.zb": source }, "emit": "html", "props": props, "slots": slots }),
            )
        };
        let good = "<script>\n  let count = 2\n</script>\n<x-names label=\"a\"><p>{label} {count}</p><zb-if test={count > 5}><b>{label}</b></zb-if><slot></slot></x-names>";
        // The same parsed component, render after render, whatever the props are.
        for label in ["one", "two", "three"] {
            let response = render(good, json!({ "label": label }), json!({}));
            assert!(
                response["output"]
                    .as_str()
                    .unwrap_or_default()
                    .contains(&format!("<p>{label} 2</p>")),
                "{response}"
            );
        }
        // A name that doesn't resolve is the error on the first render and on every one after,
        // in a branch that isn't rendered too.
        let bad = good.replace("<b>{label}</b>", "<b>{lable}</b>");
        let first = render(&bad, json!({}), json!({}));
        assert_eq!(first["ok"], false);
        assert!(
            first["error"]
                .as_str()
                .unwrap_or_default()
                .contains("lable"),
            "{first}"
        );
        assert_eq!(
            render(&bad, json!({ "label": "x" }), json!({})),
            render(&bad, json!({ "label": "x" }), json!({}))
        );
        assert_eq!(render(&bad, json!({}), json!({}))["error"], first["error"]);
        // And the edit that fixes it renders.
        assert_eq!(render(good, json!({}), json!({}))["ok"], true);
    }

    #[test]
    fn join_answers_with_one_module_or_says_the_set_stays_apart() {
        let joined = call(json!({ "command": "join", "at": "b/x.js", "modules": [
            { "path": "components/a.js", "code": "import './b.js';\nimport { emit } from '@zubra/runtime';\nemit('a');\n" },
            { "path": "components/b.js", "code": "import t from './theme.js';\nexport default t;\n" },
        ] }));
        assert_eq!(joined["ok"], true, "{joined}");
        assert_eq!(
            joined["output"],
            "// Generated by zubra: components/b.js, components/a.js as one module. Do not edit.\nimport { emit } from \"@zubra/runtime\";\nimport t from \"../components/theme.js\";\n{\n\nvoid (t);\n}\n{\n\n\nemit('a');\n}\n"
        );
        let apart = call(json!({ "command": "join", "at": "b/x.js", "modules": [
            { "path": "components/a.js", "code": "export const here = import.meta.url;\n" },
        ] }));
        assert_eq!(apart["ok"], false);
        assert_eq!(apart["apart"], true);
        assert_eq!(apart["error"], "components/a.js reads `import.meta`");
        for request in [
            json!({ "command": "join", "modules": [] }),
            json!({ "command": "join", "at": "b/x.js" }),
            json!({ "command": "join", "at": "b/x.js", "modules": [{ "path": "a.js" }] }),
        ] {
            let response = call(request);
            assert_eq!(response["ok"], false, "{response}");
            assert!(
                response.get("apart").is_none(),
                "a malformed request isn't a set to serve apart"
            );
        }
    }

    #[test]
    fn a_child_used_many_times_is_read_by_the_interface_it_has_now() {
        // A child's interface is worked out once for its parsed tree, not once per use: every
        // use is checked and filled in by it, and an edited child (another default, a prop that
        // is now a number) by its new one.
        let parent = r#"<script>import MyTag from './tag.zb'
const rows = [{ id: "a", tone: "warm" }, { id: "b", tone: "cool" }]</script><my-list><zb-each items={rows} as="row" key={row.id}><my-tag tone={row.tone}></my-tag><my-tag size="2"></my-tag></zb-each></my-list>"#;
        let render = |tag: &str| {
            call(json!({
                "path": "/app/list.zb",
                "files": { "/app/list.zb": parent, "/app/tag.zb": tag },
                "emit": "html",
            }))
        };
        let tag = |tone: &str, size: &str| {
            format!("<my-tag tone=\"{tone}\" size={size}><b>{{tone}} {{size + size}}</b></my-tag>")
        };
        // Before it had a `tone`: passing one is an error, and stops being one.
        let before = render("<my-tag size=\"1\"><b>{size + size}</b></my-tag>");
        assert!(
            before["error"]
                .as_str()
                .unwrap_or_default()
                .contains("<my-tag> has no prop `tone`"),
            "{before}"
        );
        let first = render(&tag("plain", "\"1\""));
        let html = first["output"].as_str().unwrap_or_default();
        for expected in ["<b>warm 11</b>", "<b>cool 11</b>", "<b>plain 22</b>"] {
            assert_eq!(
                html.matches(expected).count(),
                if expected.contains("plain") { 2 } else { 1 },
                "{expected} in {first}"
            );
        }
        let other = render(&tag("none", "\"1\""));
        assert_eq!(
            other["output"]
                .as_str()
                .unwrap_or_default()
                .matches("<b>none 22</b>")
                .count(),
            2,
            "{other}"
        );
        let numbered = render(&tag("none", "{1}"));
        assert!(
            numbered["error"]
                .as_str()
                .unwrap_or_default()
                .contains("prop `size` must be a number"),
            "{numbered}"
        );
    }

    #[test]
    fn a_long_lived_process_reuses_a_parsed_component_but_never_a_stale_one() {
        // The same parent, rendered again with other props, then with its child edited, then
        // with a grandchild edited and with a child that has gone: each answer is the current one.
        let parent = r#"<script>import MyChild from './child.zb'</script><my-parent name="x"><my-child label={name}></my-child></my-parent>"#;
        let child = |text: &str| {
            format!(
                r#"<script>import MyLeaf from './leaf.zb'</script><my-child label=""><b>{text} {{label}}</b><my-leaf></my-leaf></my-child>"#
            )
        };
        let render = |name: &str, child: &str, leaf: &str| {
            let mut files = json!({ "/app/parent.zb": parent, "/app/child.zb": child });
            if !leaf.is_empty() {
                files["/app/leaf.zb"] = json!(format!("<my-leaf><i>{leaf}</i></my-leaf>"));
            }
            call(
                json!({ "path": "/app/parent.zb", "files": files, "emit": "html", "props": { "name": name } }),
            )
        };
        let html = |response: Value| response["output"].as_str().unwrap_or_default().to_owned();
        assert!(html(render("Ann", &child("Hi"), "one")).contains("<b>Hi Ann</b>"));
        assert!(
            html(render("Bo", &child("Hi"), "one")).contains("<b>Hi Bo</b>"),
            "props are the render's own"
        );
        assert!(
            html(render("Bo", &child("Bye"), "one")).contains("<b>Bye Bo</b>"),
            "an edited child is parsed again"
        );
        assert!(
            html(render("Bo", &child("Bye"), "two")).contains("<i>two</i>"),
            "so is an edited grandchild"
        );
        let gone = render("Bo", &child("Bye"), "");
        assert_eq!(
            gone["ok"], false,
            "a child that's gone is an error, not the last parse: {gone}"
        );
        assert!(html(render("Cy", &child("Bye"), "two")).contains("<b>Bye Cy</b>"));
    }

    #[test]
    fn warnings_follow_the_source_they_are_for() {
        let files = |source: &str| json!({ "/app/w.zb": source });
        let warned = |source: &str| {
            call(json!({ "path": "/app/w.zb", "files": files(source), "emit": "html" }))["warnings"]
                .as_array()
                .map_or(0, Vec::len)
        };
        let plain = r#"<my-w label=""><p>{label}</p></my-w>"#;
        let shadowing = r#"<my-w title=""><p>{title}</p></my-w>"#;
        assert_eq!(warned(plain), 0);
        assert_eq!(
            warned(shadowing),
            1,
            "`title` is every element's built-in property"
        );
        assert_eq!(warned(shadowing), 1, "the same again, from the cache");
        assert_eq!(warned(plain), 0);
    }

    #[test]
    fn a_render_says_what_it_left_out_because_it_was_not_a_safe_url() {
        let source = r#"<my-pic url="" pic="" set="" rest={{}}><a href={url}>Go</a><img src={pic} srcset={set} alt=""><a {...rest}>More</a></my-pic>"#;
        let files = json!({ "/app/pic.zb": source });
        let render = |props: Value| {
            call(json!({ "path": "/app/pic.zb", "files": files, "emit": "html", "props": props }))
        };
        let response = render(json!({
            "url": "javascript:alert(document.cookie)",
            "pic": "data:image/png;base64,AAAA",
            "set": "javascript:x 1x",
            "rest": { "href": "javascript:y" },
        }));
        assert_eq!(response["ok"], true, "{response}");
        let html = response["output"].as_str().unwrap();
        assert!(
            html.contains(r#"><a>Go</a><img alt=""><a>More</a></my-pic>"#),
            "{html}"
        );
        let omitted: Vec<&str> = response["omitted"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m.as_str().unwrap())
            .collect();
        assert_eq!(omitted.len(), 4, "{omitted:?}");
        assert!(omitted[0].starts_with("left `href` out of the HTML: its value isn't a safe URL (`javascript:alert(documen…`)"), "{omitted:?}");
        assert!(
            omitted
                .iter()
                .any(|m| m.contains("`src`") && m.contains("`data:image/png;base64,AA…`")),
            "{omitted:?}"
        );
        assert!(
            omitted.iter().any(|m| m.contains("`srcset`")),
            "{omitted:?}"
        );
        assert_eq!(
            omitted.iter().filter(|m| m.contains("`href`")).count(),
            2,
            "the spread's href too: {omitted:?}"
        );
        // Safe values, and nothing carried over from the render before.
        let response = render(
            json!({ "url": "/farms/1", "pic": "/logo.webp", "set": "/a.webp 1x", "rest": {} }),
        );
        assert_eq!(response["omitted"], json!([]), "{response}");
    }

    #[test]
    fn has_slot_is_answered_on_the_server_from_the_slots_given() {
        let source = "<script>\n  import { hasSlot as given } from '@zubra/runtime'\n  const footer = given(\"footer\")\n  const body = given()\n  const which = 'aside'\n  const aside = given(which)\n</script>\n<my-card>\n  <main zb-if={body}><zb-slot></zb-slot></main>\n  <footer zb-if={footer}><zb-slot name=\"footer\"></zb-slot></footer>\n  <aside zb-if={aside}><zb-slot name=\"aside\"></zb-slot></aside>\n</my-card>";
        let files = json!({ "/app/card.zb": source });
        let render = |slots: Value| {
            call(
                json!({ "path": "/app/card.zb", "files": files, "emit": "html", "partial": true, "gaps": true, "slots": slots, "slotSource": "html" }),
            )
        };
        let response = render(json!({ "footer": "<b>Thanks</b>", "default": "  " }));
        let html = response["output"].as_str().expect("html");
        assert!(html.contains("<footer><?zb [!?><b>Thanks</b>"), "{html}");
        assert!(!html.contains("<main"), "whitespace isn't content: {html}");
        assert!(html.contains("data-zb-filled=\"footer\""), "{html}");
        // A slot named by a variable is the browser's to answer: the one gap.
        let gaps = response["gaps"].as_array().expect("gaps");
        assert_eq!(gaps.len(), 1, "{gaps:?}");
        assert!(
            gaps[0].as_str().unwrap().contains("zb-if={aside}"),
            "{gaps:?}"
        );
        let response = render(json!({ "default": "Hi" }));
        let html = response["output"].as_str().expect("html");
        assert!(
            html.contains("<main>") && !html.contains("<footer"),
            "{html}"
        );
        assert!(html.contains("data-zb-filled=\"default\""), "{html}");
        // Nothing filled: the attribute names no slot. It is still there, since a light-DOM
        // host with slots always says the server rendered it.
        let html = render(json!({}))["output"]
            .as_str()
            .expect("html")
            .to_owned();
        assert!(html.starts_with("<my-card data-zb-filled>"), "{html}");
    }

    #[test]
    fn rendered_slot_html_is_kept_as_written_even_with_a_tag_the_component_imports() {
        // #300: a router renders the page, then gives that HTML to its layout's slot. A component
        // the layout imports too was expanded a second time inside its own rendered markup.
        let button =
            "<my-button>\n  <button type=\"button\"><zb-slot></zb-slot></button>\n</my-button>";
        let app = "<script>\n  import './my-button.zb'\n</script>\n<x-app>\n  <my-button>In the shell</my-button>\n  <main><zb-slot></zb-slot></main>\n</x-app>";
        let files = json!({ "/app/my-button.zb": button, "/app/app.zb": app });
        let page = "<home-page>\n  <my-button data-zb-filled=\"default\">\n  <button type=\"button\"><?zb [!?>In the page<?zb ]?></button>\n</my-button>\n</home-page>";
        let response = call(
            json!({ "path": "/app/app.zb", "files": files, "emit": "html", "partial": true, "slots": { "default": page }, "slotSource": "html" }),
        );
        let html = response["output"].as_str().expect("html");
        assert!(html.contains(page), "the page as given: {html}");
        assert_eq!(html.matches("<button").count(), 2, "{html}");
        assert!(
            html.contains("<button type=\"button\"><?zb [!?>In the shell<?zb ]?></button>"),
            "the layout's own use is still expanded: {html}"
        );
    }

    #[test]
    fn a_light_dom_host_with_slots_names_the_slots_the_server_filled() {
        // Whether `hasSlot` asks or not: the element tells its own markup from the page's
        // content for a slot by this attribute, when the markers were stripped (#267).
        let render = |source: &str, slots: Value| {
            call(
                json!({ "path": "/app/c.zb", "files": { "/app/c.zb": source }, "emit": "html", "slots": slots, "slotSource": "html" }),
            )["output"]
                .as_str()
                .expect("html")
                .to_owned()
        };
        let badge = "<my-badge>\n  <span><zb-slot></zb-slot> <zb-slot name=\"icon\"></zb-slot> <zb-slot name=\"after\"></zb-slot></span>\n</my-badge>";
        let html = render(badge, json!({}));
        assert!(html.starts_with("<my-badge data-zb-filled>"), "{html}");
        let html = render(
            badge,
            json!({ "icon": "<i>!</i>", "default": "3", "after": " " }),
        );
        assert!(
            html.starts_with("<my-badge data-zb-filled=\"default icon\">"),
            "in a fixed order, and whitespace isn't content: {html}"
        );
        // No slots: nothing to tell apart. Shadow DOM: the shadow root is the element's alone.
        let html = render("<my-plain>\n  <b>Hi</b>\n</my-plain>", json!({}));
        assert!(html.starts_with("<my-plain>"), "{html}");
        let html = render(
            "<my-shade shadow>\n  <span><zb-slot></zb-slot></span>\n</my-shade>",
            json!({ "default": "3" }),
        );
        assert!(html.starts_with("<my-shade>"), "{html}");
    }

    #[test]
    fn a_partial_render_asked_for_gaps_says_what_it_left_for_the_browser() {
        // A list derived through a formatted time: only the browser formats times, so the list
        // is empty in the HTML. (Front Desk's Free Times shipped like this without a word, then
        // through a function with a loop, which the server now runs.)
        let source = "<script>\n  const label = (at) => new Date(at).toLocaleTimeString('en-US')\n  const choices = starts.map((one) => ({ time: one, label: label(one) }))\n</script>\n<my-times starts={[0]}>\n  <zb-each items={choices} as=\"one\" key={one.time}><b>{one.label}</b></zb-each>\n  <i>{starts.length}</i>\n</my-times>";
        let files = json!({ "/app/times.zb": source });
        let ask = |gaps: bool| {
            call(
                json!({ "path": "/app/times.zb", "files": files, "emit": "html", "partial": true, "gaps": gaps }),
            )
        };
        let response = ask(true);
        assert_eq!(response["ok"], json!(true), "{response}");
        let gaps: Vec<&str> = response["gaps"]
            .as_array()
            .expect("gaps")
            .iter()
            .filter_map(Value::as_str)
            .collect();
        assert_eq!(gaps.len(), 1, "{gaps:?}");
        assert!(
            gaps[0].contains("computed in the browser, so the server's HTML leaves it empty"),
            "{gaps:?}"
        );
        assert!(gaps[0].contains("/app/times.zb:6:"), "where: {gaps:?}");
        assert!(gaps[0].contains("items={choices}"), "the line: {gaps:?}");
        // The rest still renders; not asked, no `gaps`; nothing to say, no `gaps` either.
        assert!(response["output"].as_str().unwrap().contains("<i>1</i>"));
        assert!(ask(false).get("gaps").is_none());
        let whole = json!({ "/app/times.zb": "<my-times starts={['09:00']}><i>{starts.length}</i></my-times>" });
        let response = call(
            json!({ "path": "/app/times.zb", "files": whole, "emit": "html", "partial": true, "gaps": true }),
        );
        assert!(response.get("gaps").is_none(), "{response}");
    }

    const BADGE: &str = "<my-badge label=\"x\"><b>{label}</b></my-badge>";
    const INBOX: &str = "<script>import './parts/../badge.zb'</script>\n<my-inbox><my-badge label=\"Ada\"></my-badge></my-inbox>";

    #[test]
    fn compiles_every_output_from_the_files_it_is_given() {
        let files = json!({ "/app/inbox.zb": INBOX, "/app/badge.zb": BADGE });
        let html = call(json!({ "path": "/app/inbox.zb", "files": files, "emit": "html" }));
        assert_eq!(html["ok"], true, "{html}");
        assert!(html["output"].as_str().unwrap().contains("<b>Ada</b>"));
        let js = call(
            json!({ "path": "/app/inbox.zb", "files": files, "emit": "js", "keepImports": true }),
        );
        assert!(
            js["output"]
                .as_str()
                .unwrap()
                .contains("import './parts/../badge.zb'"),
            "{js}"
        );
        let js = call(json!({ "path": "/app/inbox.zb", "files": files, "emit": "js" }));
        assert!(
            js["output"]
                .as_str()
                .unwrap()
                .contains("\"./parts/../badge.js\""),
            "{js}"
        );
        for emit in ["css", "dts", "manifest"] {
            let response = call(json!({ "path": "/app/badge.zb", "files": files, "emit": emit }));
            assert_eq!(response["ok"], true, "{emit}: {response}");
        }
        let manifest = call(json!({ "path": "/app/badge.zb", "files": files, "emit": "manifest" }));
        assert!(manifest["output"]
            .as_str()
            .unwrap()
            .contains("\"path\": \"badge.js\""));
        let react = call(
            json!({ "path": "/app/badge.zb", "files": files, "emit": "dts", "framework": "react" }),
        );
        assert!(react["output"].as_str().unwrap().contains("MyBadgeReact"));
    }

    #[test]
    fn a_check_can_say_whether_the_component_needs_the_browser() {
        let files = json!({
            "/app/label.zb": "<my-label text=\"x\"><b>{text}</b></my-label>",
            "/app/counter.zb": "<script>\n  let n = 0\n</script>\n<my-counter><p>{n}</p></my-counter>",
        });
        let label = call(
            json!({ "command": "check", "path": "/app/label.zb", "files": files, "client": true }),
        );
        assert_eq!(label["client"], json!([]));
        let counter = call(
            json!({ "command": "check", "path": "/app/counter.zb", "files": files, "client": true }),
        );
        assert_eq!(counter["client"], json!(["state `n`"]));
        let plain = call(json!({ "command": "check", "path": "/app/counter.zb", "files": files }));
        assert!(plain.get("client").is_none(), "only when asked");
        let interface =
            call(json!({ "path": "/app/counter.zb", "files": files, "emit": "interface" }));
        let interface: Value = serde_json::from_str(interface["output"].as_str().unwrap()).unwrap();
        assert_eq!(interface["client"], json!(["state `n`"]));
    }

    #[test]
    fn reports_errors_and_warnings_for_terminals_and_editors() {
        let files = json!({ "/app/x.zb": "<my-x hidden={false}>\n  <p>{hiden}</p>\n</my-x>" });
        let response = call(json!({ "command": "check", "path": "/app/x.zb", "files": files }));
        assert_eq!(response["ok"], false);
        assert!(response["error"]
            .as_str()
            .unwrap()
            .starts_with("error: unknown reference `hiden`"));
        assert!(response["warnings"][0]
            .as_str()
            .unwrap()
            .starts_with("warning: prop `hidden`"));
        assert_eq!(
            response["diagnostics"]
                .as_array()
                .unwrap()
                .iter()
                .map(|d| (d["severity"].as_str().unwrap(), d["line"].as_u64().unwrap()))
                .collect::<Vec<_>>(),
            [("warning", 1), ("error", 2)]
        );
        assert_eq!(response["diagnostics"][1]["help"], "did you mean `hidden`?");

        let missing = call(json!({ "path": "/app/inbox.zb", "files": { "/app/inbox.zb": INBOX } }));
        assert!(
            missing["error"]
                .as_str()
                .unwrap()
                .contains("/app/badge.zb: not among the request's files"),
            "{missing}"
        );
        let ok = call(
            json!({ "command": "check", "path": "/app/badge.zb", "files": { "/app/badge.zb": BADGE } }),
        );
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["output"], Value::Null);
    }

    #[test]
    fn bad_requests_get_a_reason_not_a_panic() {
        for (request, expected) in [
            ("[]", "JSON object"),
            ("{", "isn't JSON"),
            ("{\"files\": {}}", "`path` is required"),
            ("{\"path\": \"/a.zb\"}", "`files` must map"),
            ("{\"path\": \"/a.zb\", \"files\": {}}", "no source for `/a.zb`"),
            ("{\"path\": \"/a.zb\", \"files\": {\"/a.zb\": \"<my-a></my-a>\"}, \"emit\": \"pdf\"}", "unknown emit"),
            ("{\"path\": \"/a.zb\", \"files\": {\"/a.zb\": \"<my-a></my-a>\"}, \"command\": \"run\"}", "unknown command"),
            ("{\"path\": \"/a.zb\", \"files\": {\"/a.zb\": \"<my-a></my-a>\"}, \"emit\": \"js\", \"cssImport\": \"x\"}", "go together"),
        ] {
            let response: Value = serde_json::from_str(&handle(request)).unwrap();
            assert_eq!(response["ok"], false);
            assert!(response["error"].as_str().unwrap().contains(expected), "{request}: {response}");
        }
    }

    #[test]
    fn paths_normalize_like_the_filesystem() {
        assert_eq!(normalize("/app/./x/../badge.zb"), "/app/badge.zb");
        assert_eq!(normalize("C:\\app\\x.zb"), "C:/app/x.zb");
        assert_eq!(normalize("/../a.zb"), "/a.zb");
        assert_eq!(normalize("../a/./b.zb"), "../a/b.zb");
    }
}
