//! 2.8: what servers need from the compiler (the interface emit) and `host-reset`.

#[test]
fn host_reset_starts_the_host_from_nothing_and_makes_its_rules_win() {
    let css = zubra::compile_css(
        "<style>\n  :host { display: block; color: red !important }\n  :host(.on) { color: blue; }\n  p { color: green; }\n</style>\n<x-w shadow host-reset><p>x</p></x-w>\n",
    )
    .unwrap();
    assert!(css.contains(":host { all: initial !important; }"), "{css}");
    assert!(
        css.contains(":host { display: block !important; color: red !important }"),
        "{css}"
    );
    assert!(
        css.contains(":host(.on) { color: blue !important; }"),
        "{css}"
    );
    assert!(
        css.contains("p { color: green; }"),
        "only the host's rules: {css}"
    );
    // Without a <style>, just the reset.
    let css = zubra::compile_css("<x-w shadow host-reset><p>x</p></x-w>").unwrap();
    assert!(css.contains(":host { all: initial !important; }"), "{css}");
    let error = zubra::compile_css("<x-w host-reset><p>x</p></x-w>").unwrap_err();
    assert!(
        error.message.contains("add `shadow` too"),
        "{}",
        error.message
    );
}

#[test]
fn the_interface_says_what_a_server_needs_to_read_a_host_back() {
    let json: serde_json::Value = serde_json::from_str(
        &zubra::compile_interface("<x-s shadow form-associated value:model={1} label=\"n\" items={[]}><p>{value}</p></x-s>").unwrap(),
    )
    .unwrap();
    assert_eq!(json["tag"], "x-s");
    assert_eq!(json["shadow"], true);
    assert_eq!(json["form"], true);
    assert_eq!(
        json["props"][0],
        serde_json::json!({ "name": "value", "attribute": "value", "type": "number", "default": 1, "model": true, "required": false })
    );
    assert_eq!(json["props"][2]["default"], serde_json::json!([]));
    assert_eq!(json["events"], serde_json::json!(["valuechange"]));
}

#[test]
fn a_pending_prop_renders_as_an_empty_region_for_a_stream_to_fill() {
    let source = "<x-reviews reviews={[]}><h2>R</h2><zb-await value={reviews}><p>…</p><zb-then as=\"l\"><ul><zb-each items={l} as=\"r\" key={r}><li>{r}</li></zb-each></ul></zb-then></zb-await></x-reviews>";
    let options = |pending: Vec<String>| zubra::HtmlOptions {
        slot_source: zubra::SlotSource::Html,
        partial: false,
        pending,
    };
    let shell = zubra::compile_html_with_options(
        source,
        "x.zb",
        "{}",
        "{}",
        options(vec!["reviews".into()]),
        &zubra::filesystem,
    )
    .unwrap();
    assert!(shell.contains("<?zb [??><p>…</p><?zb ]?>"), "{shell}");
    assert!(
        !shell.contains("reviews=\""),
        "no attribute for a value not known yet: {shell}"
    );
    let resolved = zubra::compile_html_with_options(
        source,
        "x.zb",
        "{\"reviews\":[\"a\"]}",
        "{}",
        options(vec![]),
        &zubra::filesystem,
    )
    .unwrap();
    assert!(
        resolved.contains("<?zb [?><ul><?zb [?><?zb [?><li>a</li><?zb ]?><?zb ]?></ul><?zb ]?>"),
        "{resolved}"
    );
    // A pending prop with a value given keeps it unknown (the stream renders again once it has it).
    let still = zubra::compile_html_with_options(
        source,
        "x.zb",
        "{\"reviews\":[\"a\"]}",
        "{}",
        options(vec!["reviews".into()]),
        &zubra::filesystem,
    )
    .unwrap();
    assert_eq!(still, shell);
}

/// A list's rows are read where the list is, when the list outlives the render (a prop, a script
/// value, a field of a row lent the same way), and copied otherwise. Every way a row can reach
/// its template gives the same HTML.
#[test]
fn a_list_lends_its_rows_or_copies_them_to_the_same_html() {
    let source = r#"<script>
  const shown = rows;
  const firstTwo = rows.slice(0, 2);
</script>
<lent-rows rows={[]} columns={[]}>
  <ul class="prop"><zb-each items={rows} as="row" index="at"><li>{at}:{row.name}<zb-each items={row.tags} as="tag">[{tag}]</zb-each><zb-each items={columns} as="column">({row[column]})</zb-each></li></zb-each></ul>
  <ul class="script"><zb-each items={shown} as="row"><li>{row.name}</li></zb-each></ul>
  <ul class="computed"><zb-each items={firstTwo} as="row"><li>{row.name}<zb-each items={row.tags} as="tag">[{tag}]</zb-each></li></zb-each></ul>
  <ul class="made"><zb-each items={rows.filter((row) => row.tags.length)} as="row"><li>{row.name}<zb-each items={row.tags} as="tag">[{tag}]</zb-each></li></zb-each></ul>
  <ul class="pattern"><zb-each items={rows} as="{ name, tags }"><li>{name}<zb-each items={tags} as="tag">[{tag}]</zb-each></li></zb-each></ul>
  <ul class="let"><zb-each items={rows} as="row" let:tags={row.tags}><li><zb-each items={tags} as="tag">[{tag}]</zb-each></li></zb-each></ul>
  <ul class="shadow"><zb-each items={rows} as="row"><zb-each items={row.tags} as="row"><li>{row}</li></zb-each></zb-each></ul>
  <ul class="hides"><zb-each items={rows.map((row) => row.tags)} as="columns"><li><zb-each items={columns} as="tag">[{tag}]</zb-each></li></zb-each></ul>
  <ul class="item"><zb-each items={rows[1].tags} as="tag"><li>{tag}</li></zb-each></ul>
</lent-rows>"#;
    let props = r#"{"columns":["name","size"],"rows":[{"name":"ash","size":1,"tags":["a","b"]},{"name":"elm","size":2,"tags":[]},{"name":"oak","size":3,"tags":["c"]}]}"#;
    let html = zubra::compile(source, props).unwrap();
    let text: String = {
        // The markers and whitespace aside: what a reader sees.
        let mut out = String::new();
        let mut rest = html.as_str();
        while let Some(start) = rest.find("<?zb") {
            out.push_str(&rest[..start]);
            rest = &rest[start + rest[start..].find("?>").unwrap() + 2..];
        }
        out.push_str(rest);
        out
    };
    for expected in [
        r#"<ul class="prop"><li>0:ash[a][b](ash)(1)</li><li>1:elm(elm)(2)</li><li>2:oak[c](oak)(3)</li></ul>"#,
        r#"<ul class="script"><li>ash</li><li>elm</li><li>oak</li></ul>"#,
        r#"<ul class="computed"><li>ash[a][b]</li><li>elm</li></ul>"#,
        r#"<ul class="made"><li>ash[a][b]</li><li>oak[c]</li></ul>"#,
        r#"<ul class="pattern"><li>ash[a][b]</li><li>elm</li><li>oak[c]</li></ul>"#,
        r#"<ul class="let"><li>[a][b]</li><li></li><li>[c]</li></ul>"#,
        r#"<ul class="shadow"><li>a</li><li>b</li><li>c</li></ul>"#,
        // A row that owns its value hides the prop of the same name.
        r#"<ul class="hides"><li>[a][b]</li><li></li><li>[c]</li></ul>"#,
        r#"<ul class="item"></ul>"#,
    ] {
        assert!(text.contains(expected), "missing {expected}\nin {text}");
    }
    // Not an array, lent or not: the same error.
    let error = zubra::compile(
        r#"<not-list rows={null}><zb-each items={rows} as="row"><i>{row}</i></zb-each></not-list>"#,
        r#"{"rows":{"a":1}}"#,
    )
    .expect_err("an object is not a list");
    assert!(
        error
            .message
            .contains("zb-each items must be an array, found an object"),
        "{}",
        error.message
    );
}
