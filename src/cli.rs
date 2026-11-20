//! The command line's contract: every command, its flags and their values, its help text, and
//! the exit codes. One table for both CLIs, so they can't drift: the native binary
//! (`src/main.rs`) parses with it, and the npm one (`compiler/cli.js`) asks for it through the
//! request protocol (`command: "cli"` for the table, `command: "help"` for the text).
//!
//! The commands, flags and exit codes are Stable (docs/stability.md); the help's wording is not.

use serde_json::{json, Value};

/// Which CLI has a command. The other one names it and says where it is, with exit code 2.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Home {
    /// Both: `zubra` (native) and `npx zubra` (npm, @zubra/compiler).
    Both,
    /// Only the npm package: it needs Node (TypeScript, the registry, an MCP server).
    Npm,
}

pub struct Flag {
    pub name: &'static str,
    /// What the flag takes (`<file>`), or `None` for a switch.
    pub value: Option<&'static str>,
    /// The values it takes, when they are a fixed set (aliases are accepted besides; see `alias`).
    pub values: &'static [&'static str],
    pub help: &'static str,
}

pub struct Command {
    pub name: &'static str,
    pub home: Home,
    /// What follows the name, before the flags (`<file | folder>...`).
    pub arguments: &'static str,
    pub summary: &'static str,
    pub flags: &'static [Flag],
    /// More about the command, for its own help.
    pub notes: &'static str,
}

const fn switch(name: &'static str, help: &'static str) -> Flag {
    Flag {
        name,
        value: None,
        values: &[],
        help,
    }
}

const fn valued(name: &'static str, value: &'static str, help: &'static str) -> Flag {
    Flag {
        name,
        value: Some(value),
        values: &[],
        help,
    }
}

const fn choice(name: &'static str, values: &'static [&'static str], help: &'static str) -> Flag {
    Flag {
        name,
        value: Some(""),
        values,
        help,
    }
}

/// `--framework`'s values. `vanilla` is no framework: the element itself.
pub const FRAMEWORKS: &[&str] = &["react", "vue", "svelte", "solid", "solid2", "vanilla"];

/// Other names a value is accepted under, forever: (flag, alias, canonical).
pub const ALIASES: &[(&str, &str, &str)] = &[
    ("--framework", "element", "vanilla"),
    ("--framework", "none", "vanilla"),
    ("--framework", "plain", "vanilla"),
];

/// The canonical value of `flag` for `value` (an alias's canonical name, or `value` itself).
pub fn canonical<'a>(flag: &str, value: &'a str) -> &'a str {
    ALIASES
        .iter()
        .find(|(name, alias, _)| *name == flag && *alias == value)
        .map_or(value, |(_, _, canonical)| canonical)
}

pub const EMITS: &[&str] = &[
    "html",
    "js",
    "element",
    "css",
    "dts",
    "manifest",
    "html-data",
    "interface",
    "server",
    "tsx",
];

pub const COMMANDS: &[Command] = &[
    Command {
        name: "check",
        home: Home::Both,
        arguments: "<file | folder>...",
        summary: "report every error and warning, writing nothing",
        flags: &[
            choice("--format", &["human", "json"], "json: one array of { file, code, line, column, severity, message, help }, for tools"),
            switch("--server", "also report what a server without JavaScript leaves out"),
            switch("--client", "say whether each component needs its module in the browser, and why"),
            switch("--stdin", "check standard input as if it were at the one path given (an editor's unsaved text)"),
            switch("--deny-warnings", "exit 1 on a warning too"),
            switch("--types", "the project's TypeScript checks each lang=\"ts\" component (npm package: needs typescript)"),
            switch("--keep", "with --types: keep the TypeScript files it checked, in .zubra-types/check"),
        ],
        notes: "A folder is every component under it (.zb, .zb.jsx, .zb.tsx), skipping node_modules, dist, target and hidden folders. Each diagnostic has a stable code (error[ZB2001]: …), listed in docs/diagnostics.md.",
    },
    Command {
        name: "compile",
        home: Home::Both,
        arguments: "<file>",
        summary: "compile a component: server HTML by default, or what --emit names",
        flags: &[
            choice("--emit", EMITS, "what to write (default html): server HTML, the element module, the element with no runtime, the stylesheet, typings, the Custom Elements Manifest, VS Code HTML data, the prop/event interface, the server renderer, or the TypeScript --types checks"),
            valued("--props", "<props.json>", "--emit html: prop values (required props need one)"),
            valued("--slots", "<slots.json>", "--emit html: slot content, as zubra templates"),
            switch("--slots-html", "--emit html: read --slots as server-rendered HTML, kept as written"),
            switch("--partial", "--emit html: leave what only the browser can compute for the element, instead of an error"),
            valued("--runtime", "<module>", "--emit js: the runtime module to import (default @zubra/runtime)"),
            switch("--keep-imports", "--emit js, element: leave ./x.zb imports for a bundler (otherwise ./x.js)"),
            switch("--no-imports", "--emit css: this component's stylesheet only"),
            switch("--devtools", "--emit js: what the browser DevTools panel reads (development builds)"),
            switch("--binder-entries", "--emit js: import each binder from its own runtime entry (@zubra/server)"),
            switch("--client-only", "--emit js: no hydration, for apps that never render on a server"),
            valued("--css-import", "<specifier>", "--emit js, with --css-import-inline: import the <style> through the bundler"),
            valued("--css-import-inline", "<specifier>", "--emit js, with --css-import: the inline form of the same stylesheet"),
            choice("--framework", FRAMEWORKS, "--emit dts: type the default export as that framework's wrapper (vanilla: the element; also element, none, plain)"),
            valued("--module-path", "<path>", "--emit manifest: the module path it records (default: the component's name, .js)"),
            valued("--output", "<file>", "write there (atomically) instead of to standard output"),
        ],
        notes: "Warnings go to standard error.",
    },
    Command {
        name: "convert",
        home: Home::Both,
        arguments: "<Component.jsx | my-element.js>",
        summary: "a React function component as a Zubra component, or a class in --emit element's shape back to .zb",
        flags: &[
            valued("--prefix", "<word>", "the tag's first word, for a one-word component name (<app-counter>)"),
            valued("--component", "<Name>", "which of several exported components to convert"),
            choice("--as", &["jsx", "zubra"], "jsx (default): a .zb.jsx component; zubra: the HTML-first .zb file, once nothing is left to finish"),
            valued("--out", "<file>", "write there instead of next to the source"),
            switch("--stdout", "print the result instead of writing it"),
        ],
        notes: "A .js file reads only the custom element class `zubra compile --emit element` writes (edited, or written by hand in that shape), not any custom element. What can't be converted is reported, and the exit code is 1.",
    },
    Command {
        name: "fmt",
        home: Home::Both,
        arguments: "<file | folder>...",
        summary: "lay .zb files out, without changing what they compile to",
        flags: &[
            switch("--check", "change nothing; exit 1 if a file would change"),
            switch("--stdin", "format standard input to standard output (one optional path, for messages)"),
            valued("--indent", "<n>", "spaces per level (default 2)"),
            switch("--tabs", "indent with tabs"),
            valued("--width", "<n>", "the line width that puts one attribute per line (default 100)"),
        ],
        notes: "",
    },
    Command {
        name: "request",
        home: Home::Both,
        arguments: "",
        summary: "one JSON request on standard input, its JSON response on standard output",
        flags: &[],
        notes: "The protocol is in the repository's src/request.rs. { \"requests\": [ … ] } is a batch.",
    },
    Command {
        name: "serve",
        home: Home::Both,
        arguments: "",
        summary: "a JSON request per line on standard input, a response per line on standard output",
        flags: &[],
        notes: "Runs until standard input closes: one process, for a server in any language.",
    },
    Command {
        name: "build",
        home: Home::Npm,
        arguments: "<folder>",
        summary: "a publishable component package, or files for sites with no build step",
        flags: &[
            switch("--lib", "build a package: a module per element, react and vue entries, typings, custom-elements.json, skills"),
            switch("--embed", "build one folder of modules, HTML snippets, a WordPress plugin and a Shopify extension"),
            valued("--out", "<folder>", "where (default dist, or embed)"),
            valued("--name", "<name>", "the package name (--lib) or slug (--embed)"),
            valued("--version", "<x.y.z>", "--lib: the package version"),
            valued("--base", "<url>", "--embed: where the files will be served from"),
            switch("--watch", "--lib: build again after each change"),
        ],
        notes: "",
    },
    Command {
        name: "add",
        home: Home::Npm,
        arguments: "<name>...",
        summary: "copy registry components into the project, to own",
        flags: &[
            valued("--dir", "<folder>", "where (default src/components)"),
            switch("--force", "replace files that are already there"),
            switch("--list", "list the registry's components"),
        ],
        notes: "",
    },
    Command {
        name: "types",
        home: Home::Npm,
        arguments: "[file | folder]...",
        summary: "write each component's typings into a folder, so tsc can check a fresh checkout",
        flags: &[
            valued("--dir", "<folder>", "where (default .zubra/types)"),
            choice("--framework", FRAMEWORKS, "the framework the typings are for (default: the one in package.json; vanilla: the elements)"),
        ],
        notes: "",
    },
    Command {
        name: "mcp",
        home: Home::Npm,
        arguments: "[custom-elements.json | folder | package]...",
        summary: "an MCP server (standard input and output) describing the components to coding agents",
        flags: &[],
        notes: "For a client's MCP configuration, not for running by hand.",
    },
];

/// The exit codes, for the help and the docs.
pub const EXIT_CODES: &str =
    "Exit codes: 0 success (warnings included), 1 errors in the input, 2 a usage error.";

pub fn command(name: &str) -> Option<&'static Command> {
    COMMANDS.iter().find(|command| command.name == name)
}

impl Command {
    pub fn flag(&self, name: &str) -> Option<&'static Flag> {
        self.flags.iter().find(|flag| flag.name == name)
    }

    /// `zubra check <file | folder>... [--format human|json] [--server] …`
    pub fn synopsis(&self) -> String {
        let mut line = format!("zubra {}", self.name);
        if !self.arguments.is_empty() {
            line.push(' ');
            line.push_str(self.arguments);
        }
        for flag in self.flags {
            line.push_str(&format!(" [{}]", flag.usage()));
        }
        line
    }

    /// Where a command the running CLI doesn't have is: `None` when it has it.
    pub fn elsewhere(&self, npm: bool) -> Option<String> {
        match (self.home, npm) {
            (Home::Npm, false) => Some(format!(
                "`zubra {0}` is in the npm package: npx zubra {0} (@zubra/compiler)",
                self.name
            )),
            _ => None,
        }
    }

    /// The command's own help.
    pub fn help(&self) -> String {
        let mut text = format!(
            "{}\n\nusage: {}\n",
            capitalized(self.summary),
            wrap(&self.synopsis(), 7)
        );
        if self.home == Home::Npm {
            text.push_str("\nIn the npm package (@zubra/compiler) only: npx zubra ");
            text.push_str(self.name);
            text.push('\n');
        }
        text.push_str("\nOptions:\n");
        let rows: Vec<(String, &str)> = self
            .flags
            .iter()
            .map(|flag| (flag.usage(), flag.help))
            .chain([
                ("-h, --help".to_owned(), "this help"),
                ("-V, --version".to_owned(), "the version"),
            ])
            .collect();
        let width = rows.iter().map(|(usage, _)| usage.len()).max().unwrap_or(0);
        for (usage, help) in rows {
            text.push_str(&format!("  {usage:width$}  {help}\n"));
        }
        if !self.notes.is_empty() {
            text.push('\n');
            text.push_str(self.notes);
            text.push('\n');
        }
        text.push('\n');
        text.push_str(EXIT_CODES);
        text.push('\n');
        text
    }
}

impl Flag {
    /// `--format human|json`, `--props <props.json>`, `--server`.
    pub fn usage(&self) -> String {
        match self.value {
            None => self.name.to_owned(),
            Some("") => format!("{} {}", self.name, self.values.join("|")),
            Some(value) => format!("{} {value}", self.name),
        }
    }

    /// Whether `value` is one this flag takes (an alias included).
    pub fn accepts(&self, value: &str) -> bool {
        self.values.is_empty() || self.values.contains(&canonical(self.name, value))
    }
}

/// `zubra --help`: every command, with every flag.
pub fn help() -> String {
    let mut text = format!(
        "zubra {}: the Zubra compiler\n\nusage: zubra <command> [options]   (zubra <command> --help for one command)\n\n",
        env!("CARGO_PKG_VERSION")
    );
    for home in [Home::Both, Home::Npm] {
        text.push_str(match home {
            Home::Both => "Commands:\n",
            Home::Npm => "\nIn the npm package (@zubra/compiler) only, as npx zubra …:\n",
        });
        for command in COMMANDS.iter().filter(|command| command.home == home) {
            text.push_str(&format!("  {}\n", wrap(&command.synopsis(), 6)));
            text.push_str(&format!("      {}\n", command.summary));
        }
    }
    text.push_str("\nOptions:\n  -h, --help     this help\n  -V, --version  the version\n\n");
    text.push_str(EXIT_CODES);
    text.push('\n');
    text
}

/// The help for `topic` (a command's name), or the whole help; `None` for an unknown command.
pub fn help_for(topic: Option<&str>) -> Option<String> {
    match topic {
        None => Some(help()),
        Some(name) => command(name).map(Command::help),
    }
}

/// The table, as JSON, for the npm CLI.
pub fn spec() -> Value {
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "commands": COMMANDS.iter().map(|command| json!({
            "name": command.name,
            "synopsis": command.synopsis(),
            "home": match command.home { Home::Both => "both", Home::Npm => "npm" },
            "flags": command.flags.iter().map(|flag| json!({
                "name": flag.name,
                "value": flag.value.is_some(),
                "values": flag.values,
            })).collect::<Vec<_>>(),
            "help": command.help(),
            "elsewhere": command.elsewhere(false),
        })).collect::<Vec<_>>(),
        "aliases": ALIASES.iter().map(|(flag, alias, canonical)| json!([flag, alias, canonical])).collect::<Vec<_>>(),
        "help": help(),
    })
}

/// A usage error's message: what was wrong, and "did you mean" where something is close.
pub fn unknown(what: &str, given: &str, candidates: &[&str]) -> String {
    let mut message = format!("unknown {what} `{given}`");
    if let Some(near) = nearest(given, candidates) {
        message.push_str(&format!("; did you mean `{near}`?"));
    }
    message
}

/// The candidate closest to `given`, when it's close enough to be a typo.
pub fn nearest<'a>(given: &str, candidates: &[&'a str]) -> Option<&'a str> {
    candidates
        .iter()
        .map(|candidate| (distance(given, candidate), *candidate))
        .filter(|(distance, candidate)| {
            *distance <= 2.max(candidate.len() / 4) && *distance < candidate.len()
        })
        .min_by_key(|(distance, _)| *distance)
        .map(|(_, candidate)| candidate)
}

fn distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, x) in a.chars().enumerate() {
        let mut next = vec![i + 1];
        for (j, y) in b.iter().enumerate() {
            next.push(
                (row[j + 1] + 1)
                    .min(next[j] + 1)
                    .min(row[j] + usize::from(x != *y)),
            );
        }
        row = next;
    }
    row[b.len()]
}

fn capitalized(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().collect::<String>() + chars.as_str()
    })
}

/// `text` broken at spaces before 100 columns, continued lines indented by `indent`.
fn wrap(text: &str, indent: usize) -> String {
    let mut out = String::new();
    let mut column = indent;
    for word in split_flags(text) {
        if column + word.len() + 1 > 100 && !out.is_empty() {
            out.push('\n');
            out.push_str(&" ".repeat(indent + 2));
            column = indent + 2;
        } else if !out.is_empty() {
            out.push(' ');
            column += 1;
        }
        out.push_str(&word);
        column += word.len();
    }
    out
}

/// The words of a synopsis, keeping each `[--flag value]` whole.
fn split_flags(text: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut depth = 0;
    for character in text.chars() {
        match character {
            '[' => depth += 1,
            ']' => depth -= 1,
            ' ' if depth == 0 => {
                if !current.is_empty() {
                    words.push(std::mem::take(&mut current));
                }
                continue;
            }
            _ => {}
        }
        current.push(character);
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggests_near_names_only() {
        assert_eq!(nearest("chek", &["check", "compile"]), Some("check"));
        assert_eq!(
            nearest("--formt", &["--format", "--server"]),
            Some("--format")
        );
        assert_eq!(nearest("deploy", &["check", "compile", "convert"]), None);
    }

    #[test]
    fn the_help_lists_every_emit_framework_and_flag() {
        let help = help();
        let compile = command("compile").unwrap();
        for flag in compile.flags {
            assert!(help.contains(&flag.usage()), "{}", flag.name);
        }
        assert!(help.contains(&format!("--emit {}", EMITS.join("|"))));
        assert!(help.contains("--framework react|vue|svelte|solid|solid2|vanilla"));
        assert!(help.contains("--client-only"));
    }
}
