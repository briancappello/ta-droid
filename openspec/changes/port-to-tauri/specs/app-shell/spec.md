## Purpose

Define the app's navigation, shared chrome, supported platforms, and the boundary that keeps secrets out of the UI layer.

## ADDED Requirements

### Requirement: Supported platforms
The app SHALL build from one codebase and run on:
- Android 7.0 (API 24) and later on arm64 and x86_64;
- Linux on aarch64 and x86_64, both glibc (Droidian, desktop) and musl (postmarketOS);
- the Phosh and Plasma Mobile shells.

Its application identifier SHALL be `com.briancappello.ta_droid` on every platform.

#### Scenario: Android install
- **WHEN** the Android package is installed on an Android 7.0 or later device
- **THEN** the app launches under the identifier `com.briancappello.ta_droid`

#### Scenario: postmarketOS install
- **WHEN** the aarch64 musl package is installed on postmarketOS with Phosh
- **THEN** the app appears in the launcher and opens full-screen

### Requirement: Secret boundary
Keys, secrets, auth header values, and the passphrase SHALL stay in the backend and the platform secret store. The UI layer SHALL NOT be able to read them through any command, event, or stored value. The UI SHALL NOT be able to make network requests of its own. All network access SHALL go through the backend.

#### Scenario: UI network request blocked
- **WHEN** UI code tries to fetch an external URL directly
- **THEN** the request is blocked by the content security policy

#### Scenario: No secret in responses
- **WHEN** any backend command or event is called during an end-to-end run
- **THEN** no response contains a provisioned key, secret, or header value

### Requirement: Secret storage per platform
The backend SHALL store secrets in the Android Keystore-backed storage on Android, and in the Secret Service keyring on Linux.

#### Scenario: Secrets survive restart
- **WHEN** credentials were provisioned and the app is restarted
- **THEN** the accounts are available without a passphrase prompt

### Requirement: Navigation
A drawer SHALL offer Chart, Positions, Orders, Watchlists, and Settings. The app SHALL open on Watchlists. Order entry and Exit SHALL open on top of the chart. Accounts and Backend SHALL open on top of Settings. Back navigation, including the Android back button, SHALL follow history.

#### Scenario: Android back
- **WHEN** the user opens order entry from the chart and presses the Android back button
- **THEN** the chart is shown again

### Requirement: Shared header
Screens SHALL use a header with the drawer button, a title, an optional action area, the MS/FA health pill, and an optional refresh button. The header and content SHALL respect the display's safe areas (notch, status bar, gesture bar).

#### Scenario: Safe areas
- **WHEN** the app runs on a device with a display cutout
- **THEN** no header control is covered by the cutout or status bar

### Requirement: Settings
The Settings screen SHALL show two rows: "Accounts — N linked" and "Backend — <active profile name>", which open the Accounts and Backend screens.

#### Scenario: Settings rows
- **WHEN** two accounts are provisioned and the active profile is `local`
- **THEN** Settings shows "Accounts — 2 linked" and "Backend — local"
