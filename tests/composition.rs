//! Components that use other components: `import "./x.zb"` in a `<script>`.

use std::collections::HashMap;

use zubra::{compile, compile_html_with, compile_js_with, Diagnostic};

const BADGE: &str = r#"<zb-badge label="new" count={0} info={{ color: "gray" }}>
  <span data-color={info.color}><zb-slot name="icon"></zb-slot><b>{label}</b> {count}<zb-slot></zb-slot></span>
</zb-badge>"#;

const CARD: &str = r#"<zb-card shadow heading="">
  <h2>{heading}</h2><zb-slot></zb-slot>
</zb-card>"#;

/// An in-memory "filesystem": specifiers resolve to the names in `files`, ignoring the importer.
fn files(files: &[(&str, &str)]) -> HashMap<String, String> {
    files
        .iter()
        .map(|(name, source)| ((*name).to_owned(), (*source).to_owned()))
        .collect()
}

fn html(source: &str, children: &HashMap<String, String>) -> Result<String, Diagnostic> {
    let loader = |specifier: &str, _from: &str| {
        children
            .get(specifier)
            .map(|source| {
                (
                    specifier.trim_start_matches("./").to_owned(),
                    source.clone(),
                )
            })
            .ok_or_else(|| "not found".to_owned())
    };
    compile_html_with(source, "app.zb", "{}", "{}", &loader)
}

fn js(
    source: &str,
    children: &HashMap<String, String>,
    extension: Option<&str>,
) -> Result<String, Diagnostic> {
    let loader = |specifier: &str, _from: &str| {
        children
            .get(specifier)
            .map(|source| {
                (
                    specifier.trim_start_matches("./").to_owned(),
                    source.clone(),
                )
            })
            .ok_or_else(|| "not found".to_owned())
    };
    compile_js_with(source, "app.zb", "@zubra/runtime", extension, &loader)
}

const INBOX: &str = r#"<script>
  import './badge.zb'
</script>
<zb-inbox who="Ada" unread={3}>
  <zb-badge label={who} count={unread} info={{ color: unread > 0 ? "red" : "gray" }} class="row"><em slot="icon">{unread}</em>mail</zb-badge>
</zb-inbox>"#;

#[test]
fn renders_children_inline_with_props_as_values_and_content_in_their_slots() {
    let html = html(INBOX, &files(&[("./badge.zb", BADGE)])).unwrap();
    assert!(
        html.contains(r#"<zb-badge class="row" label="Ada" count="3" info="{&quot;color&quot;:&quot;red&quot;}" data-zb-filled="default icon">"#),
        "{html}"
    );
    assert!(
        html.contains(r#"<span data-color="red"><?zb [!?><em slot="icon">3</em><?zb ]?><b>Ada</b><?zb ?> 3<?zb [!?>mail<?zb ]?></span>"#),
        "{html}"
    );
}

#[test]
fn shadow_children_render_a_declarative_shadow_root_with_content_in_light_dom() {
    let source = r#"<script>import './card.zb'</script>
<zb-page><zb-card heading="Hi"><p>body</p></zb-card></zb-page>"#;
    let html = html(source, &files(&[("./card.zb", CARD)])).unwrap();
    assert!(
        html.contains(r#"<zb-card heading="Hi"><template shadowrootmode="open">"#),
        "{html}"
    );
    assert!(html.contains("<h2>Hi</h2><slot></slot>"), "{html}");
    assert!(html.contains("</template><p>body</p></zb-card>"), "{html}");
}

#[test]
fn child_props_are_checked_against_the_childs_defaults() {
    let children = files(&[("./badge.zb", BADGE)]);
    let wrong_type = r#"<script>import './badge.zb'</script>
<zb-x><zb-badge count={"three"}></zb-badge></zb-x>"#;
    let error = html(wrong_type, &children).unwrap_err();
    assert!(error.message.contains("count"), "{}", error.message);
    assert_eq!(error.span.line, 2);
    assert!(
        error.file.is_none(),
        "the error is in the parent, where the attribute is"
    );

    let typo = r#"<script>import './badge.zb'</script>
<zb-x><zb-badge lable={"x"}></zb-badge></zb-x>"#;
    let error = html(typo, &children).unwrap_err();
    assert_eq!(
        error.help.as_deref(),
        Some("did you mean `label`?"),
        "{error}"
    );

    let unknown_slot = r#"<script>import './badge.zb'</script>
<zb-x><zb-badge><i slot="nope">x</i></zb-badge></zb-x>"#;
    assert!(html(unknown_slot, &children)
        .unwrap_err()
        .message
        .contains("nope"));
}

#[test]
fn errors_inside_an_imported_component_name_that_file() {
    let broken = "<zb-badge><p>{missing}</p></zb-badge>";
    let source = "<script>import './badge.zb'</script>\n<zb-x><zb-badge></zb-badge></zb-x>";
    let error = html(source, &files(&[("./badge.zb", broken)])).unwrap_err();
    let (path, _) = error.file.clone().expect("the error is in the child");
    assert_eq!(path, "badge.zb");
    assert!(
        error
            .render_in(source, "app.zb")
            .contains("--> badge.zb:1:"),
        "{}",
        error.render_in(source, "app.zb")
    );
}

#[test]
fn imports_are_checked_for_cycles_duplicates_and_missing_files() {
    let a = "<script>import './b.zb'</script>\n<zb-a><zb-b></zb-b></zb-a>";
    let b = "<script>import './a.zb'</script>\n<zb-b><zb-a></zb-a></zb-b>";
    let error = html(a, &files(&[("./a.zb", a), ("./b.zb", b)])).unwrap_err();
    assert!(error.message.contains("import cycle"), "{}", error.message);

    let twice = "<script>import './badge.zb'\nimport './again.zb'</script>\n<zb-x></zb-x>";
    let error = html(
        twice,
        &files(&[("./badge.zb", BADGE), ("./again.zb", BADGE)]),
    )
    .unwrap_err();
    assert!(
        error.message.contains("imported more than once"),
        "{}",
        error.message
    );

    let missing = "<script>import './gone.zb'</script>\n<zb-x></zb-x>";
    let error = html(missing, &files(&[])).unwrap_err();
    assert!(
        error.message.contains("can't load `./gone.zb`"),
        "{}",
        error.message
    );
    assert_eq!(error.span.line, 1);

    let error = compile("<script>import './badge.zb'</script>\n<zb-x></zb-x>", "{}").unwrap_err();
    assert!(
        error.message.contains("compile it from a file"),
        "{}",
        error.message
    );
}

#[test]
fn javascript_passes_child_props_as_properties_and_finds_slotted_content_when_hydrating() {
    let output = js(INBOX, &files(&[("./badge.zb", BADGE)]), Some(".js")).unwrap();
    assert!(output.contains("import \"./badge.js\""), "{output}");
    assert!(
        output.contains(r#"property: "count", value: () => $p.unread"#),
        "{output}"
    );
    // Objects are parenthesized: `() => { … }` would be a function body.
    assert!(
        output.contains(r#"property: "info", value: () => ({ "color": "#),
        "{output}"
    );
    // Fresh: inside the content the parent clones; hydrating: where the child projected it.
    // badge [0] → its <span> [0] → the icon slot's region [0] → the <em> [0].
    assert!(
        output.contains("{ path: [0, 0], hydrate: [0, 0, 0, 0], text: () => $t($p.unread) }"),
        "{output}"
    );
}

#[test]
fn content_for_a_slot_in_two_branches_lists_both_places_to_check() {
    // The slot is first in the link, and second (after a spinner's region) in the button.
    const TWO_WAYS: &str = r#"<two-ways href="" busy={false}>
  <a zb-if={href} href={href}><zb-slot></zb-slot></a>
  <button zb-else type="button"><span zb-if={busy}>…</span><zb-slot></zb-slot></button>
</two-ways>"#;
    const USES: &str = "<script>import './two-ways.zb'</script>\n<uses-it label=\"Go\" href=\"\"><two-ways href={href}>{label}</two-ways></uses-it>";
    let output = js(USES, &files(&[("./two-ways.zb", TWO_WAYS)]), Some(".js")).unwrap();
    // two-ways [0] → its zb-if region [0] → the branch's element [0] → the slot's region (the
    // link's [0], the button's [1]) → the text [0]. From the second step on, each place says what
    // it leads to in the branch that has it: the region, the <a> or <button>, a filled slot.
    assert!(
        output.contains(r#"{ path: [0, 0], hydrate: [{ path: [0, 0, 0, 0, 0], kinds: [, "[", "a", "[!"] }, { path: [0, 0, 0, 1, 0], kinds: [, "[", "button", "[!"] }], anchor:"#),
        "{output}"
    );
    // A slot with one place keeps one path, as before.
    let one = js(INBOX, &files(&[("./badge.zb", BADGE)]), Some(".js")).unwrap();
    assert!(one.contains("hydrate: [0, 0, 0, 0], text:"), "{one}");
    assert!(!one.contains("hydrate: [{"), "{one}");
}

#[test]
fn content_for_a_slot_that_shares_its_place_with_another_slot_is_checked_or_not_offered() {
    // The same steps to both slots: nothing in the markup says which the server rendered.
    const SAME: &str = r#"<slot-swap wide={false}>
  <p zb-if={wide}><zb-slot name="left"></zb-slot></p>
  <p zb-else><zb-slot name="right"></zb-slot></p>
</slot-swap>"#;
    // Different elements: the element does.
    const TAGGED: &str = r#"<slot-swap wide={false}>
  <p zb-if={wide}><zb-slot name="left"></zb-slot></p>
  <div zb-else><zb-slot name="right"></zb-slot></div>
</slot-swap>"#;
    const USES: &str = "<script>import './slot-swap.zb'</script>\n<uses-it a=\"A\" b=\"B\"><slot-swap><b slot=\"left\">{a}</b><i slot=\"right\">{b}</i></slot-swap></uses-it>";
    let same = js(USES, &files(&[("./slot-swap.zb", SAME)]), Some(".js")).unwrap();
    // No place to offer: the element renders fresh rather than bind one slot's content to the other's.
    assert!(
        same.contains("{ path: [0, 0], hydrate: [], text:"),
        "{same}"
    );
    assert!(
        same.contains("{ path: [0, 1], hydrate: [], text:"),
        "{same}"
    );
    let tagged = js(USES, &files(&[("./slot-swap.zb", TAGGED)]), Some(".js")).unwrap();
    // One place each, checked: the only way to tell it from the other slot's.
    assert!(
        tagged.contains(r#"{ path: [0, 0], hydrate: [{ path: [0, 0, 0, 0, 0], kinds: [, "[", "p", "[!"] }], text:"#),
        "{tagged}"
    );
    assert!(
        tagged.contains(r#"{ path: [0, 1], hydrate: [{ path: [0, 0, 0, 0, 0], kinds: [, "[", "div", "[!"] }], text:"#),
        "{tagged}"
    );
}

#[test]
fn content_for_a_slot_its_component_forwards_sits_where_the_next_component_put_it() {
    const FRAME: &str = "<frame-box><div class=\"frame\"><zb-slot></zb-slot></div></frame-box>";
    const RELAY: &str = "<script>import './frame-box.zb'</script>\n<relay-box><frame-box><zb-slot></zb-slot></frame-box></relay-box>";
    const SENDS: &str = "<script>import './relay-box.zb'</script>\n<sends-it label=\"Go\"><relay-box><b>{label}</b></relay-box></sends-it>";
    let sends = js(
        SENDS,
        &files(&[("./relay-box.zb", RELAY), ("./frame-box.zb", FRAME)]),
        Some(".js"),
    )
    .unwrap();
    // relay-box [0] → frame-box [0] → its <div> [0] → its slot's region [0] → relay-box's slot's
    // region [0] → the <b> [0]: one place, nothing else there, so one path.
    assert!(
        sends.contains("{ path: [0, 0], hydrate: [0, 0, 0, 0, 0, 0], text:"),
        "{sends}"
    );

    // A named slot forwarded (#323): its content keeps `slot="y"`, so named-relay's slot part
    // says which of frame-box's slots it's in (`forward`), and the parent's content hydrates there.
    const NAMED: &str = "<script>import './frame-box.zb'</script>\n<named-relay><frame-box><zb-slot name=\"y\"></zb-slot></frame-box></named-relay>";
    const FILLS: &str = "<script>import './named-relay.zb'</script>\n<fills-it label=\"B\"><named-relay><b slot=\"y\">{label}</b></named-relay></fills-it>";
    let named = js(NAMED, &files(&[("./frame-box.zb", FRAME)]), Some(".js")).unwrap();
    assert!(
        named.contains(r#"binder: $slot, slot: "y", fallback: null, forward: "default""#),
        "{named}"
    );
    let fills = js(
        FILLS,
        &files(&[("./named-relay.zb", NAMED), ("./frame-box.zb", FRAME)]),
        Some(".js"),
    )
    .unwrap();
    assert!(
        fills.contains("{ path: [0, 0], hydrate: [0, 0, 0, 0, 0, 0], text:"),
        "{fills}"
    );
    // The default slot passed on says so too; a slot inside the component's own elements doesn't.
    let relay = js(RELAY, &files(&[("./frame-box.zb", FRAME)]), Some(".js")).unwrap();
    assert!(relay.contains(r#"forward: "default""#), "{relay}");
    let frame = js(FRAME, &files(&[]), Some(".js")).unwrap();
    assert!(!frame.contains("forward:"), "{frame}");
}

#[test]
fn a_bundler_keeps_zb_import_specifiers() {
    let output = js(INBOX, &files(&[("./badge.zb", BADGE)]), None).unwrap();
    assert!(output.contains("import './badge.zb'"), "{output}");
}

#[test]
fn a_child_default_computed_in_the_browser_must_be_passed_to_render_html() {
    let child = "<script>const start = Date.now()</script>\n<zb-clock since={start}><p>{since}</p></zb-clock>";
    let children = files(&[("./clock.zb", child)]);
    let error = html(
        "<script>import './clock.zb'</script>\n<zb-x><zb-clock></zb-clock></zb-x>",
        &children,
    )
    .unwrap_err();
    assert!(
        error
            .message
            .contains("computes the default for `since` in the browser"),
        "{}",
        error.message
    );
    assert_eq!(error.span.line, 2);
    assert!(html(
        "<script>import './clock.zb'</script>\n<zb-x><zb-clock since={5}></zb-clock></zb-x>",
        &children
    )
    .unwrap()
    .contains("<p>5</p>"));
}

#[test]
fn both_outputs_check_how_a_child_is_used() {
    let children = files(&[("./badge.zb", BADGE)]);
    for (usage, expected) in [
        (
            "<zb-badge count={\"three\"}></zb-badge>",
            "prop `count` must be a number",
        ),
        ("<zb-badge lable={\"x\"}></zb-badge>", "has no prop `lable`"),
        ("<zb-badge onlabelchang={go}></zb-badge>", "never fires"),
    ] {
        let source = format!(
            "<script>import './badge.zb'\nfunction go() {{}}</script>\n<zb-x>{usage}</zb-x>"
        );
        let source = if expected == "never fires" {
            source
                .replace("./badge.zb'", "./emitter.zb'")
                .replace("zb-badge", "zb-emitter")
        } else {
            source
        };
        let children = if expected == "never fires" {
            files(&[("./emitter.zb", "<script>import { emit } from '@zubra/runtime'\nemit('labelchange')</script>\n<zb-emitter><p>x</p></zb-emitter>")])
        } else {
            children.clone()
        };
        let in_html = html(&source, &children).unwrap_err();
        let in_js = js(&source, &children, Some(".js")).unwrap_err();
        assert!(
            in_html.message.contains(expected),
            "html: {}",
            in_html.message
        );
        assert_eq!(
            in_js.message, in_html.message,
            "the same error from both outputs"
        );
        assert_eq!(in_js.help, in_html.help);
    }
    let required = "<zb-req name><p>{name}</p></zb-req>";
    let children = files(&[("./req.zb", required)]);
    let source = "<script>import './req.zb'</script>\n<zb-x><zb-req></zb-req></zb-x>";
    assert!(js(source, &children, None)
        .unwrap_err()
        .message
        .contains("requires the prop `name`"));
    // Values only known in the browser aren't checked at build time.
    let source =
        "<script>import './badge.zb'</script>\n<zb-x n={1}><zb-badge count={n}></zb-badge></zb-x>";
    assert!(js(source, &files(&[("./badge.zb", BADGE)]), None).is_ok());
}

#[test]
fn class_and_style_directives_set_a_childs_host_in_both_outputs() {
    let children = files(&[("./badge.zb", BADGE)]);
    let source = "<script>import './badge.zb'\nlet out = true;\nlet off = false;\nlet hue = \"red\";</script>\n<zb-x><zb-badge count={1} class:out={out} class:off={off} style:color={hue}></zb-badge></zb-x>";
    let rendered = html(source, &children).unwrap();
    assert!(rendered.contains("<zb-badge class=\"out\""), "{rendered}");
    assert!(rendered.contains("style=\"color: red\""), "{rendered}");
    assert!(!rendered.contains("off"), "{rendered}");
    let module = js(source, &children, Some(".js")).unwrap();
    assert!(module.contains("toggle: \"out\""), "{module}");
    assert!(module.contains("toggle: \"off\""), "{module}");
    // An unknown prop is still refused beside them.
    let typo = source.replace("count={1}", "cuont={1}");
    assert!(html(&typo, &children)
        .unwrap_err()
        .message
        .contains("has no prop `cuont`"));
    assert!(js(&typo, &children, Some(".js"))
        .unwrap_err()
        .message
        .contains("has no prop `cuont`"));
}

#[test]
fn a_camelcase_prop_written_in_lowercase_on_a_child_warns() {
    let meter = "<zb-meter max-value={5} label=\"x\"><p>{maxValue}</p></zb-meter>";
    let app = "<script>\n  import './meter.zb'\n</script>\n<zb-app>\n  <zb-meter maxvalue=\"8\" label=\"a\"></zb-meter>\n  <zb-meter maxValue={9}></zb-meter>\n  <zb-if test={true}><zb-meter max-value={3}></zb-meter><zb-meter maxvalue={2}></zb-meter></zb-if>\n</zb-app>";
    let loader = |specifier: &str, _from: &str| {
        (specifier == "./meter.zb")
            .then(|| ("meter.zb".to_owned(), meter.to_owned()))
            .ok_or_else(|| "not found".to_owned())
    };
    let warnings = zubra::warnings_with(app, "app.zb", &loader);
    let found: Vec<(usize, &str)> = warnings
        .iter()
        .map(|warning| (warning.span.line, warning.message.as_str()))
        .collect();
    assert_eq!(found.len(), 2, "{found:?}");
    assert_eq!(found[0].0, 5);
    assert_eq!(found[1].0, 7);
    assert!(
        found[0].1.contains("`maxvalue` isn't a prop of <zb-meter>")
            && found[0]
                .1
                .contains("the prop `maxValue` is the attribute `max-value`"),
        "{}",
        found[0].1
    );
    assert_eq!(warnings[0].help.as_deref(), Some("write `max-value`"));
    // Without the imports loaded (no path), it's the same as warnings().
    assert!(zubra::warnings(app).is_empty());
}

#[test]
fn a_sibling_used_without_its_import_and_a_tag_a_slip_from_an_imported_one_warn() {
    let price = "<price-tag cents={0}><b>{cents}</b></price-tag>";
    let name = "<need-name name><p>{name}</p></need-name>";
    let loader = |specifier: &str, _from: &str| match specifier {
        "./price-tag.zb" => Ok(("price-tag.zb".to_owned(), price.to_owned())),
        "./need-name.zb" => Ok(("need-name.zb".to_owned(), name.to_owned())),
        // A file of the tag's name that is some other element's: not this tag's component.
        "./date-chip.zb" => Ok((
            "date-chip.zb".to_owned(),
            "<other-chip><i>x</i></other-chip>".to_owned(),
        )),
        _ => Err("not found".to_owned()),
    };
    let app = "<script>\n  import './need-name.zb'\n</script>\n<menu-row>\n  <price-tag cents={250}></price-tag>\n  <zb-if test={true}><price-tag cents={1}></price-tag></zb-if>\n  <need-nmae name=\"x\"></need-nmae>\n  <need-name name=\"y\"></need-name>\n  <date-chip></date-chip>\n  <sl-button>theirs</sl-button>\n  <menu-row></menu-row>\n  <zb-window onresize={() => {}}></zb-window>\n</menu-row>";
    let warnings = zubra::warnings_with(app, "menu-row.zb", &loader);
    let found: Vec<(usize, &str)> = warnings
        .iter()
        .map(|warning| (warning.span.line, warning.message.as_str()))
        .collect();
    // Once per tag, and nothing for the imported one, another library's, a file that isn't the
    // tag's component, the component's own tag or the template's own elements.
    assert_eq!(found.len(), 2, "{found:?}");
    assert_eq!(found[0].0, 5);
    assert!(
        found[0].1.contains(
            "<price-tag> is the component in `./price-tag.zb`, which this file doesn't import"
        ),
        "{}",
        found[0].1
    );
    assert_eq!(
        warnings[0].help.as_deref(),
        Some("add `import './price-tag.zb'` to the script")
    );
    assert_eq!(found[1].0, 7);
    assert!(
        found[1]
            .1
            .contains("<need-nmae> isn't a component this file imports, and is close to one that is: <need-name>"),
        "{}",
        found[1].1
    );
    assert!(warnings[1]
        .help
        .as_deref()
        .unwrap()
        .starts_with("did you mean `<need-name>`?"));
    // With the import, nothing; and a short tag two edits away is somebody else's element.
    let imported = app.replace(
        "import './need-name.zb'",
        "import './need-name.zb'\n  import './price-tag.zb'",
    );
    let after: Vec<String> = zubra::warnings_with(&imported, "menu-row.zb", &loader)
        .into_iter()
        .map(|warning| warning.message)
        .collect();
    assert_eq!(after.len(), 1, "{after:?}");
    assert!(after[0].contains("<need-nmae>"));
    let short = "<script>\n  import './x-tab.zb'\n</script>\n<x-app><x-tab></x-tab><x-pane></x-pane><y-tabs></y-tabs></x-app>";
    let tab = |specifier: &str, _from: &str| {
        (specifier == "./x-tab.zb")
            .then(|| ("x-tab.zb".to_owned(), "<x-tab><i>t</i></x-tab>".to_owned()))
            .ok_or_else(|| "not found".to_owned())
    };
    assert!(zubra::warnings_with(short, "x-app.zb", &tab).is_empty());
}

#[test]
fn a_parent_needs_the_browser_when_a_child_does() {
    let counter = "<script>\n  let n = 0\n</script>\n<zb-counter><button onclick={() => n++}>{n}</button></zb-counter>";
    let label = "<zb-label text=\"x\"><b>{text}</b></zb-label>";
    let page = |child: &str| {
        format!("<script>\n  import './{child}.zb'\n</script>\n<zb-page><zb-{child}></zb-{child}></zb-page>")
    };
    let loader = |specifier: &str, _from: &str| match specifier {
        "./counter.zb" => Ok(("counter.zb".to_owned(), counter.to_owned())),
        "./label.zb" => Ok(("label.zb".to_owned(), label.to_owned())),
        _ => Err("not found".to_owned()),
    };
    assert_eq!(
        zubra::client_reasons(&page("label"), "page.zb", &loader).unwrap(),
        Vec::<String>::new()
    );
    assert_eq!(
        zubra::client_reasons(&page("counter"), "page.zb", &loader).unwrap(),
        vec![
            "<zb-counter>: state `n`".to_owned(),
            "<zb-counter>: handles `click`".to_owned()
        ]
    );
}
