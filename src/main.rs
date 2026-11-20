use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    process::ExitCode,
};

use zubra::cli::{self, Command};

/// Why the command stopped. The exit code is the contract (docs/reference.md, "The CLI"):
/// 0 success (warnings included), 1 errors in the input, 2 a usage error.
enum Failure {
    /// Errors in the input (a component that doesn't compile, a missing file): exit 1. The
    /// message may be empty, when what went wrong is already written (`--format json`).
    Input(String),
    /// The command line itself is wrong (an unknown command or flag, a missing argument): exit 2.
    Usage(String),
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Self::Input(message)
    }
}

type Outcome = Result<(), Failure>;

fn main() -> ExitCode {
    match run(env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(Failure::Input(message)) => {
            if !message.is_empty() {
                eprintln!("{}", message.trim_end());
            }
            ExitCode::from(1)
        }
        Err(Failure::Usage(message)) => {
            eprintln!("{}", message.trim_end());
            ExitCode::from(2)
        }
    }
}

fn usage(message: impl Into<String>) -> Failure {
    Failure::Usage(message.into())
}

/// A missing file says so plainly; anything else with the reason.
fn read(path: &str) -> Result<String, Failure> {
    fs::read_to_string(path).map_err(|error| {
        Failure::Input(if error.kind() == std::io::ErrorKind::NotFound {
            format!("no such file: {path}")
        } else {
            format!("{path}: unable to read source: {error}")
        })
    })
}

fn run(arguments: Vec<String>) -> Outcome {
    let Some(first) = arguments.first() else {
        return Err(usage(cli::help()));
    };
    let help_flag = |argument: &String| argument == "-h" || argument == "--help";
    match first.as_str() {
        "-h" | "--help" | "help" => {
            let topic = arguments.get(1).filter(|topic| !help_flag(topic));
            return match cli::help_for(topic.map(String::as_str)) {
                Some(help) => {
                    print!("{help}");
                    Ok(())
                }
                None => Err(usage(unknown_command(topic.map_or("", String::as_str)))),
            };
        }
        "-V" | "--version" => {
            println!("zubra {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        }
        flag if flag.starts_with('-') => {
            return Err(usage(format!(
                "{}\nrun `zubra --help` for the options",
                cli::unknown("flag", flag, &["--help", "--version"])
            )))
        }
        _ => {}
    }
    let Some(command) = cli::command(first) else {
        return Err(usage(unknown_command(first)));
    };
    let rest = &arguments[1..];
    // Help and the version come before anything else the command would do.
    if rest.iter().any(help_flag) {
        print!("{}", command.help());
        return Ok(());
    }
    if rest.iter().any(|argument| {
        argument == "-V" || (argument == "--version" && command.flag("--version").is_none())
    }) {
        println!("zubra {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    if let Some(elsewhere) = command.elsewhere(false) {
        return Err(usage(elsewhere));
    }
    let parsed = Parsed::new(command, rest)?;
    match command.name {
        "check" => check(&parsed),
        "compile" => compile(&parsed),
        "convert" => convert(&parsed),
        "fmt" => fmt(&parsed),
        "request" => {
            parsed.no_arguments()?;
            // One JSON request on stdin, the JSON response on stdout (what the WebAssembly build
            // exposes, for anything embedding the native compiler instead).
            let request = std::io::read_to_string(std::io::stdin())
                .map_err(|error| format!("unable to read standard input: {error}"))?;
            println!("{}", zubra::handle_request(&request));
            Ok(())
        }
        "serve" => {
            parsed.no_arguments()?;
            serve()
        }
        _ => unreachable!("every command the table has is handled here"),
    }
}

fn unknown_command(name: &str) -> String {
    let names: Vec<&str> = cli::COMMANDS.iter().map(|command| command.name).collect();
    format!(
        "{}\nrun `zubra --help` for the commands",
        cli::unknown("command", name, &names)
    )
}

/// A command's arguments, checked against its row in `cli::COMMANDS`: known flags only, each
/// valued flag with a value it takes (an alias given as its canonical name).
struct Parsed {
    command: &'static Command,
    flags: Vec<(&'static str, Option<String>)>,
    positionals: Vec<String>,
}

impl Parsed {
    fn new(command: &'static Command, arguments: &[String]) -> Result<Self, Failure> {
        let mut parsed = Self {
            command,
            flags: Vec::new(),
            positionals: Vec::new(),
        };
        let mut arguments = arguments.iter();
        while let Some(argument) = arguments.next() {
            if !argument.starts_with('-') || argument == "-" {
                parsed.positionals.push(argument.clone());
                continue;
            }
            let (name, inline) = match argument.split_once('=') {
                Some((name, value)) if name.starts_with("--") => (name, Some(value.to_owned())),
                _ => (argument.as_str(), None),
            };
            let Some(flag) = command.flag(name) else {
                let names: Vec<&str> = command.flags.iter().map(|flag| flag.name).collect();
                return Err(usage(format!(
                    "{}\nrun `zubra {} --help` for its options",
                    cli::unknown("flag", name, &names),
                    command.name
                )));
            };
            let value = match (flag.value, inline) {
                (None, None) => None,
                (None, Some(_)) => return Err(usage(format!("`{name}` takes no value"))),
                (Some(_), Some(value)) => Some(value),
                (Some(_), None) => match arguments.next() {
                    Some(value) => Some(value.clone()),
                    None => return Err(usage(format!("`{name}` needs a value: {}", flag.usage()))),
                },
            };
            if let Some(value) = &value {
                if !flag.accepts(value) {
                    return Err(usage(format!(
                        "{}; expected {}",
                        cli::unknown(&format!("{name} value"), value, flag.values),
                        flag.values.join(", ")
                    )));
                }
            }
            parsed.flags.push((
                flag.name,
                value.map(|value| cli::canonical(flag.name, &value).to_owned()),
            ));
        }
        Ok(parsed)
    }

    fn has(&self, name: &str) -> bool {
        self.flags.iter().any(|(flag, _)| *flag == name)
    }

    /// The flag's value (the last one given).
    fn value(&self, name: &str) -> Option<&str> {
        self.flags
            .iter()
            .rev()
            .find(|(flag, _)| *flag == name)
            .and_then(|(_, value)| value.as_deref())
    }

    fn no_arguments(&self) -> Outcome {
        match self.positionals.first() {
            Some(argument) => Err(usage(format!(
                "`zubra {}` takes no arguments, and was given `{argument}`",
                self.command.name
            ))),
            None => Ok(()),
        }
    }

    /// The usage line, for a usage error.
    fn usage(&self, problem: &str) -> Failure {
        usage(format!("{problem}\nusage: {}", self.command.synopsis()))
    }
}

/// `zubra serve`: one JSON request (or batch) per line on stdin, one JSON response per line on
/// stdout, until stdin closes. For servers in other languages: one process, no start-up cost
/// per render.
fn serve() -> Outcome {
    use std::io::BufRead;
    let stdout = std::io::stdout();
    for line in std::io::stdin().lock().lines() {
        let line = line.map_err(|error| format!("unable to read standard input: {error}"))?;
        if line.trim().is_empty() {
            continue;
        }
        let mut out = stdout.lock();
        writeln!(out, "{}", zubra::handle_request(&line))
            .and_then(|()| out.flush())
            .map_err(|error| format!("unable to write the response: {error}"))?;
    }
    Ok(())
}

/// `zubra compile`: server HTML, or what `--emit` names.
fn compile(parsed: &Parsed) -> Outcome {
    let source_path = match parsed.positionals.as_slice() {
        [path] => path.clone(),
        [] => return Err(parsed.usage("missing the component to compile")),
        [_, extra, ..] => {
            return Err(parsed.usage(&format!(
                "`zubra compile` takes one component; `{extra}` is a second"
            )))
        }
    };
    let emit = parsed.value("--emit").unwrap_or("html").to_owned();
    let runtime = parsed.value("--runtime").unwrap_or("@zubra/runtime");
    let props_path = parsed.value("--props");
    let slots_path = parsed.value("--slots");
    let slots_html = parsed.has("--slots-html");
    let partial = parsed.has("--partial");
    let output_path = parsed.value("--output");
    let css_import = parsed.value("--css-import");
    let css_import_inline = parsed.value("--css-import-inline");
    let framework = zubra::Framework::named(parsed.value("--framework").unwrap_or("vanilla"))
        .expect("the parser takes only --framework values the table has");
    if emit != "html" && (props_path.is_some() || slots_path.is_some() || slots_html || partial) {
        return Err(parsed.usage(&format!(
            "--props, --slots, --slots-html and --partial apply to --emit html, not --emit {emit}"
        )));
    }
    if parsed.has("--devtools") && emit != "js" {
        return Err(parsed.usage(&format!(
            "--devtools applies to --emit js, not --emit {emit}"
        )));
    }
    if css_import.is_some() != css_import_inline.is_some() {
        return Err(parsed.usage("--css-import and --css-import-inline go together"));
    }
    let source = read(&source_path)?;
    for warning in zubra::warnings_with(&source, &source_path, &zubra::filesystem) {
        eprint!("{}", warning.render_warning(&source, &source_path));
    }
    let render = |diagnostic: zubra::Diagnostic| diagnostic.render_in(&source, &source_path);
    let output = if emit == "html" {
        // Props are optional: defaults come from the component's <script> and host tag.
        let props = match props_path {
            Some(props_path) => fs::read_to_string(props_path)
                .map_err(|error| format!("{props_path}: unable to read props: {error}"))?,
            None => "{}".to_owned(),
        };
        let slots = match slots_path {
            Some(slots_path) => fs::read_to_string(slots_path)
                .map_err(|error| format!("{slots_path}: unable to read slots: {error}"))?,
            None => "{}".to_owned(),
        };
        let slot_source = if slots_html {
            zubra::SlotSource::Html
        } else {
            zubra::SlotSource::Template
        };
        let html = zubra::compile_html_with_options(
            &source,
            &source_path,
            &props,
            &slots,
            zubra::HtmlOptions {
                slot_source,
                partial,
                pending: Vec::new(),
            },
            &zubra::filesystem,
        )
        .map_err(render)?;
        // Printed with a newline at the end, as it always was.
        if output_path.is_none() {
            println!("{html}");
            return Ok(());
        }
        html
    } else {
        let name = Path::new(&source_path)
            .file_name()
            .map_or(source_path.clone(), |name| {
                name.to_string_lossy().into_owned()
            });
        // The JavaScript module the manifest describes: header.zb → header.js by default.
        let module_path = parsed.value("--module-path").map_or_else(
            || {
                let stem = zubra::component_extension(&name).map_or(name.as_str(), |extension| {
                    &name[..name.len() - extension.len()]
                });
                format!("{stem}.js")
            },
            str::to_owned,
        );
        let keep_imports = parsed.has("--keep-imports");
        match emit.as_str() {
            "js" => {
                let style_imports = css_import
                    .zip(css_import_inline)
                    .map(|(stylesheet, inline)| zubra::StyleImports { stylesheet, inline });
                zubra::compile_js_options(
                    &source,
                    &source_path,
                    &zubra::JsOptions {
                        runtime,
                        // A bundler resolves `.zb` imports itself.
                        component_extension: (!keep_imports && style_imports.is_none())
                            .then_some(".js"),
                        style_imports,
                        styles_href: None,
                        devtools: parsed.has("--devtools"),
                        binder_entries: parsed.has("--binder-entries"),
                        client_only: parsed.has("--client-only"),
                    },
                    &zubra::filesystem,
                )
            }
            "css" if parsed.has("--no-imports") => zubra::compile_css(&source),
            "css" => zubra::compile_css_file(&source_path),
            "element" => zubra::compile_element_with(
                &source,
                &source_path,
                (!keep_imports).then_some(".js"),
                &zubra::filesystem,
            ),
            "dts" => zubra::compile_declarations_for(&source, &name, framework),
            "manifest" => zubra::compile_manifest(&source, &module_path),
            "html-data" => zubra::compile_html_data(&source),
            "interface" => zubra::compile_interface_with(&source, &source_path, &zubra::filesystem),
            "server" => zubra::compile_server(&source),
            // The TypeScript file `zubra check --types` has tsc check (its map is in `zubra request`).
            "tsx" => zubra::virtual_typescript_with(&source, &source_path, &zubra::filesystem)
                .map(|(code, _)| code),
            _ => unreachable!("the parser takes only --emit values the table has"),
        }
        .map_err(render)?
    };
    match output_path {
        Some(output_path) => Ok(write_atomically(output_path, output.as_bytes())?),
        None => {
            print!("{output}");
            Ok(())
        }
    }
}

fn write_atomically(output_path: &str, contents: &[u8]) -> Result<(), String> {
    let path = Path::new(output_path);
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent)
        .map_err(|error| format!("{output_path}: unable to create output directory: {error}"))?;
    let name = path
        .file_name()
        .ok_or_else(|| format!("{output_path}: output path must name a file"))?;
    let temporary = parent.join(format!(
        ".{}.zb-tmp-{}",
        name.to_string_lossy(),
        std::process::id()
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| {
                format!(
                    "{}: unable to create temporary output: {error}",
                    temporary.display()
                )
            })?;
        file.write_all(contents).map_err(|error| {
            format!(
                "{}: unable to write temporary output: {error}",
                temporary.display()
            )
        })?;
        file.sync_all().map_err(|error| {
            format!(
                "{}: unable to flush temporary output: {error}",
                temporary.display()
            )
        })?;
        fs::rename(&temporary, path)
            .map_err(|error| format!("{output_path}: unable to promote generated output: {error}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// `path` if it's a `.zb` file (or named outright), else every `.zb` under it.
fn collect_zb(path: &Path, files: &mut Vec<std::path::PathBuf>) -> std::io::Result<()> {
    if !path.is_dir() {
        // A file named outright is formatted whatever its extension says; zubra::format refuses JSX.
        fs::metadata(path)?;
        files.push(path.to_path_buf());
        return Ok(());
    }
    let mut entries: Vec<_> = fs::read_dir(path)?.collect::<Result<_, _>>()?;
    entries.sort_by_key(std::fs::DirEntry::path);
    for entry in entries {
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry_path.is_dir() {
            if !(name.starts_with('.')
                || ["node_modules", "dist", "target"].contains(&name.as_str()))
            {
                collect_zb(&entry_path, files)?;
            }
        } else if name.ends_with(".zb") {
            files.push(entry_path);
        }
    }
    Ok(())
}

/// What `zubra check` checks under a folder: every component, in JSX too, by the rules `fmt`
/// walks by (no hidden folder, `node_modules`, `dist` or `target`).
fn collect_components(path: &Path, files: &mut Vec<String>) -> std::io::Result<()> {
    let mut entries: Vec<_> = fs::read_dir(path)?.collect::<Result<_, _>>()?;
    entries.sort_by_key(std::fs::DirEntry::path);
    for entry in entries {
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry_path.is_dir() {
            if !(name.starts_with('.')
                || ["node_modules", "dist", "target"].contains(&name.as_str()))
            {
                collect_components(&entry_path, files)?;
            }
        } else if [".zb", ".zb.jsx", ".zb.tsx"]
            .iter()
            .any(|extension| name.ends_with(extension))
        {
            files.push(entry_path.to_string_lossy().into_owned());
        }
    }
    Ok(())
}

/// `zubra fmt`: format `.zb` files in place (folders: every `.zb` in them, skipping
/// `node_modules`, `dist`, `target` and dot-folders). `--check` changes nothing and fails if a
/// file would change, for CI. `--stdin` formats standard input to standard output, for editors.
fn fmt(parsed: &Parsed) -> Outcome {
    let paths = &parsed.positionals;
    let check = parsed.has("--check");
    let mut options = zubra::FormatOptions::default();
    let number = |flag: &str| -> Result<Option<usize>, Failure> {
        parsed
            .value(flag)
            .map(|value| {
                value
                    .parse()
                    .ok()
                    .filter(|&value: &usize| value > 0)
                    .ok_or_else(|| usage(format!("{flag} takes a positive number")))
            })
            .transpose()
    };
    options.use_tabs = parsed.has("--tabs");
    if let Some(indent) = number("--indent")? {
        options.indent_width = indent;
    }
    if let Some(width) = number("--width")? {
        options.print_width = width;
    }
    if parsed.has("--stdin") {
        if check || paths.len() > 1 {
            return Err(
                parsed.usage("--stdin takes at most one path (for messages), and not --check")
            );
        }
        let name = paths.first().map_or("<stdin>", String::as_str);
        let source = std::io::read_to_string(std::io::stdin())
            .map_err(|error| format!("unable to read standard input: {error}"))?;
        let formatted =
            zubra::format(&source, &options).map_err(|error| error.render_in(&source, name))?;
        print!("{formatted}");
        return Ok(());
    }
    if paths.is_empty() {
        return Err(parsed.usage("missing the files or folders to format"));
    }
    let mut files = Vec::new();
    for path in paths {
        collect_zb(Path::new(path), &mut files).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                format!("no such file: {path}")
            } else {
                format!("{path}: {error}")
            }
        })?;
    }
    let (mut changed, mut failed) = (Vec::new(), 0);
    for file in &files {
        let name = file.display().to_string();
        let source = read(&name)?;
        match zubra::format(&source, &options) {
            Ok(formatted) if formatted == source => {}
            Ok(formatted) => {
                if !check {
                    fs::write(file, &formatted)
                        .map_err(|error| format!("{name}: unable to write: {error}"))?;
                }
                changed.push(name);
            }
            Err(error) => {
                failed += 1;
                eprint!("{}", error.render_in(&source, &name));
            }
        }
    }
    for name in &changed {
        println!(
            "{}{name}",
            if check { "would format " } else { "formatted " }
        );
    }
    if failed > 0 {
        return Err(Failure::Input(format!(
            "{failed} file{} couldn't be formatted",
            if failed == 1 { "" } else { "s" }
        )));
    }
    if check && !changed.is_empty() {
        return Err(Failure::Input(format!(
            "{} file{} not formatted; run zubra fmt",
            changed.len(),
            if changed.len() == 1 { " is" } else { "s are" }
        )));
    }
    Ok(())
}

/// Whether a component is TypeScript (`<script lang="ts">`, or `.zb.tsx`), whose types only
/// `npx zubra check --types` checks.
fn is_typescript(path: &str, source: &str) -> bool {
    path.ends_with(".zb.tsx")
        || source.match_indices("<script").any(|(at, _)| {
            let tag = &source[at..source[at..].find('>').map_or(source.len(), |end| at + end)];
            tag.contains("lang=\"ts\"") || tag.contains("lang='ts'") || tag.contains("lang=ts")
        })
}

/// `zubra check`: every error and warning, for CI and editors. Exit 1 on an error, and on a
/// warning with `--deny-warnings`.
fn check(parsed: &Parsed) -> Outcome {
    let mut files = parsed.positionals.clone();
    let json = parsed.value("--format") == Some("json");
    let stdin = parsed.has("--stdin");
    let server = parsed.has("--server");
    let client = parsed.has("--client");
    let deny_warnings = parsed.has("--deny-warnings");
    // Type checking runs the project's own TypeScript, from Node.
    if parsed.has("--types") || parsed.has("--keep") {
        return Err(usage("`zubra check --types` is in the npm package, since it runs the project's TypeScript: npx zubra check --types <file | folder>... (@zubra/compiler)"));
    }
    if files.is_empty() {
        return Err(parsed.usage("missing the files or folders to check"));
    }
    if stdin && files.len() != 1 {
        return Err(parsed.usage("--stdin takes one path: where the text on standard input is"));
    }
    // A folder is every component under it. (With --stdin the one path names the text, and is
    // never read.)
    if !stdin {
        let mut found = Vec::new();
        for path in files {
            if Path::new(&path).is_dir() {
                let before = found.len();
                collect_components(Path::new(&path), &mut found)
                    .map_err(|error| format!("{path}: unable to read the folder: {error}"))?;
                if found.len() == before {
                    return Err(Failure::Input(format!(
                        "{path}: no components (.zb, .zb.jsx, .zb.tsx) in this folder"
                    )));
                }
            } else {
                found.push(path);
            }
        }
        files = found;
    }
    let mut report = Vec::new();
    let mut errors = 0;
    let mut warnings = 0;
    let mut typescript = false;
    let mut human = String::new();
    for path in &files {
        let source = if stdin {
            std::io::read_to_string(std::io::stdin())
                .map_err(|error| format!("unable to read standard input: {error}"))?
        } else {
            read(path)?
        };
        typescript |= is_typescript(path, &source);
        for warning in zubra::warnings_with(&source, path, &zubra::filesystem) {
            warnings += 1;
            human.push_str(&warning.render_warning(&source, path));
            report.push(entry(path, &source, &warning, "warning"));
        }
        // The JavaScript output runs every check that doesn't need prop values.
        if let Err(error) = zubra::compile_js_with(
            &source,
            path,
            "@zubra/runtime",
            Some(".js"),
            &zubra::filesystem,
        ) {
            errors += 1;
            human.push_str(&error.render_in(&source, path));
            report.push(entry(path, &source, &error, "error"));
        } else if server {
            match zubra::server_gaps(&source, path, &zubra::filesystem) {
                Ok(gaps) => {
                    for (gap, error) in gaps {
                        if error {
                            errors += 1;
                            human.push_str(&gap.render_in(&source, path));
                        } else {
                            warnings += 1;
                            human.push_str(&gap.render_warning(&source, path));
                        }
                        report.push(entry(
                            path,
                            &source,
                            &gap,
                            if error { "error" } else { "warning" },
                        ));
                    }
                }
                Err(error) => {
                    errors += 1;
                    human.push_str(&error.render_in(&source, path));
                    report.push(entry(path, &source, &error, "error"));
                }
            }
        }
        if client {
            if let Ok(reasons) = zubra::client_reasons(&source, path, &zubra::filesystem) {
                if reasons.is_empty() {
                    human.push_str(&format!("{path}: no client JavaScript needed: its server HTML is complete (0 KB), unless a page changes its props from script\n"));
                } else {
                    human.push_str(&format!(
                        "{path}: needs its module in the browser: {}\n",
                        reasons.join("; ")
                    ));
                }
                report.push(
                    serde_json::json!({ "file": path, "severity": "info", "client": reasons }),
                );
            }
        }
    }
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&report).expect("JSON serializes")
        );
    } else {
        eprint!("{human}");
        if errors == 0 {
            eprintln!(
                "checked {} file{}: no errors",
                files.len(),
                if files.len() == 1 { "" } else { "s" }
            );
            if typescript {
                eprintln!("TypeScript types weren't checked: run npx zubra check --types (@zubra/compiler)");
            }
        }
    }
    if errors > 0 {
        return Err(Failure::Input(if json {
            String::new()
        } else {
            format!(
                "{errors} file{} with errors",
                if errors == 1 { "" } else { "s" }
            )
        }));
    }
    if deny_warnings && warnings > 0 {
        return Err(Failure::Input(if json {
            String::new()
        } else {
            format!(
                "{warnings} warning{} (--deny-warnings)",
                if warnings == 1 { "" } else { "s" }
            )
        }));
    }
    Ok(())
}

fn entry(
    path: &str,
    _source: &str,
    diagnostic: &zubra::Diagnostic,
    severity: &str,
) -> serde_json::Value {
    let file = diagnostic
        .file
        .as_ref()
        .map_or(path, |(file, _)| file.as_str());
    serde_json::json!({
        "file": file,
        "code": diagnostic.code.as_str(),
        "line": diagnostic.span.line,
        "column": diagnostic.span.column,
        "severity": severity,
        "message": diagnostic.message,
        "help": diagnostic.help,
    })
}

/// `zubra convert`: a React function component, written out as a zubra JSX component next to it
/// (`--out` elsewhere, `--stdout` to print it), or a class in `--emit element`'s shape back to
/// `.zb`. What wasn't converted is reported, and the exit status is 1 then, so a script can tell.
fn convert(parsed: &Parsed) -> Outcome {
    let path = match parsed.positionals.as_slice() {
        [path] => path.clone(),
        [] => return Err(parsed.usage("missing the file to convert")),
        [_, extra, ..] => {
            return Err(parsed.usage(&format!(
                "`zubra convert` takes one file; `{extra}` is a second"
            )))
        }
    };
    let prefix = parsed.value("--prefix");
    let component = parsed.value("--component");
    let as_zb = parsed.value("--as") == Some("zubra");
    let out = parsed.value("--out").map(str::to_owned);
    let stdout = parsed.has("--stdout");
    let source = read(&path)?;
    // A custom element class (`--emit element` output, or one written the same way): back to `.zb`.
    let element = !path.ends_with(".jsx")
        && !path.ends_with(".tsx")
        && source.contains("extends HTMLElement");
    let mut conversion = if element {
        zubra::convert_element(&source, &path)
            .map_err(|diagnostic| diagnostic.render_in(&source, &path))?
    } else {
        zubra::convert_component(&source, &path, prefix, component)
            .map_err(|diagnostic| diagnostic.render_in(&source, &path))?
    };
    let mut lowering_error = None;
    if as_zb {
        if conversion.unsupported.is_empty() && conversion.compile_error.is_none() {
            lowering_error = zubra::convert_as_zb(&mut conversion);
        } else {
            conversion.changes.push("left as JSX: `--as zubra` writes the .zb file once nothing is left to finish by hand".to_owned());
        }
    }
    let target = out.unwrap_or_else(|| {
        std::path::Path::new(&path)
            .with_file_name(&conversion.file_name)
            .to_string_lossy()
            .into_owned()
    });
    // Written elsewhere: relative imports still point at what they did.
    let from_dir = std::path::Path::new(&path)
        .parent()
        .unwrap_or(std::path::Path::new(""));
    let to_dir = std::path::Path::new(&target)
        .parent()
        .unwrap_or(std::path::Path::new(""));
    if !stdout && from_dir != to_dir {
        let (output, moved) = rebase_imports(&conversion.output, from_dir, to_dir);
        if moved > 0 {
            conversion.output = output;
            conversion.changes.push(format!(
                "adjusted {moved} relative import{} for {}",
                if moved == 1 { "" } else { "s" },
                to_dir.display()
            ));
        }
    }
    for change in &conversion.changes {
        eprintln!("{path}: {change}");
    }
    if stdout {
        print!("{}", conversion.output);
    } else {
        write_atomically(&target, conversion.output.as_bytes())?;
        eprintln!("{path}: wrote {target} (<{}>)", conversion.tag);
    }
    for diagnostic in &conversion.unsupported {
        eprint!("{}", diagnostic.render_warning(&source, &path));
    }
    if let Some(error) = &conversion.compile_error {
        // (In the output, where it is to be fixed.)
        eprint!("{}", error.render_warning(&conversion.output, &target));
    }
    if let Some(error) = &lowering_error {
        eprint!("{}", error.render_warning(&conversion.output, &target));
    }
    let left = conversion.unsupported.len()
        + usize::from(conversion.compile_error.is_some())
        + usize::from(lowering_error.is_some());
    if left == 0 {
        return Ok(());
    }
    Err(Failure::Input(format!(
        "{left} thing{} to finish by hand (above)",
        if left == 1 { "" } else { "s" }
    )))
}

/// Rewrite `from './x'` / `import './x'` specifiers written relative to `from` to be relative
/// to `to`. Returns the text and how many changed.
fn rebase_imports(text: &str, from: &std::path::Path, to: &std::path::Path) -> (String, usize) {
    use std::path::{Component, Path, PathBuf};
    let absolute = |path: &Path| -> PathBuf {
        let path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            env::current_dir().unwrap_or_default().join(path)
        };
        let mut out = PathBuf::new();
        for component in path.components() {
            match component {
                Component::ParentDir => {
                    out.pop();
                }
                Component::CurDir => {}
                other => out.push(other.as_os_str()),
            }
        }
        out
    };
    let (from, to) = (absolute(from), absolute(to));
    let relative = |target: &Path| -> String {
        let target: Vec<_> = target.components().collect();
        let base: Vec<_> = to.components().collect();
        let common = target.iter().zip(&base).take_while(|(a, b)| a == b).count();
        let mut parts: Vec<String> = vec!["..".into(); base.len() - common];
        parts.extend(
            target[common..]
                .iter()
                .map(|part| part.as_os_str().to_string_lossy().into_owned()),
        );
        let joined = parts.join("/");
        if joined.starts_with("..") {
            joined
        } else {
            format!("./{joined}")
        }
    };
    let mut out = String::with_capacity(text.len());
    let mut moved = 0;
    let mut rest = text;
    while let Some(at) = rest.find(['\'', '"']) {
        let quote = rest.as_bytes()[at] as char;
        let before = rest[..at].trim_end();
        let is_import =
            before.ends_with(" from") || before.ends_with("import") || before.ends_with("import(");
        let Some(len) = rest[at + 1..].find(quote) else {
            break;
        };
        let specifier = &rest[at + 1..at + 1 + len];
        out.push_str(&rest[..=at]);
        if is_import && (specifier.starts_with("./") || specifier.starts_with("../")) {
            let rebased = relative(&absolute(&from.join(specifier)));
            if rebased != specifier {
                moved += 1;
            }
            out.push_str(&rebased);
        } else {
            out.push_str(specifier);
        }
        out.push(quote);
        rest = &rest[at + 2 + len..];
    }
    out.push_str(rest);
    (out, moved)
}
