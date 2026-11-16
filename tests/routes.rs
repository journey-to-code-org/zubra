//! `'use route <path>'` and `'use layout <prefix>'`: pages and layouts `@zubra/router` serves,
//! and their server-only `load`. The browser module never sees `load` or what only it imports;
//! `--emit server` and `--emit interface` say what the component is.

use zubra::{compile, compile_interface, compile_js, compile_server};

const FARM: &str = r#"<script>
  'use route /farms/:id'
  import { db } from './db.js';
  import { label } from './label.js';
  export async function load({ params }) {
    const farm = await db.farm(params.id, label('farm'));
    if (!farm) return { status: 404 };
    return { farm };
  }
  const heading = label('heading');
</script>
<farm-page farm={null}>
  <h1>Farm</h1>
</farm-page>"#;

fn error(source: &str) -> zubra::Diagnostic {
    compile(source, "{}").expect_err("should not compile")
}

#[test]
fn load_and_its_server_only_imports_never_reach_the_browser() {
    let js = compile_js(FARM, "@zubra/runtime", "farm-page.zb").unwrap();
    assert!(!js.contains("db.js"), "{js}");
    assert!(!js.contains("db.farm"), "{js}");
    assert!(!js.contains("function load"), "{js}");
    assert!(!js.contains("404"), "{js}");
    // An import the rest of the script uses too stays.
    assert!(js.contains("./label.js"), "{js}");
    // The server HTML renders as before.
    let html = compile(FARM, "{}").unwrap();
    assert!(html.contains("<h1>"), "{html}");
}

#[test]
fn the_server_module_carries_the_route_and_load() {
    let server = compile_server(FARM).unwrap();
    assert!(server.contains("import { db } from './db.js'"), "{server}");
    assert!(
        server.contains("import { label } from './label.js'"),
        "{server}"
    );
    assert!(
        server.contains(
            r#"export const route = {"kind":"page","pattern":"/farms/:id","params":["id"],"root":false};"#
        ),
        "{server}"
    );
    assert!(
        server.contains("export async function load({ params })"),
        "{server}"
    );
    // `load` is not an action: nothing can post to it.
    assert!(server.contains("export const actions = {};"), "{server}");
}

#[test]
fn the_interface_says_it_is_a_route() {
    let interface: serde_json::Value =
        serde_json::from_str(&compile_interface(FARM).unwrap()).unwrap();
    assert_eq!(interface["route"]["kind"], "page");
    assert_eq!(interface["route"]["pattern"], "/farms/:id");
    assert_eq!(interface["route"]["params"], serde_json::json!(["id"]));
    assert_eq!(interface["route"]["load"], true);
    // A component that isn't one says so.
    let plain: serde_json::Value =
        serde_json::from_str(&compile_interface("<x-y></x-y>").unwrap()).unwrap();
    assert!(plain["route"].is_null());
}

#[test]
fn a_layout_has_a_prefix_and_can_be_a_root() {
    let source = r#"<script>
  'use layout /farm root'
  export function load({ context }) { return { person: context.person }; }
</script>
<farm-shell person={null}><zb-slot></zb-slot></farm-shell>"#;
    let interface: serde_json::Value =
        serde_json::from_str(&compile_interface(source).unwrap()).unwrap();
    assert_eq!(interface["route"]["kind"], "layout");
    assert_eq!(interface["route"]["pattern"], "/farm");
    assert_eq!(interface["route"]["root"], true);
    // The interface names the slots, so the router can tell a layout has somewhere for its page.
    assert_eq!(interface["slots"], serde_json::json!(["default"]));
    let named: serde_json::Value = serde_json::from_str(
        &compile_interface(r#"<x-y><zb-slot name="side"></zb-slot></x-y>"#).unwrap(),
    )
    .unwrap();
    assert_eq!(named["slots"], serde_json::json!(["side"]));
    let plain =
        r#"<script>'use layout /farm'</script><farm-shell><zb-slot></zb-slot></farm-shell>"#;
    let interface: serde_json::Value =
        serde_json::from_str(&compile_interface(plain).unwrap()).unwrap();
    assert_eq!(interface["route"]["root"], false);
    assert!(
        error(r#"<script>'use layout /farm alone'</script><x-y></x-y>"#)
            .message
            .contains("only `root`")
    );
}

#[test]
fn a_parameter_nothing_reads_is_an_error() {
    let unread = r#"<script>
  'use route /farms/:id/:tab'
  export async function load({ params }) { return { farm: params.id }; }
</script>
<farm-page farm={null}></farm-page>"#;
    let diagnostic = error(unread);
    assert!(
        diagnostic
            .message
            .contains("has the parameter `tab`, which neither `load` nor a prop reads"),
        "{}",
        diagnostic.message
    );
    // Read by load, in either shape.
    for load in [
        "export function load({ params }) { return { a: params.id + params.tab }; }",
        "export function load({ params: { id, tab } }) { return { a: id + tab }; }",
        // Passed on whole: the compiler can't see which it reads, so it trusts it.
        "export function load({ params }) { return find(params); }",
        "export function load(request) { return find(request); }",
    ] {
        let source = format!(
            "<script>\n  'use route /farms/:id/:tab'\n  {load}\n</script>\n<farm-page a=\"\"></farm-page>"
        );
        compile(&source, "{}").unwrap_or_else(|error| panic!("{load}: {}", error.message));
    }
    // No load: the parameters are props.
    let props = r#"<script>'use route /farms/:id'</script><farm-page id=""></farm-page>"#;
    compile(props, "{}").unwrap();
    let missing = r#"<script>'use route /farms/:id'</script><farm-page></farm-page>"#;
    assert!(error(missing).message.contains("parameter `id`"));
}

#[test]
fn load_belongs_to_a_route_and_is_not_an_action() {
    let no_route = r#"<script>
  export async function load() { return {}; }
</script>
<x-y></x-y>"#;
    assert!(error(no_route)
        .message
        .contains("only a route or a layout can export `load`"));
    let marked = r#"<script>
  'use route /'
  export async function load() { 'use server'; return {}; }
</script>
<x-y></x-y>"#;
    assert!(error(marked).message.contains("anyone can post to"));
    let called = r#"<script>
  'use route /'
  export async function load() { return {}; }
  const again = () => load();
</script>
<x-y></x-y>"#;
    assert!(error(called).message.contains("can't call it"));
}

#[test]
fn route_directives_are_checked() {
    // Bare: the path comes from its place in a `routes/` folder (@zubra/router).
    let bare: serde_json::Value = serde_json::from_str(
        &compile_interface(
            r#"<script>'use route'
  export function load({ params }) { return { name: params.id }; }
</script><x-y name=""></x-y>"#,
        )
        .unwrap(),
    )
    .unwrap();
    assert!(bare["route"]["pattern"].is_null());
    assert_eq!(bare["route"]["reads"], serde_json::json!(["id"]));
    let root: serde_json::Value = serde_json::from_str(
        &compile_interface(r#"<script>'use layout root'</script><x-y><zb-slot></zb-slot></x-y>"#)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(root["route"]["root"], true);
    assert!(error(r#"<script>'use route farms'</script><x-y></x-y>"#)
        .message
        .contains("starts with `/`"));
    assert!(
        error(r#"<script>'use route /a/:id/:id'</script><x-y id=""></x-y>"#)
            .message
            .contains("twice")
    );
    assert!(
        error(r#"<script>'use route /a'; 'use layout /a'</script><x-y></x-y>"#)
            .message
            .contains("one route or one layout")
    );
    // Known now: no warning.
    assert!(zubra::warnings(r#"<script>'use route /'</script><x-y></x-y>"#).is_empty());
    let help = |directive: &str| {
        let source = format!("<script>'{directive}'</script>\n<x-y></x-y>");
        zubra::warnings(&source)
            .into_iter()
            .next()
            .and_then(|warning| warning.help)
            .unwrap_or_default()
    };
    assert!(help("use rout /farms").contains("did you mean 'use route /farms'?"));
    assert!(help("use page /farms").contains("did you mean 'use route /farms'?"));
    assert!(help("use layuot /farm").contains("did you mean 'use layout /farm'?"));
    assert!(help("use cache").contains("@zubra/router"));
}

#[test]
fn a_key_load_returns_that_is_not_a_prop_is_a_warning() {
    let page = |load: &str| {
        format!(
            "<script>\n  'use route /farms/:id'\n  export async function load({{ params }}) {{\n    {load}\n  }}\n</script>\n<farm-page farm={{null}}></farm-page>"
        )
    };
    let messages = |source: &str| -> Vec<String> {
        zubra::warnings(source)
            .into_iter()
            .map(|warning| warning.message)
            .collect()
    };
    let dropped = messages(&page(
        "if (!params.id) return { farm: null }; return { farm: 1, frm: 2, title: 'A farm' };",
    ));
    assert_eq!(dropped.len(), 1, "{dropped:?}");
    assert!(
        dropped[0].contains("`load` returns `frm`, which <farm-page> doesn't declare as a prop"),
        "{dropped:?}"
    );
    // What the compiler can't see, it says nothing about: a spread, a variable, a call, and a
    // function inside load, which returns to its own caller.
    for quiet in [
        "const rest = { x: params.id }; return { farm: 1, ...rest };",
        "const answer = { nope: params.id }; return answer;",
        "return notFound(params.id);",
        "const each = [params.id].map((id) => { return { nope: id }; }); return { farm: each };",
    ] {
        assert!(messages(&page(quiet)).is_empty(), "{quiet}");
    }
    // A layout's keys reach the pages under it, so they aren't checked against its own props.
    let layout = "<script>\n  'use layout /farm'\n  export function load() { return { person: 1 }; }\n</script>\n<farm-shell><zb-slot></zb-slot></farm-shell>";
    assert!(messages(layout).is_empty());
}

#[test]
fn a_browser_name_that_shadows_a_server_import_does_not_keep_it() {
    // Each `db` below is the browser's own: a parameter, a block's const, a catch binding.
    let source = r#"<script>
  'use route /count'
  import { db } from './db.server.js';
  export async function load() { return { n: await db.count() } }
  function plus(db) { return db + 1 }
  const two = (() => { const db = 2; return db })();
  try { plus(two) } catch (db) { console.log(db) }
</script>
<count-page n=""><p>{n}</p></count-page>"#;
    let js = compile_js(source, "@zubra/runtime", "count-page.zb").unwrap();
    assert!(!js.contains("db.server.js"), "{js}");
    let server = compile_server(source).unwrap();
    assert!(
        server.contains("import { db } from './db.server.js'"),
        "{server}"
    );
    // The same for an action's import.
    let action = r#"<script>
  import { db } from './db.server.js';
  export async function save(form) { 'use server'; await db.save(form) }
  const rows = [1, 2].map((db) => db * 2);
</script>
<save-form><form action={save}><button>Save</button></form></save-form>"#;
    let js = compile_js(action, "@zubra/runtime", "save-form.zb").unwrap();
    assert!(!js.contains("db.server.js"), "{js}");
}

#[test]
fn server_code_cannot_read_the_scripts_own_bindings() {
    // The script is the browser's: a secret there is sent to every visitor, and undefined where
    // `load` runs.
    let message = error(
        r#"<script>
  'use route /pay'
  const API_KEY = 'sk-live-secret';
  export async function load() { return { ok: API_KEY.length > 0 } }
</script>
<pay-page ok={false}></pay-page>"#,
    )
    .to_string();
    assert!(message.contains("`API_KEY` is the script's"), "{message}");
    let message = error(
        r#"<script>
  function secret() { return 'x' }
  export async function save(form) { 'use server'; return secret() }
</script>
<save-form><form action={save}><button>Save</button></form></save-form>"#,
    )
    .to_string();
    assert!(message.contains("`secret` is the script's"), "{message}");
    // Its own locals, imports, and the other server functions are fine.
    compile_server(
        r#"<script>
  'use route /pay'
  import { keys } from './keys.server.js';
  export async function load() { const KEY = keys.pay; return { ok: KEY.length > 0 } }
</script>
<pay-page ok={false}></pay-page>"#,
    )
    .unwrap();
    compile_server(
        r#"<script>
  export async function check(form) { 'use server'; return form.get('x') }
  export async function save(form) { 'use server'; return check(form) }
</script>
<save-form><form action={save}><button>Save</button></form></save-form>"#,
    )
    .unwrap();
}

#[test]
fn the_server_half_can_end_with_a_map_of_its_functions_lines_to_the_components() {
    // TypeScript too: its types are removed in place, so a line of the function is still the
    // same line of the file.
    let source = "<!-- A page. -->\n<script lang=\"ts\">\n  'use route /farms/:id'\n  import { find } from './farms.js'\n\n  export async function save(formData: FormData) {\n    'use server'\n    return find(String(formData.get('id')))\n  }\n\n  export async function load({ params }: { params: { id: string } }) {\n    const farm = find(params.id)\n    return { farm }\n  }\n</script>\n<farm-page farm={null}><p>{farm}</p></farm-page>";
    let plain = compile_server(source).unwrap();
    assert!(!plain.contains("sourceMappingURL"), "{plain}");
    let mapped = zubra::compile_server_at(source, Some("components/farm-page.zb")).unwrap();
    // The same module, and one comment after it.
    assert!(mapped.starts_with(&plain), "{mapped}");
    let comment = mapped[plain.len()..].trim_end();
    let encoded = comment
        .strip_prefix("//# sourceMappingURL=data:application/json;base64,")
        .unwrap_or_else(|| panic!("{comment}"));
    let map: serde_json::Value = serde_json::from_slice(&unbase64(encoded)).unwrap();
    assert_eq!(map["version"], 3);
    assert_eq!(
        map["sources"],
        serde_json::json!(["components/farm-page.zb"])
    );
    // Each line of each function, in the module, is its own line of the file.
    let lines = decode(map["mappings"].as_str().unwrap());
    let module: Vec<&str> = mapped.lines().collect();
    let file: Vec<&str> = source.lines().collect();
    let line_of =
        |text: &str, lines: &[&str]| lines.iter().position(|line| line.contains(text)).unwrap();
    for text in [
        "async function save(",
        "return find(String(",
        "async function load(",
        "const farm = find(params.id)",
        "return { farm }",
    ] {
        let generated = line_of(text, &module);
        assert_eq!(
            lines
                .iter()
                .find(|(at, _)| *at == generated)
                .map(|(_, source)| *source),
            Some(line_of(text, &file)),
            "{text}"
        );
    }
    // Nothing else is mapped: the header and the constants aren't the file's lines.
    assert_eq!(lines.len(), 4 + 4);
    // A component with no function in its half has nothing to map, and a JSX component's
    // script is the compiler's own text.
    let bare = "<bare-page><p>x</p></bare-page>";
    assert!(!zubra::compile_server_at(bare, Some("bare-page.zb"))
        .unwrap()
        .contains("sourceMappingURL"));
}

fn unbase64(text: &str) -> Vec<u8> {
    const DIGITS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let (mut bits, mut count) = (0u32, 0);
    for digit in text.chars().take_while(|digit| *digit != '=') {
        bits = (bits << 6) | DIGITS.find(digit).unwrap() as u32;
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
            bits &= (1 << count) - 1;
        }
    }
    out
}

/// A source map's `mappings` as (generated line, source line), both from 0.
fn decode(mappings: &str) -> Vec<(usize, usize)> {
    const DIGITS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let mut source_line = 0i64;
    for (generated, line) in mappings.split(';').enumerate() {
        if line.is_empty() {
            continue;
        }
        let mut fields = Vec::new();
        let (mut value, mut shift) = (0i64, 0);
        for digit in line.chars() {
            let digit = DIGITS.find(digit).unwrap() as i64;
            value |= (digit & 31) << shift;
            if digit & 32 != 0 {
                shift += 5;
                continue;
            }
            fields.push(if value & 1 == 1 {
                -(value >> 1)
            } else {
                value >> 1
            });
            (value, shift) = (0, 0);
        }
        assert_eq!(fields.len(), 4, "one segment a line");
        source_line += fields[2];
        out.push((generated, source_line as usize));
    }
    out
}
