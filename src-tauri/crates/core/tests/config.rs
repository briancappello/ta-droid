use ta_core::config::{AppConfig, BrokerId, ConfigError};

const PROFILES: &str = r#"
[[profiles]]
name = "local"
marketstore_url = "http://127.0.0.1:5993"
fatechan_url = "http://127.0.0.1:8000"

[[profiles]]
name = "remote"
marketstore_url = "https://marketstore.example"
fatechan_url = "https://fa-techan.example"
auth_headers = ["CF-Access-Client-Id", "CF-Access-Client-Secret"]
ca_cert_pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"
"#;

#[test]
fn valid_config_parses_everything() {
    let text = format!(
        r#"
{PROFILES}
[[accounts]]
broker = "alpaca"
id = "PA1"
name = "Paper"
is_paper = true

[credentials_blob]
salt = "s"
nonce = "n"
ciphertext = "c"
fingerprint = "f"

[brokers.alpaca]
paper = "http://127.0.0.1:8787/alpaca"
live = "http://127.0.0.1:8787/alpaca"
"#
    );
    let cfg = AppConfig::parse(&text).unwrap();
    assert_eq!(cfg.accounts.len(), 1);
    assert_eq!(cfg.accounts[0].id, "PA1");
    assert!(cfg.accounts[0].is_paper);
    assert_eq!(cfg.profiles.len(), 2);
    let remote = cfg.profile("remote").unwrap();
    assert_eq!(remote.auth_headers.len(), 2);
    assert!(
        remote
            .ca_cert_pem
            .as_deref()
            .unwrap()
            .contains("BEGIN CERTIFICATE")
    );
    assert!(cfg.profile("local").unwrap().auth_headers.is_empty());
    assert_eq!(cfg.credentials_blob.as_ref().unwrap().fingerprint, "f");
    assert_eq!(
        cfg.broker_hosts(BrokerId::Alpaca).paper,
        "http://127.0.0.1:8787/alpaca"
    );
}

#[test]
fn malformed_account_list_gives_no_accounts_but_still_starts() {
    let text = format!("{PROFILES}\naccounts = \"not a list\"\n");
    let cfg = AppConfig::parse(&text).unwrap();
    assert!(cfg.accounts.is_empty());

    let text = format!("{PROFILES}\n[[accounts]]\nbroker = \"alpaca\"\nid = \"X\"\n");
    assert!(AppConfig::parse(&text).unwrap().accounts.is_empty());
}

#[test]
fn missing_or_malformed_blob_means_nothing_to_provision() {
    assert!(
        AppConfig::parse(PROFILES)
            .unwrap()
            .credentials_blob
            .is_none()
    );
    let text = format!("{PROFILES}\n[credentials_blob]\nsalt = \"only\"\n");
    assert!(AppConfig::parse(&text).unwrap().credentials_blob.is_none());
}

#[test]
fn broker_hosts_default_to_production() {
    let cfg = AppConfig::parse(PROFILES).unwrap();
    let h = cfg.broker_hosts(BrokerId::Alpaca);
    assert_eq!(h.paper, "https://paper-api.alpaca.markets");
    assert_eq!(h.live, "https://api.alpaca.markets");
}

#[test]
fn profiles_are_required_and_unique() {
    assert!(matches!(AppConfig::parse(""), Err(ConfigError::NoProfiles)));
    let dup = format!(
        "{PROFILES}{}",
        &PROFILES[..PROFILES.find("[[profiles]]\nname = \"remote\"").unwrap()]
    );
    assert!(
        matches!(AppConfig::parse(&dup), Err(ConfigError::DuplicateProfile(n)) if n == "local")
    );
    assert!(matches!(
        AppConfig::parse("[[profiles]]\nname = \"x\"\n"),
        Err(ConfigError::Field {
            field: "profiles",
            ..
        })
    ));
}
