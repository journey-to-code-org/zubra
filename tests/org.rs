// The repository lives at zubra-js/zubra. Nothing in it may name the organization it moved from,
// except the changelog's history, which is what happened and stays as written.
use std::process::Command;

#[test]
fn nothing_names_the_organization_the_repository_moved_from() {
    let old = ["journey", "to", "code", "org"].join("-");
    let output = Command::new("git")
        .args([
            "grep",
            "-I",
            "-n",
            "-e",
            &format!("{old}/zubra"),
            "-e",
            &format!("{old}.github.io/zubra"),
            "--",
            ".",
            ":!CHANGELOG.md",
        ])
        .output()
        .expect("git is needed to run this check");
    // git grep exits 1 when nothing matches.
    assert_eq!(
        output.status.code(),
        Some(1),
        "use zubra-js/zubra and zubra-js.github.io/zubra; found:\n{}",
        String::from_utf8_lossy(&output.stdout)
    );
}
