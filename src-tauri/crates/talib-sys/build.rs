//! Compiles the vendored TA-Lib sources with `cc`, so the same build works for
//! the host, the Android NDK, and musl without CMake or a system package.

use std::path::Path;

fn main() {
    let root = Path::new("vendor/ta-lib-0.6.4");
    let mut build = cc::Build::new();
    build
        .include(root.join("include"))
        .include(root.join("src/ta_common"))
        .include(root.join("src/ta_func"))
        // Upstream code; its warnings are not ours to fix.
        .warnings(false);
    for dir in ["src/ta_common", "src/ta_func"] {
        let dir = root.join(dir);
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .unwrap_or_else(|e| panic!("read {}: {e}", dir.display()))
            .map(|e| e.expect("dir entry").path())
            .filter(|p| p.extension().is_some_and(|x| x == "c"))
            .collect();
        files.sort();
        build.files(files);
    }
    build.compile("ta-lib");
    println!("cargo:rerun-if-changed=vendor");
}
