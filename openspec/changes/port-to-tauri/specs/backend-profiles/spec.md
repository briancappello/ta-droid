## Purpose

Let the user point the app at different MarketStore and fa-techan deployments (local replica, taichi, and remote through a tunnel) at runtime, and report their health without letting a backend failure break the app.

## ADDED Requirements

### Requirement: Backend profiles
The build SHALL define one or more named profiles. Each profile SHALL have a MarketStore base URL, an fa-techan base URL, and optionally a set of HTTP headers whose values come from the provisioned secrets. Plain `http` URLs SHALL be allowed. A profile MAY name an extra trusted CA certificate for TLS.

#### Scenario: Profile headers are applied
- **WHEN** the active profile defines headers
- **THEN** every REST request and the WebSocket handshake to that profile's MarketStore and fa-techan carry those headers

#### Scenario: Plain http profile
- **WHEN** the active profile uses an `http://` URL on Android
- **THEN** the requests succeed and are not blocked by the platform's cleartext policy

### Requirement: Runtime profile selection
The Backend settings screen SHALL list the profiles and show which is active. Choosing a profile SHALL make it active immediately, persist it across launches, restart the live streams, and refresh health. If the persisted profile no longer exists, the first profile SHALL be active. The screen SHALL show each profile's URLs and whether it has auth headers, but never the header values.

#### Scenario: Switch profile
- **WHEN** the user selects a different profile
- **THEN** new data requests go to the new profile's URLs and the choice survives a restart

#### Scenario: Header values hidden
- **WHEN** the Backend settings screen shows a profile with auth headers
- **THEN** it indicates that auth is set and shows no header value

### Requirement: Health probes
The app SHALL probe MarketStore at `GET /v1/health` and fa-techan at `GET /health` on the active profile. It SHALL run both probes independently and in parallel, at startup and then every 20 seconds. A 2xx response SHALL mean up. Any other status or a network error SHALL mean down. Before the first result the state SHALL be unknown. A probe SHALL never raise an error to the UI.

#### Scenario: One backend down
- **WHEN** MarketStore answers 200 and fa-techan refuses the connection
- **THEN** MarketStore shows up, fa-techan shows down, and the app stays usable

### Requirement: Health indicator
The header SHALL show a pill with two dots labeled MS and FA: green for up, red for down, grey for unknown. Tapping the pill SHALL open the Backend settings screen.

#### Scenario: Tap health pill
- **WHEN** the user taps the pill
- **THEN** the Backend settings screen opens

### Requirement: fa-techan is enrichment only
Every fa-techan failure (non-2xx, network error, timeout, or malformed body) SHALL resolve to a safe empty result. It SHALL NOT raise an error, show error text, or block a broker action. The red FA dot SHALL be the only sign of degraded mode. No broker credential SHALL ever be sent to fa-techan.

#### Scenario: fa-techan down during trading
- **WHEN** fa-techan is unreachable and the user places an order
- **THEN** the order goes to the broker normally and strategy tags show "Unattributed"
