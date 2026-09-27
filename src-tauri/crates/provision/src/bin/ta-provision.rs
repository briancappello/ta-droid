//! ta-provision: make the encrypted credentials blob for `app-config.toml`.
//!
//!   ta-provision encrypt PLAINTEXT.json [--passphrase-file FILE]
//!       Prints a `[credentials_blob]` TOML table to paste into the config.
//!   ta-provision check CONFIG.toml [--passphrase-file FILE]
//!       Decrypts the config's blob and prints counts only, never values.
//!
//! Without --passphrase-file, the passphrase is read from the terminal with
//! echo off. The passphrase and the plaintext values are never printed.

use std::process::ExitCode;
use ta_core::config::AppConfig;
use ta_provision::{Plaintext, decrypt, encrypt};
use zeroize::Zeroizing;

fn usage() -> ExitCode {
    eprintln!(
        "usage: ta-provision encrypt PLAINTEXT.json [--passphrase-file FILE]\n       \
         ta-provision check CONFIG.toml [--passphrase-file FILE]"
    );
    ExitCode::from(2)
}

fn passphrase(file: Option<&str>, confirm: bool) -> Result<Zeroizing<String>, String> {
    if let Some(f) = file {
        let text = std::fs::read_to_string(f).map_err(|e| format!("read {f}: {e}"))?;
        return Ok(Zeroizing::new(
            text.trim_end_matches(['\r', '\n']).to_owned(),
        ));
    }
    let p = Zeroizing::new(rpassword::prompt_password("Passphrase: ").map_err(|e| e.to_string())?);
    if confirm {
        let again =
            Zeroizing::new(rpassword::prompt_password("Again: ").map_err(|e| e.to_string())?);
        if *again != *p {
            return Err("passphrases differ".into());
        }
    }
    if p.is_empty() {
        return Err("empty passphrase".into());
    }
    Ok(p)
}

fn run(args: &[String]) -> Result<(), String> {
    let pf = args
        .iter()
        .position(|a| a == "--passphrase-file")
        .map(|i| {
            args.get(i + 1)
                .map(String::as_str)
                .ok_or("--passphrase-file needs a path")
        })
        .transpose()?;
    match args.first().map(String::as_str) {
        Some("encrypt") => {
            let path = args.get(1).ok_or("missing PLAINTEXT.json")?;
            let text = Zeroizing::new(
                std::fs::read_to_string(path).map_err(|e| format!("read {path}: {e}"))?,
            );
            let pt: Plaintext = serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
            let pw = passphrase(pf, true)?;
            let blob = encrypt(&pw, &pt).map_err(|e| e.to_string())?;
            println!(
                "[credentials_blob]\nsalt = {:?}\nnonce = {:?}\nciphertext = {:?}\nfingerprint = {:?}",
                blob.salt, blob.nonce, blob.ciphertext, blob.fingerprint
            );
            eprintln!(
                "encrypted {} credential(s) and {} backend profile(s); fingerprint {}…",
                pt.credentials.len(),
                pt.backends.len(),
                &blob.fingerprint[..12]
            );
            Ok(())
        }
        Some("check") => {
            let path = args.get(1).ok_or("missing CONFIG.toml")?;
            let text = std::fs::read_to_string(path).map_err(|e| format!("read {path}: {e}"))?;
            let cfg = AppConfig::parse(&text).map_err(|e| e.to_string())?;
            let blob = cfg
                .credentials_blob
                .ok_or("the config has no valid [credentials_blob]")?;
            let pw = passphrase(pf, false)?;
            let pt = decrypt(&pw, &blob).map_err(|e| e.to_string())?;
            println!(
                "ok: {} credential(s) ({}), {} backend profile(s) ({})",
                pt.credentials.len(),
                pt.credentials
                    .iter()
                    .map(|c| format!("{}:{}", c.broker, c.id))
                    .collect::<Vec<_>>()
                    .join(", "),
                pt.backends.len(),
                pt.backends.keys().cloned().collect::<Vec<_>>().join(", "),
            );
            Ok(())
        }
        _ => Err(String::new()),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) if e.is_empty() => usage(),
        Err(e) => {
            eprintln!("ta-provision: {e}");
            ExitCode::FAILURE
        }
    }
}
