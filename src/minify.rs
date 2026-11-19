//! `command: "minify"`: a browser module as small as it can be served, for `@zubra/server` in
//! production. The module the compiler writes keeps its comments, its indentation and the names a
//! component's author chose, so a person can read it; served as it is, that is about a sixth of a
//! component's bytes, compressed, on every page. oxc's mangler and code generator take them out.
//!
//! A component's CSS is a string in the module (`styles: "…"`), which a JavaScript minifier leaves
//! alone, so this also takes the whitespace and comments out of that one string: the `styles`
//! property of the definition `export default $define(tag, { … })` passes, and nothing else, since
//! a string an author wrote is theirs. See `minify_css` for what that changes and what it doesn't.
//!
//! The server asks for this last, after its own changes to the module (where each runtime name is
//! imported from, `@zubra/sync`'s check), which read the module as the compiler writes it.

use oxc_allocator::Allocator;
use oxc_ast::ast::{Argument, CallExpression, Expression, ObjectExpression, ObjectPropertyKind};
use oxc_ast_visit::{walk_mut, VisitMut};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_mangler::Mangler;
use oxc_parser::Parser;
use oxc_span::SourceType;
use oxc_str::JSStr;

/// `code` (an ES module) minified, or why it can't be (it doesn't parse).
pub fn minify(code: &str) -> Result<String, String> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, code, SourceType::mjs()).parse();
    if let Some(error) = parsed.diagnostics.first() {
        return Err(format!("the module can't be minified: {}", error.message));
    }
    let mut program = parsed.program;
    oxc_ast_visit::VisitMut::visit_program(
        &mut Styles {
            allocator: &allocator,
        },
        &mut program,
    );
    // Names shortened (oxc's mangler), then printed without whitespace (its code generator). Not
    // oxc's whole minifier: that one depends on browserslist, which needs JavaScript's `Date` on
    // WebAssembly (`js-sys`), and the compiler's WebAssembly build imports nothing.
    let mangled = Mangler::new().build(&program);
    Ok(Codegen::new()
        .with_options(CodegenOptions::minify())
        .with_scoping(Some(mangled.scoping))
        .with_private_member_mappings(Some(mangled.class_private_mappings))
        .build(&program)
        .code)
}

/// Finds each component definition, `$define(tag, { abi, template, styles, … })` (in a module
/// alone, or several in a joined one), and minifies the CSS of its `styles`.
struct Styles<'a> {
    allocator: &'a Allocator,
}

/// The value of an object's own non-computed property `name`.
fn property<'o, 'a>(
    object: &'o mut ObjectExpression<'a>,
    name: &str,
) -> Option<&'o mut Expression<'a>> {
    object
        .properties
        .iter_mut()
        .find_map(|property| match property {
            ObjectPropertyKind::ObjectProperty(property)
                if !property.computed
                    && property
                        .key
                        .static_name()
                        .as_ref()
                        .and_then(|key| key.as_str())
                        == Some(name) =>
            {
                Some(&mut property.value)
            }
            _ => None,
        })
}

impl<'a> VisitMut<'a> for Styles<'a> {
    fn visit_call_expression(&mut self, call: &mut CallExpression<'a>) {
        if let Some(Argument::ObjectExpression(definition)) = call.arguments.get_mut(1) {
            let defines =
                property(definition, "abi").is_some() && property(definition, "template").is_some();
            if defines {
                if let Some(Expression::StringLiteral(literal)) = property(definition, "styles") {
                    if let Some(css) = literal.value.as_str() {
                        let smaller = minify_css(css);
                        literal.value = JSStr::from_str_in(&smaller, &self.allocator);
                        literal.raw = None;
                    }
                }
            }
        }
        walk_mut::walk_call_expression(self, call);
    }
}

/// `css` without comments and without whitespace a browser doesn't read.
///
/// Conservative on purpose: whitespace becomes one space, and is dropped only next to `{`, `}`,
/// `;` and `,`, where CSS never reads it, and at either end. Next to anything else it stays: a
/// space before `:` is a descendant combinator in a selector (`a :hover`), one before `(` decides
/// between `and (width…)` and a function, and one around `+` is what `calc()` needs. Strings are
/// copied as they are, and so is the inside of `url(…)`. A `;` before `}` goes.
pub fn minify_css(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut space = false;
    let mut chars = css.chars().peekable();
    let free = |c: char| matches!(c, '{' | '}' | ';' | ',');
    while let Some(c) = chars.next() {
        if c == '/' && chars.peek() == Some(&'*') {
            chars.next();
            let mut last = ' ';
            for next in chars.by_ref() {
                if last == '*' && next == '/' {
                    break;
                }
                last = next;
            }
            space = true;
            continue;
        }
        if c.is_whitespace() {
            space = true;
            continue;
        }
        if space {
            if !out.is_empty() && !free(c) && !out.ends_with(free) {
                out.push(' ');
            }
            space = false;
        }
        if c == '}' && out.ends_with(';') {
            out.pop();
        }
        out.push(c);
        if c == '"' || c == '\'' {
            copy_string(&mut chars, &mut out, c);
        } else if c == '('
            && out.len() >= 4
            && out[..out.len() - 1].to_ascii_lowercase().ends_with("url")
        {
            copy_until_close(&mut chars, &mut out);
        }
    }
    out
}

/// The rest of a quoted string, its closing quote and escapes included.
fn copy_string(
    chars: &mut std::iter::Peekable<std::str::Chars<'_>>,
    out: &mut String,
    quote: char,
) {
    while let Some(c) = chars.next() {
        out.push(c);
        if c == '\\' {
            if let Some(escaped) = chars.next() {
                out.push(escaped);
            }
        } else if c == quote {
            return;
        }
    }
}

/// The rest of `url(…)`, as written, up to and with its `)`.
fn copy_until_close(chars: &mut std::iter::Peekable<std::str::Chars<'_>>, out: &mut String) {
    while let Some(c) = chars.next() {
        out.push(c);
        if c == '"' || c == '\'' {
            copy_string(chars, out, c);
        } else if c == '\\' {
            if let Some(escaped) = chars.next() {
                out.push(escaped);
            }
        } else if c == ')' {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn css_loses_what_a_browser_does_not_read_and_keeps_what_it_does() {
        assert_eq!(
            minify_css("/* card */\n:scope {\n  display: block;\n  color: red;\n}\n"),
            ":scope{display: block;color: red}"
        );
        // A descendant combinator before `:`, a media feature after `and`, `calc()`'s spaces.
        assert_eq!(minify_css("a :hover , b > c { }"), "a :hover,b > c{}");
        assert_eq!(
            minify_css("@media screen and (min-width: 1px) { a { width: calc(1px + 2%); } }"),
            "@media screen and (min-width: 1px){a{width: calc(1px + 2%)}}"
        );
        // Strings and url() as they are.
        assert_eq!(
            minify_css("a::before { content: \"  ;  }  \" ; background: url( a b.png ) }"),
            "a::before{content: \"  ;  }  \";background: url( a b.png )}"
        );
        assert_eq!(
            minify_css("a { content: 'it\\'s  } here' }"),
            "a{content: 'it\\'s  } here'}"
        );
        assert_eq!(
            minify_css("@scope (x-card) to ([data-zb-slotted=\"x-card\"]) {\n  p { margin: 0 }\n}"),
            "@scope (x-card) to ([data-zb-slotted=\"x-card\"]){p{margin: 0}}"
        );
        assert_eq!(minify_css("  "), "");
    }

    #[test]
    fn a_module_is_minified_and_its_styles_with_it() {
        let module = "// Generated by zubra.\nimport { $component as $define, $r } from \"@zubra/runtime\";\nexport const tag = \"x-card\";\nexport default $define(tag, {\n  abi: 5,\n  template: \"<p></p>\",\n  styles: \"p {\\n  color: red;\\n}\\n\",\n  setup($p, $emit) {\n    const longName = 1;\n    function unused() {}\n    return [{ path: [0], text: () => $r($p.title) + longName }];\n  },\n});\n";
        let out = minify(module).unwrap();
        assert!(!out.contains("Generated"), "{out}");
        assert!(
            !out.contains("longName") && !out.contains("unused"),
            "{out}"
        );
        assert!(out.contains("p{color: red}"), "{out}");
        assert!(
            out.contains("export const tag") || out.contains("as tag"),
            "{out}"
        );
        assert!(out.contains("@zubra/runtime"), "{out}");
        // A string an author wrote, even one called styles, is theirs.
        let own = "export const theme = f(1, { styles: \"a  {  }\" });\nexport default $define(\"x-a\", { abi: 5, template: \"\", setup() { return [] } });\n";
        assert!(minify(own).unwrap().contains("a  {  }"));
        assert!(minify("export default {").is_err());
        // Several definitions, as in a joined module: each one's CSS.
        let joined = "a(\"x-a\", { abi: 5, template: \"\", styles: \"p {  color: red;  }\" });\nb(\"x-b\", { abi: 5, template: \"\", styles: \"q {  color: blue;  }\" });\n";
        let out = minify(joined).unwrap();
        assert!(
            out.contains("p{color: red}") && out.contains("q{color: blue}"),
            "{out}"
        );
    }
}
