// The repository lives at zubra-js/zubra. Nothing in it may name the organization it moved from,
// except the changelog's history, which is what happened and stays as written, and open.parlor,
// an app of its own that still lives there.
use std::process::Command;

/// Lines of the repository (outside the changelog) that name `pattern`, as `path:line:text`.
fn lines_naming(pattern: &str) -> Vec<String> {
    let output = Command::new("git")
        .args([
            "grep",
            "-I",
            "-n",
            "-F",
            "-e",
            pattern,
            "--",
            ".",
            ":!CHANGELOG.md",
        ])
        .output()
        .expect("git is needed to run this check");
    // git grep exits 1 when nothing matches.
    assert!(
        matches!(output.status.code(), Some(0 | 1)),
        "git grep failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::to_owned)
        .collect()
}

/// Each place in `line` that names the old organization's GitHub or Pages address without being
/// a link to open.parlor: `github.com/<old>` alone (the organization's page), with another
/// repository after it, or `<old>.github.io` with another site after it.
fn old_links(line: &str, old: &str) -> Vec<String> {
    let mut found = Vec::new();
    for prefix in [format!("github.com/{old}"), format!("{old}.github.io")] {
        for (at, _) in line.match_indices(&prefix) {
            let rest = &line[at + prefix.len()..];
            if !rest.starts_with("/open.parlor") {
                let end = rest
                    .find(|c: char| {
                        c.is_whitespace() || matches!(c, ')' | '"' | '\'' | '`' | '>' | ']')
                    })
                    .unwrap_or(rest.len());
                found.push(format!("{prefix}{}", &rest[..end]));
            }
        }
    }
    found
}

#[test]
fn nothing_names_the_organization_the_repository_moved_from() {
    let old = ["journey", "to", "code", "org"].join("-");
    let mut found = lines_naming(&format!("{old}/zubra"));
    found.extend(lines_naming(&format!("{old}.github.io/zubra")));
    assert!(
        found.is_empty(),
        "use zubra-js/zubra and zubra-js.github.io/zubra; found:\n{}",
        found.join("\n")
    );
}

#[test]
fn no_link_goes_to_the_old_organization_but_open_parlor() {
    let old = ["journey", "to", "code", "org"].join("-");
    let found: Vec<String> = lines_naming(&old)
        .into_iter()
        .filter(|line| !old_links(line, &old).is_empty())
        .collect();
    assert!(
        found.is_empty(),
        "link to zubra-js (github.com/zubra-js, zubra-js.github.io); only open.parlor stays at the old organization; found:\n{}",
        found.join("\n")
    );
}

#[test]
fn the_check_tells_an_open_parlor_link_from_any_other() {
    let old = "old-org";
    // open.parlor's repository and site, and the Marketplace publisher (another name), are fine.
    assert!(old_links("[open.parlor](https://github.com/old-org/open.parlor)", old).is_empty());
    assert!(old_links(
        "https://old-org.github.io/open.parlor/conformance/badge.json",
        old
    )
    .is_empty());
    assert!(old_links("JourneytoCode.zubra on the Marketplace", old).is_empty());
    // The organization itself, another repository of it, and another site of it are not.
    assert_eq!(
        old_links("see https://github.com/old-org.", old),
        ["github.com/old-org."]
    );
    assert_eq!(
        old_links("[the org](https://github.com/old-org)", old),
        ["github.com/old-org"]
    );
    assert_eq!(
        old_links("https://github.com/old-org/signals-devtools", old),
        ["github.com/old-org/signals-devtools"]
    );
    assert_eq!(
        old_links("https://old-org.github.io/", old),
        ["old-org.github.io/"]
    );
}
