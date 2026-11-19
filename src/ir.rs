//! Static HTML IR: what the HTML backend renders. Every value is already known; conditions,
//! loops and slots have been expanded.
//!
//! The tree lives for one render and borrows what it can from the component it renders (`'a`):
//! tag and attribute names and literal text are the parsed component's own, not copies made for
//! every element of every render.

use std::borrow::Cow;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Component<'a> {
    pub tag: String,
    /// Render the template into a declarative shadow root instead of light DOM.
    pub shadow: bool,
    /// Prop values written back onto the host (only those that differ from their defaults), so
    /// a runtime can pick them up from the markup. `""` means a bare attribute.
    pub host_attributes: Vec<(String, String)>,
    pub nodes: Vec<Node<'a>>,
    /// Shadow-DOM components: supplied slot content, as the host's own (light DOM) children.
    pub light_children: Vec<Node<'a>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Node<'a> {
    Text(Parts<'a>),
    Element(Element<'a>),
    /// `<?zb ?>`: marks where a dynamic text node starts, for hydration. (The server writes
    /// markers as processing instructions, which minifiers keep; client templates use the
    /// comment form, `<!---->`, which the runtime reads too.)
    Anchor,
    /// `<?zb [?>` and `<?zb ]?>`: the start and end of an `zb-if` or `zb-each` region, or of
    /// one row of a list, for hydration.
    Open,
    /// `<?zb [!?>`: the start of a slot region holding supplied (static) content.
    OpenProjected,
    /// `<?zb [??>`: the start of a region the element renders (partial rendering left it empty).
    OpenClient,
    Close,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Element<'a> {
    pub name: Cow<'a, str>,
    pub attributes: Vec<Attribute<'a>>,
    pub children: Vec<Node<'a>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Attribute<'a> {
    pub name: Cow<'a, str>,
    /// `None` renders a bare attribute.
    pub value: Option<Vec<Part<'a>>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Part<'a> {
    /// Authored markup, preserved as written.
    Literal(Cow<'a, str>),
    /// A computed value, escaped when rendered.
    Escaped(String),
}

/// A text's parts: most texts are one (a literal, or one value), kept without a list.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Parts<'a> {
    One(Part<'a>),
    Many(Vec<Part<'a>>),
}

impl<'a> std::ops::Deref for Parts<'a> {
    type Target = [Part<'a>];
    fn deref(&self) -> &[Part<'a>] {
        match self {
            Parts::One(part) => std::slice::from_ref(part),
            Parts::Many(parts) => parts,
        }
    }
}

impl<'a> From<Vec<Part<'a>>> for Parts<'a> {
    fn from(mut parts: Vec<Part<'a>>) -> Self {
        if parts.len() == 1 {
            Parts::One(parts.pop().expect("one part"))
        } else {
            Parts::Many(parts)
        }
    }
}

impl<'a> From<Part<'a>> for Parts<'a> {
    fn from(part: Part<'a>) -> Self {
        Parts::One(part)
    }
}
