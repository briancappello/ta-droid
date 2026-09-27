use std::collections::BTreeMap;
use ta_core::config::EncryptedBlob;
use ta_provision::{BlobError, Credential, Plaintext, decrypt, encrypt, fingerprint};

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");

fn node_vector() -> (EncryptedBlob, String, serde_json::Value) {
    let blob = serde_json::from_str(
        &std::fs::read_to_string(format!("{FIXTURES}/node-blob.json")).unwrap(),
    )
    .unwrap();
    let pw = std::fs::read_to_string(format!("{FIXTURES}/node-passphrase.txt"))
        .unwrap()
        .trim_end()
        .to_owned();
    let plain = serde_json::from_str(
        &std::fs::read_to_string(format!("{FIXTURES}/node-plaintext.json")).unwrap(),
    )
    .unwrap();
    (blob, pw, plain)
}

#[test]
fn decrypts_the_libsodium_blob_made_by_the_node_script() {
    let (blob, pw, want) = node_vector();
    let got = decrypt(&pw, &blob).unwrap();
    assert_eq!(serde_json::to_value(&got).unwrap(), want);
    assert_eq!(got.credentials.len(), 2);
    assert_eq!(
        got.backends["remote"]["CF-Access-Client-Id"],
        "test-client-id"
    );
}

#[test]
fn fingerprint_matches_the_node_value() {
    let (blob, _, _) = node_vector();
    assert_eq!(fingerprint(&blob.ciphertext), blob.fingerprint);
}

#[test]
fn wrong_passphrase_fails_to_decrypt() {
    let (blob, _, _) = node_vector();
    assert_eq!(decrypt("wrong", &blob), Err(BlobError::Decrypt));
}

#[test]
fn tampered_ciphertext_fails_to_decrypt() {
    let (mut blob, pw, _) = node_vector();
    let mut c = blob.ciphertext.into_bytes();
    c[10] = if c[10] == b'A' { b'B' } else { b'A' };
    blob.ciphertext = String::from_utf8(c).unwrap();
    assert_eq!(decrypt(&pw, &blob), Err(BlobError::Decrypt));
}

#[test]
fn round_trip_with_fresh_salt_and_nonce() {
    let pt = Plaintext {
        credentials: vec![Credential {
            broker: "alpaca".into(),
            id: "PA1".into(),
            key: "K".into(),
            secret: "S".into(),
        }],
        backends: BTreeMap::from([(
            "local".into(),
            BTreeMap::from([("Authorization".into(), "Bearer t".into())]),
        )]),
    };
    let a = encrypt("pw", &pt).unwrap();
    let b = encrypt("pw", &pt).unwrap();
    assert_ne!(a.salt, b.salt);
    assert_ne!(a.nonce, b.nonce);
    assert_eq!(a.fingerprint, fingerprint(&a.ciphertext));
    assert_eq!(decrypt("pw", &a).unwrap(), pt);
}

#[test]
fn malformed_fields_are_reported_without_decrypting() {
    let (mut blob, pw, _) = node_vector();
    blob.nonce = "AAAA".into();
    assert_eq!(
        decrypt(&pw, &blob),
        Err(BlobError::Malformed("nonce length"))
    );
    blob.salt = "!!".into();
    assert_eq!(decrypt(&pw, &blob), Err(BlobError::Malformed("salt")));
}

#[test]
fn debug_output_never_contains_key_material() {
    let (blob, pw, _) = node_vector();
    let pt = decrypt(&pw, &blob).unwrap();
    let dbg = format!("{pt:?}");
    for secret in [
        "PKTESTKEY0000001",
        "test-secret-0001",
        "test-client-id",
        "test-client-secret",
    ] {
        assert!(!dbg.contains(secret), "{secret} leaked into Debug: {dbg}");
    }
}
