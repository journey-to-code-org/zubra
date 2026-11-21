//! Events inferred from `emit("name", detail)` in a component's script.

use std::collections::HashMap;

use zubra::{
    compile_declarations, compile_html_data, compile_html_with, compile_js, compile_manifest,
    Diagnostic,
};

fn with_script(script: &str) -> String {
    format!("<script>\n  import {{ emit }} from '@zubra/runtime'\n{script}\n</script>\n<my-picker value=\"\">\n  <p>{{value}}</p>\n</my-picker>")
}

fn js(source: &str) -> Result<String, Diagnostic> {
    compile_js(source, "@zubra/runtime", "picker.zb")
}

#[test]
fn every_emit_call_declares_an_event_and_binds_emit_per_element() {
    let output = js(&with_script(
        "  function pick(v) { emit('valuechange', v) }\n  function open() { emit(`open`); emit('valuechange', 1) }",
    ))
    .unwrap();
    assert!(
        output.contains("events: [\"valuechange\", \"open\"],"),
        "{output}"
    );
    assert!(
        output.contains("setup($p, $emit) {\n    const emit = $emit;\n"),
        "{output}"
    );
}

#[test]
fn an_aliased_import_is_bound_under_its_alias() {
    let source = "<script>\n  import { emit as fire } from '@zubra/runtime'\n  const go = () => fire('go')\n</script>\n<my-x><p>x</p></my-x>";
    let output = js(source).unwrap();
    assert!(output.contains("const fire = $emit;"), "{output}");
    assert!(output.contains("events: [\"go\"]"), "{output}");
}

#[test]
fn emit_from_another_module_is_not_the_runtimes() {
    let source = "<script>\n  import { emit } from './bus.js'\n  emit('ready')\n</script>\n<my-x><p>x</p></my-x>";
    let output = js(source).unwrap();
    assert!(output.contains("events: [],"), "{output}");
    assert!(!output.contains("$emit;"), "{output}");
}

#[test]
fn detail_types_come_from_the_values_passed() {
    let source = with_script(
        "  emit('a', 'text')\n  emit('b', 1 + 2)\n  emit('c', { id: 1, tags: ['x'], ok: !0, label: `l` })\n  emit('d', 1 > 2 ? 'yes' : 0)\n  emit('d', true)\n  emit('e', thing)\n  emit('e', 'x')\n  emit('f')\n  emit('g', [1, 'a'])",
    );
    let declarations = compile_declarations(&source, "picker.zb").unwrap();
    for expected in [
        "  a: CustomEvent<string>;",
        "  b: CustomEvent<number>;",
        "  c: CustomEvent<{ id: number; tags: string[]; ok: boolean; label: string }>;",
        "  d: CustomEvent<string | number | boolean>;",
        "  e: CustomEvent<unknown>;",
        "  f: CustomEvent<null>;",
        "  g: CustomEvent<(number | string)[]>;",
    ] {
        assert!(
            declarations.contains(expected),
            "missing {expected:?} in\n{declarations}"
        );
    }
    assert!(
        declarations.contains("export interface MyPickerEventMap extends HTMLElementEventMap {")
    );
    assert!(declarations.contains(
        "  addEventListener<K extends keyof MyPickerEventMap>(type: K, listener: (this: MyPicker, event: MyPickerEventMap[K]) => unknown, options?: boolean | AddEventListenerOptions): void;"
    ));
    assert!(declarations.contains("  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;"));
}

#[test]
fn a_component_without_events_declares_no_event_map() {
    let declarations = compile_declarations("<my-x><p>x</p></my-x>", "x.zb").unwrap();
    assert!(!declarations.contains("EventMap"), "{declarations}");
    assert!(!declarations.contains("addEventListener"), "{declarations}");
}

#[test]
fn event_names_follow_the_platform_convention() {
    let error = js(&with_script("  emit('valueChange', 1)")).unwrap_err();
    assert!(error.message.contains("lowercase"), "{}", error.message);
    // The help names the fix, and says whose rule it is: what every framework's template
    // syntax (and HTML's `on…` attributes) can listen for.
    let help = error.help.as_deref().unwrap_or_default();
    assert!(help.starts_with("use `valuechange`: "), "{help}");
    assert!(
        help.contains("`onvaluechange`") && help.contains("Vue") && help.contains("Angular"),
        "{help}"
    );
    assert_eq!(error.span.line, 3);
    let help = js(&with_script("  emit('item-select')"))
        .unwrap_err()
        .help
        .unwrap_or_default();
    assert!(help.starts_with("use `itemselect`: "), "{help}");
    // No fix to offer, but still the reason.
    let help = js(&with_script("  emit('1x')"))
        .unwrap_err()
        .help
        .unwrap_or_default();
    assert!(help.contains("template syntax"), "{help}");
}

#[test]
fn the_compiler_must_see_every_event() {
    let error = js(&with_script("  const name = 'x'\n  emit(name)")).unwrap_err();
    assert!(
        error.message.contains("string literal"),
        "{}",
        error.message
    );
    assert_eq!(error.span.line, 4);
    let error = js(&with_script("  const fire = emit")).unwrap_err();
    assert!(error.message.contains("directly"), "{}", error.message);
    assert!(js(&with_script("  emit(`a${1}`)"))
        .unwrap_err()
        .message
        .contains("string literal"));
    assert!(js(&with_script("  emit('a', 1, 2)"))
        .unwrap_err()
        .message
        .contains("one detail"));
}

const DOCUMENTED: &str = "<!--\n  A picker.\n  @fires valuechange - The value changed.\n-->\n<script>\n  import { emit } from '@zubra/runtime'\n  const pick = (v) => emit('valuechange', v)\n</script>\n<my-picker><p>x</p></my-picker>";

#[test]
fn fires_tags_describe_events_in_the_manifest() {
    let manifest: serde_json::Value =
        serde_json::from_str(&compile_manifest(DOCUMENTED, "picker.js").unwrap()).unwrap();
    let declaration = &manifest["modules"][0]["declarations"][0];
    assert_eq!(declaration["description"], "A picker.");
    assert_eq!(
        declaration["events"],
        serde_json::json!([{ "name": "valuechange", "type": { "text": "CustomEvent<unknown>" }, "description": "The value changed." }])
    );
    let declarations = compile_declarations(DOCUMENTED, "picker.zb").unwrap();
    assert!(
        declarations.contains("/**\n * A picker.\n */\n"),
        "{declarations}"
    );
    assert!(
        declarations.contains("  /** The value changed. */\n  valuechange: CustomEvent<unknown>;"),
        "{declarations}"
    );
}

#[test]
fn fires_tags_must_match_the_events_the_code_fires() {
    let typo = DOCUMENTED.replace("@fires valuechange", "@fires valuchange");
    let error = js(&typo).unwrap_err();
    assert!(
        error.message.contains("never emits `valuchange`"),
        "{}",
        error.message
    );
    assert_eq!(error.help.as_deref(), Some("did you mean `valuechange`?"));

    let undocumented = DOCUMENTED.replace(
        "emit('valuechange', v)",
        "emit('valuechange', v); emit('open')",
    );
    let error = js(&undocumented).unwrap_err();
    assert!(
        error
            .message
            .contains("`open` is emitted but not documented"),
        "{}",
        error.message
    );
    assert_eq!(error.span.line, 7, "at the emit call");

    // An `@fires` name follows the same rule as an emitted one, with the same reason.
    let cased = DOCUMENTED.replace("@fires valuechange", "@fires valueChange");
    let error = js(&cased).unwrap_err();
    assert!(error.message.contains("lowercase"), "{}", error.message);
    assert!(
        error
            .help
            .as_deref()
            .unwrap_or_default()
            .contains("template syntax"),
        "{:?}",
        error.help
    );

    // Without any @fires, nothing needs documenting.
    let plain = "<!-- Described, but no @fires. -->\n<script>\n  import { emit } from '@zubra/runtime'\n  emit('open')\n</script>\n<my-x><p>x</p></my-x>";
    assert!(js(plain).is_ok());
}

#[test]
fn a_listener_for_a_near_miss_of_a_childs_event_is_a_typo() {
    let child = "<script>\n  import { emit } from '@zubra/runtime'\n  emit('valuechange', 1)\n  emit('changes')\n</script>\n<my-picker><p>x</p></my-picker>";
    let files: HashMap<&str, &str> = HashMap::from([("./picker.zb", child)]);
    let loader = |specifier: &str, _: &str| {
        files
            .get(specifier)
            .map(|source| ("picker.zb".to_owned(), (*source).to_owned()))
            .ok_or_else(|| "not found".to_owned())
    };
    let parent = |listener: &str| {
        format!("<script>\n  import './picker.zb'\n  function on() {{}}\n</script>\n<my-form><my-picker {listener}={{on}}></my-picker></my-form>")
    };
    let compile = |source: &str| compile_html_with(source, "form.zb", "{}", "{}", &loader);
    let error = compile(&parent("onvaluchange")).unwrap_err();
    assert!(
        error
            .message
            .contains("<my-picker> never fires `valuchange`"),
        "{}",
        error.message
    );
    assert_eq!(error.help.as_deref(), Some("did you mean `valuechange`?"));
    assert_eq!(error.span.line, 5);
    for fine in ["onvaluechange", "onchange", "onclick", "onsomethingelse"] {
        assert!(compile(&parent(fine)).is_ok(), "{fine}");
    }
}

#[test]
fn framework_declarations_type_the_wrappers() {
    use zubra::{compile_declarations_for, Framework};
    let source = "<script>\n  import { emit } from '@zubra/runtime'\n  emit('beforevaluechange', 1)\n  emit('valuechange', 1)\n  emit('open')\n</script>\n<my-picker value={0} label=\"\"><p>x</p></my-picker>";
    let react = compile_declarations_for(source, "picker.zb", Framework::React).unwrap();
    assert!(react.starts_with("// Generated by zubra from picker.zb. Do not edit.\n\nimport type * as React from \"react\";"), "{react}");
    for expected in [
        "  onBeforeValueChange?: (event: MyPickerEventMap[\"beforevaluechange\"]) => void;",
        "  onValueChange?: (event: MyPickerEventMap[\"valuechange\"]) => void;",
        "  onOpen?: (event: MyPickerEventMap[\"open\"]) => void;",
        "export interface MyPickerReactProps extends Omit<React.HTMLAttributes<MyPicker>, \"value\" | \"label\" | \"onBeforeValueChange\" | \"onValueChange\" | \"onOpen\"> {",
        "export default MyPickerReact;",
    ] {
        assert!(react.contains(expected), "missing {expected:?} in\n{react}");
    }
    let vue = compile_declarations_for(source, "picker.zb", Framework::Vue).unwrap();
    assert!(
        vue.contains("DefineComponent<{ value?: number; label?: string; modelValue?: number }"),
        "{vue}"
    );
    assert!(vue.contains("\"update:value\": (value: number) => true; \"update:modelValue\": (value: number) => true }>;"), "{vue}");
    let plain = compile_declarations_for(source, "picker.zb", Framework::None).unwrap();
    assert!(plain.contains("export default MyPicker;\n"), "{plain}");
}

// ---- types said in the description: `@prop {Type} name` and `@fires {Type} name` (#270)

const CARD: &str = r#"<!--
  One playing card.
  @prop {{ kind: "pip"; suit: "spades" | "hearts"; rank: number } | { kind: "joker"; size: "big" | "little" }} card - The card to draw.
  @prop playable - Whether a tap picks it.
  @fires pick - A playable card was tapped.
  @fires {number | "nil" | "blind-nil"} bid - A bid was chosen.
-->
<script>
  import { emit } from '@zubra/runtime'
</script>
<playing-card card={{ kind: "pip", suit: "spades", rank: 14 }} playable={false}>
  <button onclick={() => emit('pick')}>{card.kind}</button>
  <button onclick={() => emit('bid', 3)}>3</button>
  <button onclick={() => emit('bid', 'nil')}>nil</button>
</playing-card>"#;
const CARD_TYPE: &str = r#"{ kind: "pip"; suit: "spades" | "hearts"; rank: number } | { kind: "joker"; size: "big" | "little" }"#;

#[test]
fn a_prop_tag_gives_a_prop_its_type_and_its_description() {
    // The default alone says `{ kind: string; suit: string; rank: number }`: one shape of three,
    // its literals widened.
    let declarations = compile_declarations(CARD, "playing-card.zb").unwrap();
    assert!(
        declarations.contains(&format!("  /** The card to draw. Attribute `card`. Default: `{{\"kind\":\"pip\",\"suit\":\"spades\",\"rank\":14}}`. */\n  card: {CARD_TYPE};\n")),
        "{declarations}"
    );
    assert!(
        declarations.contains(&format!(
            "export interface PlayingCardProps {{\n  card?: {CARD_TYPE};\n"
        )),
        "the props interface too: {declarations}"
    );
    // A tag with no type documents the prop, whose type stays the default's.
    assert!(
        declarations.contains("  /** Whether a tap picks it. Attribute `playable`. Default: `false`. */\n  playable: boolean;\n"),
        "{declarations}"
    );
    assert!(
        declarations.contains("/**\n * One playing card.\n */\n"),
        "the tags' lines are theirs, not the component's description: {declarations}"
    );

    let manifest: serde_json::Value =
        serde_json::from_str(&compile_manifest(CARD, "playing-card.js").unwrap()).unwrap();
    let declaration = &manifest["modules"][0]["declarations"][0];
    assert_eq!(declaration["description"], "One playing card.");
    assert_eq!(declaration["members"][0]["type"]["text"], CARD_TYPE);
    assert_eq!(
        declaration["members"][0]["description"],
        "The card to draw."
    );
    assert_eq!(
        declaration["attributes"][0]["description"],
        "The card to draw. JSON"
    );
    assert_eq!(
        declaration["attributes"][1]["description"],
        "Whether a tap picks it."
    );
    let data = compile_html_data(CARD).unwrap();
    assert!(
        data.contains("Whether a tap picks it. Type: `boolean`. Default: `false`."),
        "{data}"
    );
}

#[test]
fn a_fires_tag_can_say_what_the_detail_is() {
    // `emit('bid', 3)` and `emit('bid', 'nil')` read as `number | string`; a variable as `unknown`.
    let declarations = compile_declarations(CARD, "playing-card.zb").unwrap();
    assert!(
        declarations.contains(
            "  /** A bid was chosen. */\n  bid: CustomEvent<number | \"nil\" | \"blind-nil\">;"
        ),
        "{declarations}"
    );
    assert!(
        declarations.contains("  pick: CustomEvent<null>;"),
        "one without a type is still read off its calls: {declarations}"
    );
    // The type may follow the name, where `@fires name - text` already had it.
    let after = CARD.replace(
        "@fires {number | \"nil\" | \"blind-nil\"} bid -",
        "@fires bid {number | \"nil\" | \"blind-nil\"} -",
    );
    assert_eq!(
        compile_declarations(&after, "playing-card.zb").unwrap(),
        declarations
    );
    let manifest: serde_json::Value =
        serde_json::from_str(&compile_manifest(CARD, "playing-card.js").unwrap()).unwrap();
    assert_eq!(
        manifest["modules"][0]["declarations"][0]["events"][1],
        serde_json::json!({ "name": "bid", "type": { "text": "CustomEvent<number | \"nil\" | \"blind-nil\">" }, "description": "A bid was chosen." })
    );
    // A two-way prop's event carries the prop's type, unless its tag says otherwise.
    let model = "<!--\n  @fires {string | null} valuechange - Changed.\n-->\n<my-field value:model=\"\">\n  <input value={value} oninput={(event) => (value = event.target.value)}>\n</my-field>";
    let declarations = compile_declarations(model, "field.zb").unwrap();
    assert!(
        declarations.contains("  valuechange: CustomEvent<string | null>;"),
        "{declarations}"
    );
    let untyped = model.replace("{string | null} ", "");
    let declarations = compile_declarations(&untyped, "field.zb").unwrap();
    assert!(
        declarations.contains("  valuechange: CustomEvent<string>;"),
        "{declarations}"
    );
}

#[test]
fn a_tags_type_may_name_the_scripts_own_types() {
    // A TypeScript script's types go into the typings, so a tag can use their names.
    let source = "<!--\n  @prop {Card} card - The card.\n  @fires {Bid} bid\n-->\n<script lang=\"ts\">\n  import { emit } from '@zubra/runtime'\n  export type Card = { kind: 'pip'; rank: number } | { kind: 'joker' }\n  type Bid = number | 'nil'\n</script>\n<playing-card card={{ kind: \"pip\", rank: 14 }}>\n  <button onclick={() => emit('bid', 3)}>{card.kind}</button>\n</playing-card>";
    let declarations = compile_declarations(source, "playing-card.zb").unwrap();
    assert!(
        declarations.contains("export type Card = "),
        "{declarations}"
    );
    assert!(declarations.contains("  card: Card;\n"), "{declarations}");
    assert!(
        declarations.contains("  bid: CustomEvent<Bid>;"),
        "{declarations}"
    );
    // JSDoc's other spelling of the tag.
    let long = source.replace("@prop {Card}", "@property {Card}");
    assert_eq!(
        compile_declarations(&long, "playing-card.zb").unwrap(),
        declarations
    );
}

#[test]
fn a_tag_that_cannot_be_right_is_an_error() {
    let message = |source: &str| {
        let error = js(source).unwrap_err();
        (error.message, error.help)
    };
    // A prop that isn't there.
    let (text, help) = message(&CARD.replace("} card -", "} crad -"));
    assert!(
        text.contains("documents `@prop crad`, but there's no prop `crad`"),
        "{text}"
    );
    assert_eq!(help.as_deref(), Some("did you mean `card`?"));
    // The same prop twice.
    let (text, _) = message(&CARD.replace("@prop playable", "@prop card"));
    assert!(text.contains("`@prop card` twice"), "{text}");
    // Not a type, or more than one.
    for wrong in ["{number |}", "{number); (string}", "{}"] {
        let (text, help) = message(&CARD.replace("{number | \"nil\" | \"blind-nil\"}", wrong));
        assert!(text.contains("isn't a TypeScript type"), "{wrong}: {text}");
        assert!(help.unwrap_or_default().contains("{string[]}"));
    }
    // A brace left open.
    let (text, _) = message(&CARD.replace("\"blind-nil\"} bid", "\"blind-nil\" bid"));
    assert!(text.contains("is never closed"), "{text}");
    // Typed in the script as well: one of them is wrong, sooner or later.
    let twice = "<!--\n  @prop {number} size\n-->\n<script lang=\"ts\">\n  declare const size: number | null\n</script>\n<my-x size={1}><p>{size}</p></my-x>";
    let error = js(twice).unwrap_err();
    assert!(
        error.message.contains("`size` is given a type twice"),
        "{}",
        error.message
    );
    assert_eq!(error.span.line, 5, "at the script's declaration");
    // A brace inside a string in the type doesn't end it.
    let odd = CARD.replace("\"blind-nil\"}", "\"}\"}");
    let declarations = compile_declarations(&odd, "playing-card.zb").unwrap();
    assert!(
        declarations.contains("  bid: CustomEvent<number | \"nil\" | \"}\">;"),
        "{declarations}"
    );
}
