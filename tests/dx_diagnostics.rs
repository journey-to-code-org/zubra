//! Diagnostics that say what to write instead (the pre-6.0 audit's DX findings).
use zubra::{compile, Diagnostic, Span};

fn error(source: &str) -> Diagnostic {
    compile(source, "{}").expect_err("expected a compile error")
}

#[test]
fn an_unknown_zb_element_is_an_error_with_the_nearest_directive() {
    let diagnostic = error("<my-x>\n  <zb-iff when={true}><p>hi</p></zb-iff>\n</my-x>");
    assert!(diagnostic.message.contains("unknown element <zb-iff>"), "{}", diagnostic.message);
    assert!(diagnostic.message.contains("reserved"), "{}", diagnostic.message);
    assert_eq!(diagnostic.span, Span::new(2, 3));
    assert_eq!(diagnostic.help.as_deref(), Some("did you mean `<zb-if>`?"));
    let far = error("<my-x><zb-card></zb-card></my-x>");
    assert!(far.message.contains("unknown element <zb-card>"), "{}", far.message);
    assert_eq!(far.help.as_deref(), Some("a component of your own needs another prefix: `<app-card>`"));
}

#[test]
fn the_runtime_s_zb_elements_and_every_directive_still_compile() {
    for source in [
        "<my-x><zb-outlet></zb-outlet></my-x>",
        "<my-x><zb-context></zb-context></my-x>",
        "<my-x><zb-switch value={1}><zb-case is={1}>one</zb-case><zb-else>other</zb-else></zb-switch></my-x>",
        "<my-x><zb-await value={Promise.resolve(1)}><zb-pending>…</zb-pending><zb-then as=\"v\">{v}</zb-then><zb-catch>no</zb-catch></zb-await></my-x>",
        "<my-x><zb-window onkeydown={() => {}}></zb-window><zb-document onclick={() => {}}></zb-document></my-x>",
        "<my-x><zb-if test={true}>a<zb-else-if test={false}>b</zb-else-if><zb-else>c</zb-else></zb-if><zb-each items={[1]} as=\"n\">{n}</zb-each><zb-slot></zb-slot></my-x>",
    ] {
        compile(source, "{}").unwrap_or_else(|error| panic!("{source}: {error}"));
    }
}

#[test]
fn an_at_event_attribute_says_to_write_the_on_attribute() {
    let diagnostic = error("<my-x><button @click={() => {}}>Go</button></my-x>");
    assert_eq!(diagnostic.message, "expected an HTML tag or attribute name");
    assert_eq!(
        diagnostic.help.as_deref(),
        Some("Zubra uses the platform's attribute names: write `onclick={…}`")
    );
    let modified = error("<my-x><form @submit.prevent={() => {}}></form></my-x>");
    assert_eq!(
        modified.help.as_deref(),
        Some("Zubra uses the platform's attribute names: write `onsubmit.prevent={…}`")
    );
}

#[test]
fn an_unclosed_element_is_reported_where_it_opened() {
    let diagnostic = error("<my-x>\n  <section>\n    <div>\n      <p>hi</p>\n  </section>\n</my-x>");
    assert_eq!(diagnostic.message, "<div> is never closed");
    assert_eq!(diagnostic.span, Span::new(3, 5));
    let help = diagnostic.help.unwrap();
    assert!(help.contains("</section> at 5:3"), "{help}");
    // At the host's closing tag, too.
    let at_host = error("<my-x>\n  <div>\n</my-x>");
    assert_eq!(at_host.message, "<div> is never closed");
    assert_eq!(at_host.span, Span::new(2, 3));
    // And at the end of the file.
    let at_end = error("<my-x>\n  <div>");
    assert_eq!(at_end.message, "<div> is never closed");
    assert_eq!(at_end.span, Span::new(2, 3));
    // A closing tag that matches nothing open is still a mismatch, where it is.
    let stray = error("<my-x>\n  <p></section>\n</my-x>");
    assert!(stray.message.contains("does not match"), "{}", stray.message);
    assert_eq!(stray.span, Span::new(2, 6));
}

#[test]
fn a_pascal_case_tag_warns_with_the_custom_element_name() {
    let warnings = zubra::warnings("<my-app>\n  <div><TodoList /></div>\n</my-app>");
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(warnings[0].message.contains("custom element names are lowercase with a hyphen"), "{}", warnings[0].message);
    assert_eq!(warnings[0].span, Span::new(2, 8));
    assert_eq!(
        warnings[0].help.as_deref(),
        Some("did you mean `<todo-list>` (import './todo-list.zb')?")
    );
    // It still compiles (it's an element nothing defines), and lowercase or SVG names are fine.
    assert!(compile("<my-app><TodoList /></my-app>", "{}").is_ok());
    assert!(zubra::warnings("<my-app><svg><linearGradient></linearGradient></svg><todo-list></todo-list></my-app>").is_empty());
    // Not in a JSX component, where a capitalized tag is a function component.
    let jsx = "import TodoList from './todo-list.zb'\n\nexport default function MyApp() {\n  return <div><TodoList /></div>;\n}\n";
    assert!(zubra::warnings(jsx).iter().all(|warning| !warning.message.contains("lowercase with a hyphen")));
}
