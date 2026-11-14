//! Several browser modules as one: what a page's components are sent as, in a single request
//! (`command: "join"`; plan: roadmap-footprint F2).
//!
//! Each module becomes a block of the joined module, in the order the modules import each other,
//! so what one declares stays its own; their imports of anything outside the set are merged at
//! the top, and their imports of each other are dropped (the other is already there, above).
//! Nothing is renamed, so a set is joined only where that changes nothing a module can see.
//! Where it could (two modules import different things under one name; a module reads a global
//! another imports a module's binding as; a module takes a binding from another of the set, or
//! asks where it is with `import.meta`), the answer is [`Apart`] with the reason, and the
//! modules are served as they are.
//!
//! One thing does change: every outside module is now imported before any of the set runs,
//! where before each was imported just ahead of the module that asked for it. Only an outside
//! module whose side effects depend on a component having run already could tell.

use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{
    ExportDefaultDeclarationKind, Expression, ImportDeclarationSpecifier, ImportExpression,
    ImportMeta, Statement,
};
use oxc_ast_visit::Visit;
use oxc_span::GetSpan;

/// One module of a set: where the browser has it (`components/forms/field.js`, relative to
/// whatever the joined module's own place is relative to) and its code.
pub struct Module<'a> {
    pub path: &'a str,
    pub code: &'a str,
}

/// Why a set stays as separate modules.
#[derive(Debug, PartialEq, Eq)]
pub struct Apart(pub String);

/// What a module imports from outside the set, under a local name.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Binding {
    Default,
    Namespace,
    /// The imported name, as written (`a`, or `"a b"`).
    Named(String),
}

#[derive(Default)]
struct Imports {
    /// Outside modules in the order first imported, each with its bindings in that order.
    sources: Vec<(String, Vec<(Binding, String)>)>,
    /// Local name → where it comes from, and the module that imported it first.
    locals: HashMap<String, (String, Binding, String)>,
}

impl Imports {
    fn source(&mut self, source: &str) -> &mut Vec<(Binding, String)> {
        if let Some(at) = self.sources.iter().position(|(known, _)| known == source) {
            return &mut self.sources[at].1;
        }
        self.sources.push((source.to_owned(), Vec::new()));
        &mut self.sources.last_mut().expect("just pushed").1
    }

    fn bind(
        &mut self,
        source: &str,
        binding: Binding,
        local: &str,
        module: &str,
    ) -> Result<(), Apart> {
        if let Some((known_source, known, first)) = self.locals.get(local) {
            if known_source == source && *known == binding {
                return Ok(());
            }
            return Err(Apart(format!(
                "{first} and {module} import different things as `{local}`"
            )));
        }
        self.locals.insert(
            local.to_owned(),
            (source.to_owned(), binding.clone(), module.to_owned()),
        );
        self.source(source).push((binding, local.to_owned()));
        Ok(())
    }

    fn write(&self, out: &mut String) {
        for (source, bindings) in &self.sources {
            let source = serde_json::Value::String(source.clone()).to_string();
            let mut named = Vec::new();
            for (binding, local) in bindings {
                match binding {
                    Binding::Default => out.push_str(&format!("import {local} from {source};\n")),
                    Binding::Namespace => {
                        out.push_str(&format!("import * as {local} from {source};\n"));
                    }
                    Binding::Named(imported) if imported == local => named.push(local.clone()),
                    Binding::Named(imported) => named.push(format!("{imported} as {local}")),
                }
            }
            if !named.is_empty() {
                out.push_str(&format!(
                    "import {{ {} }} from {source};\n",
                    named.join(", ")
                ));
            } else if bindings.is_empty() {
                out.push_str(&format!("import {source};\n"));
            }
        }
    }
}

/// `a/b/../c.js` → `a/c.js`; `None` when it climbs out of the root.
fn normalize(path: &str) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    Some(parts.join("/"))
}

fn folder(path: &str) -> &str {
    path.rfind('/').map_or("", |at| &path[..at])
}

/// `to` as a module at `from` would import it (`../components/theme.js`).
fn relative(from: &str, to: &str) -> String {
    let from: Vec<&str> = folder(from)
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let to: Vec<&str> = to.split('/').collect();
    let shared = from
        .iter()
        .zip(&to)
        .take_while(|(a, b)| a == b)
        .count()
        .min(to.len().saturating_sub(1));
    let up = from.len() - shared;
    let rest = to[shared..].join("/");
    if up == 0 {
        format!("./{rest}")
    } else {
        format!("{}{rest}", "../".repeat(up))
    }
}

/// What a module's code does that a block of a shared module can't do the same way.
#[derive(Default)]
struct Asks {
    meta: bool,
    /// `import(x)` where `x` isn't text, or is a relative path.
    import: bool,
}

impl<'a> Visit<'a> for Asks {
    fn visit_import_meta(&mut self, _: &ImportMeta) {
        self.meta = true;
    }

    fn visit_import_expression(&mut self, import: &ImportExpression<'a>) {
        match &import.source {
            Expression::StringLiteral(text)
                if text
                    .value
                    .as_str()
                    .is_some_and(|value| !value.starts_with('.')) => {}
            _ => self.import = true,
        }
        oxc_ast_visit::walk::walk_import_expression(self, import);
    }
}

struct Part {
    path: String,
    body: String,
    /// The set's modules this one imports, in order.
    needs: Vec<String>,
    /// Names it reads that nothing in it declares.
    globals: Vec<String>,
}

/// The modules as one, to be served at `at` (a path beside theirs: `b/cart.js` for modules under
/// `components/`), or why they stay apart.
pub fn join(modules: &[Module<'_>], at: &str) -> Result<String, Apart> {
    let paths: HashSet<String> = modules
        .iter()
        .filter_map(|module| normalize(module.path))
        .collect();
    let mut imports = Imports::default();
    let mut parts: Vec<Part> = Vec::new();
    for module in modules {
        let path = normalize(module.path)
            .ok_or_else(|| Apart(format!("{} isn't a path under the root", module.path)))?;
        if parts.iter().any(|part| part.path == path) {
            continue;
        }
        parts.push(part(&path, module.code, &paths, at, &mut imports)?);
    }
    for part in &parts {
        for name in &part.globals {
            if let Some((_, _, first)) = imports.locals.get(name) {
                return Err(Apart(format!(
                    "{} reads a global `{name}`, which {first} imports something as",
                    part.path
                )));
            }
        }
    }
    // Each module after the ones it imports (and, where two import each other, the one asked
    // for first, first: as a browser would run them).
    let mut order: Vec<usize> = Vec::new();
    let mut seen: HashSet<usize> = HashSet::new();
    fn visit(at: usize, parts: &[Part], seen: &mut HashSet<usize>, order: &mut Vec<usize>) {
        if !seen.insert(at) {
            return;
        }
        for need in &parts[at].needs {
            if let Some(next) = parts.iter().position(|part| &part.path == need) {
                visit(next, parts, seen, order);
            }
        }
        order.push(at);
    }
    for at in 0..parts.len() {
        visit(at, &parts, &mut seen, &mut order);
    }
    let names: Vec<&str> = order.iter().map(|&at| parts[at].path.as_str()).collect();
    let mut out = format!(
        "// Generated by zubra: {} as one module. Do not edit.\n",
        names.join(", ")
    );
    imports.write(&mut out);
    for &at in &order {
        out.push_str("{\n");
        out.push_str(parts[at].body.trim_end());
        out.push_str("\n}\n");
    }
    Ok(out)
}

fn part(
    path: &str,
    code: &str,
    paths: &HashSet<String>,
    at: &str,
    imports: &mut Imports,
) -> Result<Part, Apart> {
    let allocator = oxc_allocator::Allocator::default();
    let parsed = oxc_parser::Parser::new(&allocator, code, oxc_span::SourceType::mjs()).parse();
    if !parsed.diagnostics.is_empty() {
        return Err(Apart(format!("{path} doesn't parse as a module")));
    }
    let semantic = oxc_semantic::SemanticBuilder::new()
        .build(&parsed.program)
        .semantic;
    let scoping = semantic.scoping();
    // `var` at the top (or in a block there) belongs to the whole module: in a block of a
    // shared module it would be every module's.
    for symbol in scoping.get_bindings(scoping.root_scope_id()).values() {
        if scoping
            .symbol_flags(*symbol)
            .contains(oxc_syntax::symbol::SymbolFlags::FunctionScopedVariable)
        {
            return Err(Apart(format!(
                "{path} declares `{}` with `var` at the top level",
                scoping.symbol_name(*symbol)
            )));
        }
    }
    let mut asks = Asks::default();
    asks.visit_program(&parsed.program);
    if asks.meta {
        return Err(Apart(format!("{path} reads `import.meta`")));
    }
    if asks.import {
        return Err(Apart(format!(
            "{path} calls `import()` with a path relative to itself, or one worked out as it runs"
        )));
    }
    // Where a specifier leads: one of the set, or how the joined module names it.
    enum Target {
        Inside(String),
        Outside(String),
    }
    let target = |specifier: &str| -> Result<Target, Apart> {
        if !specifier.starts_with("./") && !specifier.starts_with("../") {
            return Ok(Target::Outside(specifier.to_owned()));
        }
        let joined = format!("{}/{specifier}", folder(path));
        let resolved = normalize(&joined)
            .ok_or_else(|| Apart(format!("{path} imports {specifier}, outside the root")))?;
        Ok(if paths.contains(&resolved) {
            Target::Inside(resolved)
        } else {
            Target::Outside(relative(at, &resolved))
        })
    };
    let slice = |span: oxc_span::Span| &code[span.start as usize..span.end as usize];
    // A specifier as the module wrote it, without its quotes (none of ours has an escape).
    let text = |literal: &oxc_ast::ast::StringLiteral<'_>| -> &str {
        let span = literal.span;
        &code[span.start as usize + 1..span.end as usize - 1]
    };
    let mut edits: Vec<(u32, u32, String)> = Vec::new();
    let mut needs: Vec<String> = Vec::new();
    let side_effect =
        |specifier: &str, imports: &mut Imports, needs: &mut Vec<String>| -> Result<(), Apart> {
            match target(specifier)? {
                Target::Inside(other) => needs.push(other),
                Target::Outside(source) => {
                    imports.source(&source);
                }
            }
            Ok(())
        };
    for statement in &parsed.program.body {
        match statement {
            Statement::ImportDeclaration(import) => {
                if import.with_clause.is_some() {
                    return Err(Apart(format!(
                        "{path} imports {} with attributes",
                        text(&import.source)
                    )));
                }
                let specifiers: &[ImportDeclarationSpecifier<'_>] =
                    import.specifiers.as_deref().map_or(&[], |all| &all[..]);
                match target(text(&import.source))? {
                    Target::Inside(other) => {
                        if !specifiers.is_empty() {
                            return Err(Apart(format!(
                                "{path} takes `{}` from {other}, another module of the set",
                                specifiers[0].local().name
                            )));
                        }
                        needs.push(other);
                    }
                    Target::Outside(source) => {
                        imports.source(&source);
                        for specifier in specifiers {
                            let (binding, local) = match specifier {
                                ImportDeclarationSpecifier::ImportSpecifier(named) => (
                                    Binding::Named(slice(named.imported.span()).to_owned()),
                                    named.local.name.as_str(),
                                ),
                                ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                                    (Binding::Default, default.local.name.as_str())
                                }
                                ImportDeclarationSpecifier::ImportNamespaceSpecifier(all) => {
                                    (Binding::Namespace, all.local.name.as_str())
                                }
                            };
                            imports.bind(&source, binding, local, path)?;
                        }
                    }
                }
                edits.push((import.span.start, import.span.end, String::new()));
            }
            // Nothing imports the joined module, so what its modules export only has to exist.
            Statement::ExportDeclaration(export) => {
                edits.push((
                    export.span.start,
                    export.declaration.span().start,
                    String::new(),
                ));
            }
            Statement::ExportNamedDeclaration(export) => {
                edits.push((export.span.start, export.span.end, String::new()));
            }
            Statement::ExportFromDeclaration(export) => {
                side_effect(text(&export.source), imports, &mut needs)?;
                edits.push((export.span.start, export.span.end, String::new()));
            }
            Statement::ExportAllDeclaration(export) => {
                side_effect(text(&export.source), imports, &mut needs)?;
                edits.push((export.span.start, export.span.end, String::new()));
            }
            Statement::ExportDefaultDeclaration(export) => {
                let declaration = export.declaration.span();
                let named = match &export.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                        function.id.is_some()
                    }
                    ExportDefaultDeclarationKind::ClassDeclaration(class) => class.id.is_some(),
                    _ => false,
                };
                if named {
                    edits.push((export.span.start, declaration.start, String::new()));
                } else {
                    // An expression (or a function or class with no name) is still evaluated.
                    edits.push((export.span.start, declaration.start, "void (".to_owned()));
                    // (Closed here if the module left it to the line break: the next line
                    // may open with a bracket.)
                    let closed = code[..export.span.end as usize].ends_with(';');
                    let close = if closed { ")" } else { ");" };
                    edits.push((declaration.end, declaration.end, close.to_owned()));
                }
            }
            _ => {}
        }
    }
    let mut body = code.to_owned();
    edits.sort_by_key(|edit| std::cmp::Reverse((edit.0, edit.1)));
    for (start, end, text) in edits {
        body.replace_range(start as usize..end as usize, &text);
    }
    let mut globals: Vec<String> = scoping
        .root_unresolved_references()
        .keys()
        .map(|name| name.to_string())
        .collect();
    globals.sort();
    Ok(Part {
        path: path.to_owned(),
        body,
        needs,
        globals,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn modules<'a>(given: &'a [(&'a str, &'a str)]) -> Vec<Module<'a>> {
        given
            .iter()
            .map(|(path, code)| Module { path, code })
            .collect()
    }

    #[test]
    fn modules_become_blocks_in_import_order_under_their_merged_imports() {
        let joined = join(
            &modules(&[
                (
                    "components/ds-table.js",
                    "import { $define, emit } from \"@zubra/runtime\";\nimport \"./ds-badge.js\";\nimport { money } from './lib/money.js';\nexport const tag = \"ds-table\";\nexport default $define(tag, { setup() { return money(emit) } });\n",
                ),
                (
                    "components/ds-badge.js",
                    "import { $define, state as s } from \"@zubra/runtime\";\nimport theme, * as all from '/vendor/theme.js';\nexport const tag = \"ds-badge\";\nconst helper = () => s(theme, all);\nexport default $define(tag, { helper });\n",
                ),
            ]),
            "b/order.js",
        )
        .unwrap();
        assert_eq!(
            joined,
            "// Generated by zubra: components/ds-badge.js, components/ds-table.js as one module. Do not edit.\n\
import { $define, emit, state as s } from \"@zubra/runtime\";\n\
import { money } from \"../components/lib/money.js\";\n\
import theme from \"/vendor/theme.js\";\n\
import * as all from \"/vendor/theme.js\";\n\
{\n\n\nconst tag = \"ds-badge\";\nconst helper = () => s(theme, all);\nvoid ($define(tag, { helper }));\n}\n\
{\n\n\n\nconst tag = \"ds-table\";\nvoid ($define(tag, { setup() { return money(emit) } }));\n}\n"
        );
    }

    #[test]
    fn exports_stay_as_what_they_declare_and_reexports_as_imports() {
        let joined = join(
            &modules(&[
                (
                    "components/a.js",
                    "export function one() {}\nexport class Two {}\nconst three = 3;\nexport { three, three as four };\nexport default function five() {}\nexport * from './shared.js';\nexport { x } from 'pkg';\nexport * from './b.js';\n",
                ),
                ("components/b.js", "export default class {}\n"),
                ("components/c.js", "export default { a: 1 };\n"),
            ]),
            "components/joined.js",
        )
        .unwrap();
        assert!(
            joined.contains("import \"./shared.js\";\nimport \"pkg\";\n"),
            "{joined}"
        );
        assert!(
            joined.contains("{\nvoid (class {});\n}\n{\nfunction one() {}\nclass Two {}\nconst three = 3;\n\nfunction five() {}\n}\n{\nvoid ({ a: 1 });\n}\n"),
            "{joined}"
        );
    }

    #[test]
    fn a_set_that_joining_would_change_stays_apart_with_the_reason() {
        let apart = |given: &[(&str, &str)]| join(&modules(given), "b/x.js").unwrap_err().0;
        assert_eq!(
            apart(&[
                (
                    "components/a.js",
                    "import { format } from './one.js';\nformat();\n"
                ),
                (
                    "components/b.js",
                    "import { format } from './two.js';\nformat();\n"
                ),
            ]),
            "components/a.js and components/b.js import different things as `format`"
        );
        assert_eq!(
            apart(&[
                (
                    "components/a.js",
                    "import { fmt as format } from './one.js';\nformat();\n"
                ),
                (
                    "components/b.js",
                    "import format from './one.js';\nformat();\n"
                ),
            ]),
            "components/a.js and components/b.js import different things as `format`"
        );
        assert_eq!(
            apart(&[
                (
                    "components/a.js",
                    "import { history } from './history.js';\nhistory.push(1);\n"
                ),
                ("components/b.js", "history.back();\n"),
            ]),
            "components/b.js reads a global `history`, which components/a.js imports something as"
        );
        assert_eq!(
            apart(&[
                ("components/a.js", "import Badge from './b.js';\nBadge();\n"),
                ("components/b.js", "export default () => 1;\n"),
            ]),
            "components/a.js takes `Badge` from components/b.js, another module of the set"
        );
        assert_eq!(
            apart(&[("components/a.js", "if (window.old) { var count = 1; }\n")]),
            "components/a.js declares `count` with `var` at the top level"
        );
        assert_eq!(
            apart(&[("components/a.js", "const here = import.meta.url;\n")]),
            "components/a.js reads `import.meta`"
        );
        for code in [
            "const lazy = () => import('./lazy.js');\n",
            "const lazy = (name) => import(name);\n",
        ] {
            assert_eq!(
                apart(&[("components/a.js", code)]),
                "components/a.js calls `import()` with a path relative to itself, or one worked out as it runs"
            );
        }
        assert_eq!(
            apart(&[(
                "components/a.js",
                "import data from './data.json' with { type: 'json' };\n"
            )]),
            "components/a.js imports ./data.json with attributes"
        );
        assert_eq!(
            apart(&[("components/a.js", "const = ;\n")]),
            "components/a.js doesn't parse as a module"
        );
        assert_eq!(
            apart(&[("a.js", "import '../../out.js';\n")]),
            "a.js imports ../../out.js, outside the root"
        );
    }

    #[test]
    fn what_joining_leaves_alone() {
        // The same import twice is one; a name one module imports and another declares is each
        // one's own; `var` inside a function, `import()` of a package and text that only looks
        // like an import are as they were; modules that import each other both get a block.
        let joined = join(
            &modules(&[
                (
                    "components/a.js",
                    "import { emit } from '@zubra/runtime';\nimport './b.js';\nconst text = \"import x from './nowhere.js'\";\nfunction run() { var count = 1; return import('pkg/lazy'); }\nemit(text, run);\n",
                ),
                (
                    "components/b.js",
                    "import { emit } from '@zubra/runtime';\nimport './a.js';\nconst format = 1;\nemit(format);\n",
                ),
                (
                    "components/c.js",
                    "import { format } from '../lib/format.js';\nformat();\n",
                ),
            ]),
            "b/x.js",
        )
        .unwrap();
        assert!(joined.starts_with("// Generated by zubra: components/b.js, components/a.js, components/c.js as one module. Do not edit.\nimport { emit } from \"@zubra/runtime\";\nimport { format } from \"../lib/format.js\";\n{\n"), "{joined}");
        assert!(joined.contains("const text = \"import x from './nowhere.js'\";"));
        assert!(
            joined.contains("{\n\n\nconst format = 1;\nemit(format);\n}"),
            "{joined}"
        );
        assert_eq!(
            joined.matches("import ").count(),
            3,
            "two imports, and the text"
        );
        assert!(joined.contains("return import('pkg/lazy');"));
    }

    #[test]
    fn a_path_from_the_joined_module() {
        assert_eq!(
            relative("b/x.js", "components/theme.js"),
            "../components/theme.js"
        );
        assert_eq!(
            relative("components/x.js", "components/lib/theme.js"),
            "./lib/theme.js"
        );
        assert_eq!(
            relative("x.js", "components/theme.js"),
            "./components/theme.js"
        );
        assert_eq!(relative("a/b/x.js", "a/c/d.js"), "../c/d.js");
        assert_eq!(relative("a/b/x.js", "a/b"), "../b");
    }
}
