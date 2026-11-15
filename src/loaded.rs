//! Sources sent once: a set of files a long-lived compiler keeps under a handle, so each request
//! after the first names the handle in place of carrying every source again (`command: "load"`,
//! then `"loaded": "<handle>"` where `"files"` would be; see `request.rs`).
//!
//! A server renders the same component thousands of times with different props. With the
//! sources in every request, most of a small render was reading them: parsing the request,
//! copying each file, checking that the parsed component still matched. A set doesn't change,
//! so what was worked out from it (a component parsed, its warnings) is kept with it.
//!
//! The handle is a hash of the set, so the same files are the same handle, and a compiler that
//! doesn't have a handle (a new instance, or one that let the set go to make room) says so
//! (`"reload": true`) and is sent the files again.

use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::hash::{Hash, Hasher};
use std::rc::Rc;

use crate::ast::ComponentAst;
use crate::Diagnostic;

/// The most source text kept, over every set: past it, the sets loaded longest ago go.
const KEPT_BYTES: usize = 64 << 20;

/// A request's files, by path, and what has been worked out from them.
pub struct Set {
    pub files: HashMap<String, String>,
    parsed: RefCell<HashMap<String, Rc<ComponentAst>>>,
    warnings: RefCell<HashMap<String, Rc<Vec<Diagnostic>>>>,
    bytes: usize,
}

impl Set {
    pub fn new(files: HashMap<String, String>) -> Self {
        let bytes = files
            .iter()
            .map(|(path, source)| path.len() + source.len())
            .sum();
        Self {
            files,
            parsed: RefCell::new(HashMap::new()),
            warnings: RefCell::new(HashMap::new()),
            bytes,
        }
    }

    /// The component's warnings, worked out once for the set.
    pub fn warnings(
        &self,
        path: &str,
        find: impl FnOnce() -> Vec<Diagnostic>,
    ) -> Rc<Vec<Diagnostic>> {
        if let Some(found) = self.warnings.borrow().get(path) {
            return Rc::clone(found);
        }
        let found = Rc::new(find());
        self.warnings
            .borrow_mut()
            .insert(path.to_owned(), Rc::clone(&found));
        found
    }

    /// A hash of the files, the same for the same files in any order: the set's handle.
    fn handle(&self) -> String {
        let mut entries: Vec<(&String, &String)> = self.files.iter().collect();
        entries.sort();
        let hash = |seed: u8| {
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            seed.hash(&mut hasher);
            entries.hash(&mut hasher);
            hasher.finish()
        };
        format!("{:016x}{:016x}", hash(1), hash(2))
    }
}

#[derive(Default)]
struct Sets {
    by_handle: HashMap<String, Rc<Set>>,
    /// Handles in the order loaded.
    order: VecDeque<String>,
    bytes: usize,
}

thread_local! {
    static SETS: RefCell<Sets> = RefCell::new(Sets::default());
    /// The set the request being answered reads from.
    static CURRENT: RefCell<Option<Rc<Set>>> = const { RefCell::new(None) };
}

/// Keep `files`, and answer with the handle later requests name them by.
pub fn load(files: HashMap<String, String>) -> String {
    let set = Set::new(files);
    let handle = set.handle();
    SETS.with(|sets| {
        let mut sets = sets.borrow_mut();
        if sets.by_handle.contains_key(&handle) {
            return;
        }
        sets.bytes += set.bytes;
        sets.order.push_back(handle.clone());
        sets.by_handle.insert(handle.clone(), Rc::new(set));
        // Room for the newest: the oldest go, and are loaded again if they are asked for.
        while sets.bytes > KEPT_BYTES && sets.order.len() > 1 {
            let Some(oldest) = sets.order.pop_front() else {
                break;
            };
            if let Some(gone) = sets.by_handle.remove(&oldest) {
                sets.bytes -= gone.bytes;
            }
        }
    });
    handle
}

/// The set loaded under `handle`, if this compiler has it.
pub fn get(handle: &str) -> Option<Rc<Set>> {
    SETS.with(|sets| sets.borrow().by_handle.get(handle).cloned())
}

/// Answer a request from `set`: what it has parsed is found, and what is parsed is kept.
pub fn reading<T>(set: &Rc<Set>, answer: impl FnOnce() -> T) -> T {
    let before = CURRENT.with(|current| current.replace(Some(Rc::clone(set))));
    let answered = answer();
    CURRENT.with(|current| *current.borrow_mut() = before);
    answered
}

/// Whether `source` is the very text the set has at `path` (the same bytes in the same place:
/// not a copy, and not what a step before parsing made of it).
fn is_the_sets(set: &Set, path: &str, source: &str) -> bool {
    set.files
        .get(path)
        .is_some_and(|kept| std::ptr::eq(kept.as_str(), source))
}

/// The component at `path`, if the set being read has parsed it from this `source` already.
pub fn parsed(path: &str, source: &str) -> Option<Rc<ComponentAst>> {
    CURRENT.with(|current| {
        let current = current.borrow();
        let set = current.as_ref()?;
        if !is_the_sets(set, path, source) {
            return None;
        }
        let found = set.parsed.borrow().get(path).cloned();
        found
    })
}

/// Keep `component`, parsed from the set's `source` at `path`, for the set's later requests.
pub fn keep(path: &str, source: &str, component: &Rc<ComponentAst>) {
    CURRENT.with(|current| {
        if let Some(set) = current.borrow().as_ref() {
            if is_the_sets(set, path, source) {
                set.parsed
                    .borrow_mut()
                    .insert(path.to_owned(), Rc::clone(component));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(given: &[(&str, &str)]) -> HashMap<String, String> {
        given
            .iter()
            .map(|(path, source)| ((*path).to_owned(), (*source).to_owned()))
            .collect()
    }

    #[test]
    fn the_same_files_are_the_same_handle_and_other_files_another() {
        let one = load(files(&[("/a.zb", "<x-a></x-a>"), ("/b.zb", "<x-b></x-b>")]));
        assert_eq!(one.len(), 32);
        assert_eq!(
            one,
            load(files(&[("/b.zb", "<x-b></x-b>"), ("/a.zb", "<x-a></x-a>")]))
        );
        assert_ne!(
            one,
            load(files(&[
                ("/a.zb", "<x-a></x-a>"),
                ("/b.zb", "<x-b> </x-b>")
            ]))
        );
        assert_ne!(one, load(files(&[("/a.zb", "<x-a></x-a>")])));
        // A path and a source can't trade characters and hash the same.
        assert_ne!(load(files(&[("/ab", "c")])), load(files(&[("/a", "bc")])));
        assert!(get(&one).is_some_and(|set| set.files.len() == 2));
        assert!(get("0000").is_none());
    }

    #[test]
    fn a_component_is_kept_for_the_sets_own_text_and_only_while_the_set_is_read() {
        let source = "<x-a><b>one</b></x-a>";
        let set = Rc::new(Set::new(files(&[("/a.zb", source)])));
        let component = Rc::new(crate::parser::parse(source).unwrap());
        let own = set.files["/a.zb"].as_str();
        // Not while nothing is being read.
        keep("/a.zb", own, &component);
        assert!(parsed("/a.zb", own).is_none());
        reading(&set, || {
            assert!(parsed("/a.zb", own).is_none(), "nothing kept yet");
            // The same characters from somewhere else (an edited copy a command works on, what
            // a step before parsing made of the file) are not the set's file.
            let copy = source.to_owned();
            keep("/a.zb", &copy, &component);
            assert!(parsed("/a.zb", own).is_none());
            keep("/a.zb", own, &component);
            assert!(parsed("/a.zb", own).is_some_and(|found| Rc::ptr_eq(&found, &component)));
            assert!(parsed("/a.zb", &copy).is_none());
            assert!(parsed("/b.zb", own).is_none());
            // A request answered inside another reads its own set, and the first is back after.
            let other = Rc::new(Set::new(files(&[("/a.zb", source)])));
            reading(&other, || assert!(parsed("/a.zb", own).is_none()));
            assert!(parsed("/a.zb", own).is_some());
        });
        assert!(parsed("/a.zb", own).is_none());
        // It stays with the set for the next request that reads it.
        reading(&set, || assert!(parsed("/a.zb", own).is_some()));
    }

    #[test]
    fn warnings_are_worked_out_once_for_a_set() {
        let set = Set::new(files(&[("/a.zb", "<x-a></x-a>")]));
        let mut asked = 0;
        for _ in 0..3 {
            let found = set.warnings("/a.zb", || {
                asked += 1;
                vec![Diagnostic::new(
                    crate::diagnostic::Span::new(1, 1),
                    "careful",
                )]
            });
            assert_eq!(found.len(), 1);
        }
        assert_eq!(asked, 1);
        assert!(set.warnings("/b.zb", Vec::new).is_empty());
    }

    #[test]
    fn past_what_is_kept_the_oldest_sets_go_and_the_newest_stays() {
        let big = |name: &str| files(&[(name, &"x".repeat(KEPT_BYTES / 2 - 64))]);
        let first = load(big("/one.zb"));
        let second = load(big("/two.zb"));
        assert!(get(&first).is_some() && get(&second).is_some());
        let third = load(big("/three.zb"));
        assert!(get(&first).is_none(), "the oldest made room");
        assert!(get(&second).is_some() && get(&third).is_some());
        // One set larger than everything kept is still loaded: a request needs its files.
        let huge = load(files(&[("/huge.zb", &"x".repeat(KEPT_BYTES + 1))]));
        assert!(get(&huge).is_some());
        assert!(get(&second).is_none() && get(&third).is_none());
    }
}
