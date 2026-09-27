//! Secret-leak guard for `e2e` builds (design D10 / app-shell spec).
//!
//! Every command result and every channel message is serialized and checked
//! against the provisioned secret values before it reaches the WebView. A hit
//! replaces the result with an error and logs `SECRET-LEAK`, so an end-to-end
//! run fails loudly. Normal builds compile this to nothing.

use serde::Serialize;

use crate::state::{AppState, CmdError, CmdResult};

/// Shortest value treated as a secret, to avoid matching trivial strings.
const MIN_LEN: usize = 6;

/// Every secret string in the store: header values as-is, and each string
/// field of JSON values (broker `key` and `secret`).
pub fn secret_values(state: &AppState) -> Vec<String> {
    let mut out = Vec::new();
    for (k, v) in state.secret_entries() {
        if k == ta_core::keys::FINGERPRINT {
            continue;
        }
        match serde_json::from_str::<serde_json::Value>(&v) {
            Ok(serde_json::Value::Object(map)) => {
                out.extend(map.values().filter_map(|x| x.as_str().map(str::to_owned)));
            }
            _ => out.push(v),
        }
    }
    out.retain(|s| s.len() >= MIN_LEN);
    out
}

/// The first secret found in `value`'s JSON, if any.
pub fn find_leak<T: Serialize>(value: &T, secrets: &[String]) -> Option<String> {
    let json = serde_json::to_string(value).ok()?;
    secrets.iter().find(|s| json.contains(s.as_str())).cloned()
}

/// Pass `result` through unless it contains a secret.
pub fn check<T: Serialize>(state: &AppState, command: &str, result: CmdResult<T>) -> CmdResult<T> {
    if !cfg!(feature = "e2e") {
        return result;
    }
    let secrets = secret_values(state);
    let leak = match &result {
        Ok(v) => find_leak(v, &secrets),
        Err(e) => find_leak(e, &secrets),
    };
    match leak {
        None => result,
        Some(_) => {
            // Never print the value itself.
            eprintln!("SECRET-LEAK: command `{command}` returned a provisioned secret");
            Err(CmdError::new(format!("secret leak blocked in `{command}`")))
        }
    }
}

/// For channel messages: true if `value` may be sent.
pub fn allow<T: Serialize>(secrets: &[String], what: &str, value: &T) -> bool {
    if !cfg!(feature = "e2e") {
        return true;
    }
    match find_leak(value, secrets) {
        None => true,
        Some(_) => {
            eprintln!("SECRET-LEAK: channel `{what}` carried a provisioned secret");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_secrets_anywhere_in_the_serialized_value() {
        let secrets = vec![
            "PKTESTKEY0000001".to_string(),
            "test-secret-0001".to_string(),
        ];
        #[derive(Serialize)]
        struct Nested {
            rows: Vec<(String, String)>,
        }
        let leaky = Nested {
            rows: vec![("id".into(), "xx test-secret-0001 yy".into())],
        };
        assert_eq!(
            find_leak(&leaky, &secrets).as_deref(),
            Some("test-secret-0001")
        );
        let clean = Nested {
            rows: vec![("id".into(), "0001".into())],
        };
        assert_eq!(find_leak(&clean, &secrets), None);
    }
}
