//! Shared contract tests for every `KvStore` implementation.

use ta_core::store::{FileStore, KvStore, MemoryStore};

fn contract(store: &dyn KvStore) {
    let key = "cred.alpaca:PA1TEST";
    store.delete(key).unwrap();
    assert_eq!(store.get(key).unwrap(), None);
    store.set(key, "{\"key\":\"K\",\"secret\":\"S\"}").unwrap();
    assert_eq!(
        store.get(key).unwrap().as_deref(),
        Some("{\"key\":\"K\",\"secret\":\"S\"}")
    );
    store.set(key, "second").unwrap();
    assert_eq!(store.get(key).unwrap().as_deref(), Some("second"));
    store.set("other", "x").unwrap();
    store.delete(key).unwrap();
    assert_eq!(store.get(key).unwrap(), None);
    assert_eq!(store.get("other").unwrap().as_deref(), Some("x"));
    store.delete(key).unwrap(); // deleting a missing key is fine
    store.delete("other").unwrap();
}

#[test]
fn memory_store_contract() {
    contract(&MemoryStore::default());
}

#[test]
fn file_store_contract_and_persistence() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested/store.json");
    contract(&FileStore::new(&path));

    FileStore::new(&path).set("k", "v").unwrap();
    assert_eq!(
        FileStore::new(&path).get("k").unwrap().as_deref(),
        Some("v")
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}

#[test]
fn file_store_treats_a_corrupt_file_as_empty() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("store.json");
    std::fs::write(&path, "not json").unwrap();
    let s = FileStore::new(&path);
    assert_eq!(s.get("k").unwrap(), None);
    s.set("k", "v").unwrap();
    assert_eq!(s.get("k").unwrap().as_deref(), Some("v"));
}

/// Needs a Secret Service on the session bus (on this workstation, KDE's
/// ksecretd). It writes and then deletes items under a test service name.
/// Run with `mise run test:secret-service`.
#[cfg(all(target_os = "linux", not(target_os = "android")))]
#[test]
#[ignore = "needs a Secret Service; run with `mise run test:secret-service`"]
fn secret_service_store_contract() {
    let store =
        ta_core::store::KeyringStore::secret_service("com.briancappello.ta-droid.test").unwrap();
    contract(&store);
}
