//! Diagnostic codes are the Stable contract (docs/diagnostics.md): each is unique, documented
//! with the meaning `src/codes.rs` gives it, in its area's range, and every diagnostic has one.

use std::collections::{HashMap, HashSet};
use std::fs;

use zubra::codes::ALL;

/// The first digit of a code, by the section of docs/diagnostics.md it's listed under.
const AREAS: &[(&str, char)] = &[
    ("Parsing", '1'),
    ("The template", '2'),
    ("The script", '3'),
    ("Props and their types", '4'),
    ("Server rendering", '5'),
    ("Output targets", '6'),
    ("Imports", '7'),
    ("Tools", '8'),
    ("Internal errors", '9'),
];

#[test]
fn every_code_is_unique_and_well_formed() {
    let mut codes = HashSet::new();
    let mut names = HashSet::new();
    for (name, code, meaning) in ALL {
        assert!(
            code.len() == 6
                && code.starts_with("ZB")
                && code[2..].bytes().all(|byte| byte.is_ascii_digit())
                && !code[2..].starts_with('0'),
            "{name}: `{code}` isn't ZB followed by four digits"
        );
        assert!(codes.insert(*code), "{code} is given to two names");
        assert!(names.insert(*name), "{name} is registered twice");
        assert!(!meaning.trim().is_empty(), "{code} has no meaning");
    }
}

#[test]
fn every_code_is_documented_with_its_meaning_in_its_area() {
    let docs = fs::read_to_string("docs/diagnostics.md").expect("docs/diagnostics.md");
    let mut documented = HashMap::new();
    let mut area = None;
    for line in docs.lines() {
        if let Some(heading) = line.strip_prefix("## ") {
            area = AREAS
                .iter()
                .find(|(title, _)| heading.starts_with(title))
                .map(|(_, digit)| *digit);
            assert!(
                area.is_some(),
                "docs/diagnostics.md: unknown section `{heading}`"
            );
            continue;
        }
        let Some(row) = line.strip_prefix("| <a id=\"") else {
            continue;
        };
        let (anchor, rest) = row
            .split_once("\"></a>`")
            .expect("an anchor, then the code");
        let (code, rest) = rest.split_once("` | ").expect("the code, then its meaning");
        let meaning = rest.strip_suffix(" |").expect("a table row");
        assert_eq!(anchor, code.to_ascii_lowercase(), "{code}'s anchor");
        assert_eq!(
            code.chars().nth(2),
            area,
            "{code} is listed under another area's section"
        );
        assert!(
            documented
                .insert(code.to_owned(), meaning.to_owned())
                .is_none(),
            "{code} is listed twice in docs/diagnostics.md"
        );
    }
    for (name, code, meaning) in ALL {
        assert_eq!(
            documented.remove(*code).as_deref(),
            Some(*meaning),
            "docs/diagnostics.md's row for {code} ({name}) should say what src/codes.rs says"
        );
    }
    assert!(
        documented.is_empty(),
        "docs/diagnostics.md lists codes src/codes.rs doesn't have: {:?}",
        documented.keys()
    );
}

#[test]
fn reserved_element_prefix_has_a_stable_code() {
    let error = zubra::compile_js(
        "<my-app><zb-iff></zb-iff></my-app>",
        "@zubra/runtime",
        "app.zb",
    )
    .expect_err("an unknown zb- element");
    assert_eq!(error.code, zubra::codes::UNKNOWN_ZB_ELEMENT);
}

/// The compiler's source, without its unit tests.
fn sources() -> Vec<(String, String)> {
    let mut found = Vec::new();
    for entry in fs::read_dir("src").expect("src") {
        let path = entry.expect("an entry").path();
        if path.extension().is_some_and(|extension| extension == "rs") {
            let source = fs::read_to_string(&path).expect("a source file");
            let code = match source.find("#[cfg(test)]\nmod tests") {
                Some(at) => source[..at].to_owned(),
                None => source,
            };
            found.push((path.display().to_string(), code));
        }
    }
    found
}

#[test]
fn every_diagnostic_is_made_with_a_code() {
    // `Diagnostic::new` takes the code first, so the type system already refuses one without; this
    // keeps it that way: each is made with a registered code by name, or passes one on (a helper).
    for (path, source) in sources() {
        for (at, _) in source.match_indices("Diagnostic::new(") {
            let rest = source[at + "Diagnostic::new(".len()..].trim_start();
            assert!(
                rest.starts_with("crate::codes::") || rest.starts_with("code,"),
                "{path}:{}: a Diagnostic made without a code. Every diagnostic needs one: add it to src/codes.rs (in its area's range, never reusing a number) and a row to docs/diagnostics.md, then pass it first: Diagnostic::new(crate::codes::NAME, span, message)",
                source[..at].lines().count()
            );
        }
    }
}

#[test]
fn every_code_is_used() {
    let all: String = sources().into_iter().map(|(_, source)| source).collect();
    for (name, code, _) in ALL {
        assert!(
            all.contains(&format!("codes::{name},")) || all.contains(&format!("codes::{name})")),
            "{code} ({name}) is registered but nothing reports it; keep the number reserved instead of reusing it"
        );
    }
}

#[test]
fn the_rendered_error_and_the_json_carry_the_code() {
    let error = zubra::compile_js("<x-y><p>{titel}</p></x-y>", "@zubra/runtime", "x.zb")
        .expect_err("an unknown reference");
    assert_eq!(error.code.as_str(), "ZB2001");
    assert_eq!(error.code, zubra::codes::UNKNOWN_REFERENCE);
    assert!(error
        .render("<x-y><p>{titel}</p></x-y>", "x.zb")
        .starts_with("error[ZB2001]: unknown reference `titel`"));
    let response: serde_json::Value = serde_json::from_str(&zubra::handle_request(
        r#"{"command":"check","path":"/x.zb","files":{"/x.zb":"<x-y><p>{titel}</p></x-y>"}}"#,
    ))
    .expect("JSON");
    assert_eq!(response["diagnostics"][0]["code"], "ZB2001");
}
