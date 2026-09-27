use std::process::Command;

const BIN: &str = env!("CARGO_BIN_EXE_ta-provision");

#[test]
fn encrypt_then_check_round_trips_and_prints_no_secrets() {
    let dir = tempfile::tempdir().unwrap();
    let plain = dir.path().join("plain.json");
    let pass = dir.path().join("pass.txt");
    std::fs::write(
        &plain,
        r#"{"credentials":[{"broker":"alpaca","id":"PA1","key":"KEYVALUE123","secret":"SECRETVALUE456"}],
            "backends":{"remote":{"CF-Access-Client-Secret":"HEADERVALUE789"}}}"#,
    )
    .unwrap();
    std::fs::write(&pass, "cli passphrase\n").unwrap();

    let enc = Command::new(BIN)
        .args([
            "encrypt",
            plain.to_str().unwrap(),
            "--passphrase-file",
            pass.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        enc.status.success(),
        "{}",
        String::from_utf8_lossy(&enc.stderr)
    );
    let toml_blob = String::from_utf8(enc.stdout).unwrap();
    assert!(toml_blob.starts_with("[credentials_blob]"));

    let cfg = dir.path().join("app-config.toml");
    std::fs::write(
        &cfg,
        format!(
            "[[profiles]]\nname = \"remote\"\nmarketstore_url = \"https://m\"\nfatechan_url = \"https://f\"\n\n{toml_blob}"
        ),
    )
    .unwrap();
    let check = Command::new(BIN)
        .args([
            "check",
            cfg.to_str().unwrap(),
            "--passphrase-file",
            pass.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        check.status.success(),
        "{}",
        String::from_utf8_lossy(&check.stderr)
    );
    let out = String::from_utf8(check.stdout).unwrap();
    assert_eq!(
        out.trim(),
        "ok: 1 credential(s) (alpaca:PA1), 1 backend profile(s) (remote)"
    );

    let everything = format!("{toml_blob}{out}{}", String::from_utf8_lossy(&enc.stderr));
    for s in [
        "KEYVALUE123",
        "SECRETVALUE456",
        "HEADERVALUE789",
        "cli passphrase",
    ] {
        assert!(!everything.contains(s), "{s} was printed");
    }

    std::fs::write(&pass, "wrong\n").unwrap();
    let bad = Command::new(BIN)
        .args([
            "check",
            cfg.to_str().unwrap(),
            "--passphrase-file",
            pass.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(!bad.status.success());
    assert!(String::from_utf8_lossy(&bad.stderr).contains("could not be decrypted"));
}
