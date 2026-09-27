## Purpose

Define which broker accounts the app can use and how they are shown, without exposing their credentials to the UI.

## ADDED Requirements

### Requirement: Account list from metadata and credentials
The build SHALL embed non-secret account metadata as a list of `broker`, `id`, `name`, and `is_paper`. The account list SHALL contain only the entries that have a provisioned credential for `broker:id`. Malformed metadata SHALL give an empty list. `id` is the broker's account number and the join key with fa-techan.

#### Scenario: Account without a credential is skipped
- **WHEN** the metadata lists two accounts and only one has a provisioned credential
- **THEN** the account list contains only that one account

#### Scenario: Malformed metadata
- **WHEN** the embedded metadata is not valid
- **THEN** the account list is empty and the app still starts

### Requirement: UI receives accounts without secrets
The UI SHALL receive for each account only `id`, `name`, `broker`, `is_paper`, and the last four characters of the API key. The UI SHALL NOT receive the full key or the secret.

#### Scenario: Account view
- **WHEN** the UI requests the account list
- **THEN** each entry has no full key and no secret

### Requirement: Paper and live hosts
A paper account SHALL send all broker requests to the broker's paper host. A live account SHALL send them to the live host.

#### Scenario: Paper routing
- **WHEN** an order is placed for an account with `is_paper` true
- **THEN** the request goes to the paper host

### Requirement: Active account
The active account id SHALL persist across launches. If the stored id is not in the account list, the first account SHALL be active. With no accounts, there SHALL be no active account. A failed write of the active id SHALL NOT surface an error.

#### Scenario: Stale active id
- **WHEN** the stored active id matches no account
- **THEN** the first account becomes active

### Requirement: Account presentation
A paper account SHALL show a "paper" badge, and a live account SHALL show none. The Accounts screen SHALL be read-only. Each row SHALL show the name, the badge, and `id · ••••<last 4 of key>`. With no accounts it SHALL show "No accounts provisioned. Configure ACCOUNTS_JSON and provision credentials." The account picker SHALL show "Name · PAPER" for a paper account and "Select account ▼" when nothing is selected. It SHALL open a list with the selected row highlighted, and choosing a row or tapping outside SHALL close it.

#### Scenario: Accounts screen empty state
- **WHEN** there are no accounts
- **THEN** the Accounts screen shows the empty-state message

#### Scenario: Picker selection
- **WHEN** the user opens the picker and chooses an account
- **THEN** the picker closes and shows the chosen account's label
