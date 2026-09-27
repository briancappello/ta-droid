## Purpose

Deliver broker credentials and backend auth tokens to the device safely. They ship as one encrypted blob, and one passphrase unlocks it. After that they live only in the platform secret store.

## ADDED Requirements

### Requirement: Encrypted credential blob
The build SHALL be able to embed one encrypted blob with the fields `salt`, `nonce`, `ciphertext`, and `fingerprint`. The plaintext SHALL contain the broker credentials (`broker`, `id`, `key`, `secret`) and the backend profile secrets (profile name and header values). The key SHALL come from the passphrase through Argon2id at the moderate cost settings, and the cipher SHALL be authenticated. The fingerprint SHALL be derived from the ciphertext.

#### Scenario: Blob round trip
- **WHEN** the encryption tool encrypts a credential set with a passphrase and the app decrypts the result with the same passphrase
- **THEN** the app recovers the same broker credentials and backend secrets

#### Scenario: Wrong passphrase
- **WHEN** the app decrypts a blob with a wrong passphrase
- **THEN** decryption fails and no secret is stored

### Requirement: Fingerprint decides whether to provision
When a blob is embedded, the app SHALL ask for the passphrase only if no fingerprint is stored or the stored fingerprint differs from the embedded one. The app version SHALL NOT affect this decision. When no blob is embedded, or the embedded blob is malformed, the app SHALL skip provisioning and start normally.

#### Scenario: First launch
- **WHEN** a blob is embedded and no fingerprint is stored
- **THEN** the app shows the passphrase prompt before any other screen

#### Scenario: Same blob
- **WHEN** the stored fingerprint equals the embedded fingerprint
- **THEN** the app starts without a prompt

#### Scenario: New blob shipped
- **WHEN** the stored fingerprint differs from the embedded fingerprint
- **THEN** the app shows the passphrase prompt

#### Scenario: No blob
- **WHEN** no blob is embedded
- **THEN** the app starts without a prompt

### Requirement: Store secrets, then the fingerprint
After a successful decryption, the app SHALL save every credential and backend secret to the platform secret store. It SHALL store the fingerprint only after every save has succeeded. The app SHALL then reload accounts and profiles and show the main UI.

#### Scenario: Successful provisioning
- **WHEN** the user enters the correct passphrase and every save succeeds
- **THEN** the secrets and the fingerprint are stored and the main UI opens

#### Scenario: Save failure
- **WHEN** a secret-store write fails
- **THEN** the fingerprint is not stored, so the prompt appears again at the next launch

### Requirement: Passphrase prompt feedback
The prompt SHALL be full-screen, with a masked passphrase field and an Unlock button. On failure it SHALL clear the field and show "Incorrect passphrase." for a decryption failure, or "Could not save credentials to secure storage." for a save failure. There SHALL be no lockout.

#### Scenario: Incorrect passphrase message
- **WHEN** the user submits a wrong passphrase
- **THEN** the field is cleared and "Incorrect passphrase." is shown

#### Scenario: Storage failure message
- **WHEN** decryption succeeds but a save fails
- **THEN** the field is cleared and "Could not save credentials to secure storage." is shown

### Requirement: Secrets are never exposed
The app SHALL NOT persist the passphrase. It SHALL NOT write the passphrase, keys, secrets, or tokens to logs, error messages, or the UI layer.

#### Scenario: No secrets in logs
- **WHEN** provisioning runs with either outcome
- **THEN** no log line or error message contains the passphrase or any decrypted value
