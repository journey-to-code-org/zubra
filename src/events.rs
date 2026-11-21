//! The events a component fires, inferred from its `emit("name", detail)` calls.
//!
//! Nothing is declared by hand: each call adds its event, and the detail's type comes from the
//! shape of the value passed (the union, when calls differ). JSDoc-style `@fires name - text`
//! lines in the component's description document events; when there are any, they must match
//! the events the code fires exactly, so the documentation can't drift. A line can say the
//! detail's type, `@fires {number | "nil"} bid - text`, where the calls' shapes don't.
//!
//! The description's other tag is read here too: `@prop {Type} name - text`, a prop's type
//! and what it is for.

use crate::{
    ast::{ComponentAst, PropDecl, PropDoc, Script},
    diagnostic::{Diagnostic, Span},
    script::{is_event_name, union},
};

/// What follows a tag: `{Type} name - text`, `name {Type} - text` or `name - text`.
struct Tag<'a> {
    declared: Option<&'a str>,
    name: &'a str,
    about: &'a str,
}

/// `{…}` at the start of `text`, braces balanced (a type can hold object types and strings):
/// what's inside, and what follows.
fn braced(text: &str) -> Option<(&str, &str)> {
    let mut depth = 0;
    let mut quote = None;
    let mut escaped = false;
    for (at, character) in text.char_indices() {
        if let Some(open) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == open {
                quote = None;
            }
            continue;
        }
        match character {
            '"' | '\'' | '`' => quote = Some(character),
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some((text[1..at].trim(), &text[at + 1..]));
                }
            }
            _ => {}
        }
    }
    None
}

fn tag<'a>(kind: &str, rest: &'a str, span: Span) -> Result<Tag<'a>, Diagnostic> {
    let unclosed = || {
        Diagnostic::new(
            crate::codes::DOC_TYPE,
            span,
            format!("`@{kind} {}`: the type's `{{` is never closed", rest.trim()),
        )
    };
    let mut rest = rest.trim();
    let mut declared = None;
    if rest.starts_with('{') {
        let (inside, after) = braced(rest).ok_or_else(unclosed)?;
        declared = Some(inside);
        rest = after.trim_start();
    }
    let end = rest
        .find(|character: char| character.is_whitespace() || character == '{')
        .unwrap_or(rest.len());
    let name = &rest[..end];
    rest = rest[end..].trim_start();
    if declared.is_none() && rest.starts_with('{') {
        let (inside, after) = braced(rest).ok_or_else(unclosed)?;
        declared = Some(inside);
        rest = after;
    }
    if let Some(text) = declared {
        if !crate::typescript::is_type(text) {
            return Err(Diagnostic::new(crate::codes::DOC_TYPE,
                span,
                format!("`@{kind} {{{text}}} {name}`: `{text}` isn't a TypeScript type"),
            )
            .with_help("between the braces goes a type as TypeScript writes it: `{string[]}`, `{\"small\" | \"large\"}`, `{{ id: number; label: string }}`"));
        }
    }
    Ok(Tag {
        declared,
        name,
        about: rest.trim().trim_start_matches('-').trim(),
    })
}

/// What follows `@prop` (or JSDoc's other spelling, `@property`) on a description line.
fn prop_line(line: &str) -> Option<&str> {
    let line = line.trim_start();
    let rest = line
        .strip_prefix("@property")
        .or_else(|| line.strip_prefix("@prop"))?;
    rest.starts_with(char::is_whitespace).then_some(rest)
}

/// The description's `@prop {Type} name - text` lines: each names one of the host's props.
pub fn prop_docs(
    description: Option<&str>,
    props: &[PropDecl],
    script: &Script,
    span: Span,
) -> Result<Vec<PropDoc>, Diagnostic> {
    let mut docs: Vec<PropDoc> = Vec::new();
    for line in description.unwrap_or_default().lines() {
        let Some(rest) = prop_line(line) else {
            continue;
        };
        let Tag {
            declared,
            name,
            about,
        } = tag("prop", rest, span)?;
        if !props.iter().any(|prop| prop.name == name) {
            let names: Vec<&str> = props.iter().map(|prop| prop.name.as_str()).collect();
            return Err(crate::validate::with_suggestion(
                Diagnostic::new(crate::codes::DOC_UNKNOWN_PROP,
                    span,
                    format!("the description documents `@prop {name}`, but there's no prop `{name}` on the host tag"),
                ),
                name,
                &names,
            ));
        }
        if docs.iter().any(|doc| doc.name == name) {
            return Err(Diagnostic::new(
                crate::codes::DOC_PROP_TWICE,
                span,
                format!("the description documents `@prop {name}` twice"),
            ));
        }
        if declared.is_some() {
            if let Some((_, _, typed)) = script.prop_types.iter().find(|(prop, _, _)| prop == name)
            {
                return Err(Diagnostic::new(crate::codes::PROP_TYPED_TWICE,
                    *typed,
                    format!("`{name}` is given a type twice: here, and by `@prop {{…}} {name}` in the description"),
                )
                .with_help("keep one: the script's, which the script's own code is checked against, or the description's"));
            }
        }
        docs.push(PropDoc {
            name: name.to_owned(),
            declared: declared.map(str::to_owned),
            description: (!about.is_empty()).then(|| about.to_owned()),
        });
    }
    Ok(docs)
}

#[derive(Clone, Debug, PartialEq)]
pub struct EventInterface {
    pub name: String,
    /// TypeScript type of `event.detail`.
    pub detail: String,
    /// The detail's type is the description's (`@fires {Type} name`), not read off the calls.
    pub declared: bool,
    pub description: Option<String>,
}

/// The component's events, and its description without the `@fires` and `@prop` lines.
pub fn events(
    component: &ComponentAst,
) -> Result<(Vec<EventInterface>, Option<String>), Diagnostic> {
    let mut events: Vec<EventInterface> = Vec::new();
    // A two-way prop fires `<prop>change` when the component assigns it.
    for prop in component.props.iter().filter(|prop| prop.model) {
        events.push(EventInterface {
            name: format!("{}change", prop.name.to_ascii_lowercase()),
            detail: "unknown".to_owned(),
            declared: false,
            description: Some(format!(
                "`{}` changed; `detail` is the new value.",
                prop.name
            )),
        });
    }
    for emit in &component.script.emits {
        match events.iter_mut().find(|event| event.name == emit.name) {
            Some(event) => event.detail = union([event.detail.clone(), emit.detail.clone()]),
            None => events.push(EventInterface {
                name: emit.name.clone(),
                detail: emit.detail.clone(),
                declared: false,
                description: None,
            }),
        }
    }

    let Some(description) = &component.description else {
        return Ok((events, None));
    };
    let mut documented = Vec::new();
    let mut text = Vec::new();
    for line in description.lines() {
        // (`@prop` lines are the props': see `prop_docs`.)
        if prop_line(line).is_some() {
            continue;
        }
        let Some(rest) = line.trim_start().strip_prefix("@fires") else {
            text.push(line);
            continue;
        };
        let Tag {
            declared,
            name,
            about,
        } = tag("fires", rest, component.tag_span)?;
        if !is_event_name(name) {
            return Err(Diagnostic::new(crate::codes::EVENT_NAME,
                component.tag_span,
                format!("`@fires {name}`: event names are lowercase letters and digits"),
            )
            .with_help("lowercase names are what HTML `on…` attributes and every framework's template syntax can listen for"));
        }
        let Some(event) = events.iter_mut().find(|event| event.name == name) else {
            let error = Diagnostic::new(crate::codes::DOC_EVENT_NEVER_EMITTED,
                component.tag_span,
                format!("the description documents `@fires {name}`, but the script never emits `{name}`"),
            );
            let names: Vec<&str> = events.iter().map(|event| event.name.as_str()).collect();
            return Err(crate::validate::with_suggestion(error, name, &names));
        };
        documented.push(name.to_owned());
        if !about.is_empty() {
            event.description = Some(about.to_owned());
        }
        // `{Type}`: what `detail` is, said rather than read off the calls.
        if let Some(declared) = declared {
            event.detail = declared.to_owned();
            event.declared = true;
        }
    }
    if !documented.is_empty() {
        if let Some(missing) = events
            .iter()
            .find(|event| !documented.contains(&event.name))
        {
            let span = component
                .script
                .emits
                .iter()
                .find(|emit| emit.name == missing.name)
                .map_or(component.tag_span, |emit| emit.span);
            return Err(Diagnostic::new(
                crate::codes::EVENT_UNDOCUMENTED,
                span,
                format!(
                    "`{}` is emitted but not documented; add `@fires {} - …` to the description",
                    missing.name, missing.name
                ),
            ));
        }
    }
    let description = text.join("\n").trim().to_owned();
    Ok((events, (!description.is_empty()).then_some(description)))
}
