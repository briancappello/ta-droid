## Purpose

View positions and working orders across all accounts, place orders, and flatten a symbol, talking to the broker directly and never through fa-techan.

## ADDED Requirements

### Requirement: Broker requests
Every broker request SHALL authenticate with the account's key and secret, SHALL NOT follow redirects, and SHALL time out after 30 seconds. Order creation SHALL NOT be retried automatically. If the caller gives no client order id, the app SHALL generate a unique one with the prefix `ta-`. A 204 response or an empty body SHALL count as success. An unknown broker SHALL be an error.

#### Scenario: Redirect refused
- **WHEN** the broker answers a request with a redirect
- **THEN** the request fails and the redirect is not followed

#### Scenario: Client order id
- **WHEN** an order is placed without a client order id
- **THEN** the request carries a generated id that starts with `ta-`

### Requirement: Broker error messages
Broker failures SHALL map to these messages:

| Failure | Message |
|---|---|
| 401 or 403 | "Check the API keys for this account." |
| 429 | "Rate limited by Alpaca, retry shortly." |
| 422 | the broker's message, or "Alpaca rejected the request (validation error)." |
| any other status | "Alpaca error (<status>)." |
| timeout | "Alpaca request timed out." |
| network failure | "Can't reach Alpaca — check your connection." |

#### Scenario: Bad keys
- **WHEN** the broker answers 401
- **THEN** the message is "Check the API keys for this account."

### Requirement: Positions screen
The Positions screen SHALL load positions for all accounts in parallel and group them by account. Each group header SHALL show the account name, the paper badge, and the summed unrealized P/L colored by sign. Each row SHALL show the symbol, `qty @ $avg`, market value, and P/L formatted as `$1,234.00`. An account that fails SHALL contribute no rows, and a banner SHALL show the first error. The screen SHALL refresh when it gains focus and when the user taps refresh. Tapping a row SHALL open the chart. With no accounts it SHALL show "Add an account to start trading." and a link to Accounts.

#### Scenario: One account fails
- **WHEN** one of two accounts fails to load
- **THEN** the other account's positions are shown with an error banner

### Requirement: Orders screen
The Orders screen SHALL show only open orders, grouped by account, with an "N working" count per group. Each row SHALL show the symbol, the side and type, `size @ limit or stop`, and the status. Tapping a row SHALL open the chart. Error handling and the empty state SHALL match the Positions screen. Cancelling or modifying orders from this screen is not part of this change.

#### Scenario: Only open orders
- **WHEN** an account has one open and one filled order
- **THEN** only the open order is listed

### Requirement: Order entry form
Order entry SHALL offer:
- the account, defaulting to the one passed in and then to the active account;
- the symbol;
- the side: buy or sell;
- the size: quantity or notional;
- the type: market, limit, stop, stop-limit, or trailing stop;
- the limit price, stop price, or trail percent, shown only for the types that need them;
- the time in force: DAY, GTC, IOC, FOK, OPG, or CLS;
- extended hours on or off.

The request SHALL send the trimmed, uppercased symbol, and only the price fields the chosen type needs.

#### Scenario: Limit order fields
- **WHEN** the user builds a limit order
- **THEN** the request has a limit price and no stop price or trail percent

### Requirement: Order validation
Before review, the app SHALL reject an order with these messages:
- "Symbol is required." when the symbol is empty;
- "Quantity must be a positive number." or "Notional must be a positive number." when the size is invalid;
- "Limit price is required for limit orders." when a limit or stop-limit order has no limit price;
- "Stop price is required for stop orders." when a stop or stop-limit order has no stop price;
- "Trail percent is required for trailing stop orders." when a trailing stop has no trail percent.

The same validation SHALL run again on submit, in the backend.

#### Scenario: Missing limit price
- **WHEN** the user reviews a limit order without a limit price
- **THEN** "Limit price is required for limit orders." is shown and nothing is sent

### Requirement: Order review and submit
"Review Order" SHALL open a confirmation that shows the symbol, side, size, type, prices, time in force, and account, with Cancel and Submit. While the order is being sent, Submit SHALL read "Submitting…" and SHALL NOT accept a second press. On success the app SHALL show "Order submitted" and go back. With no account selected it SHALL show "Select an account." On failure it SHALL show the broker message, or "Failed to submit order."

#### Scenario: Double tap
- **WHEN** the user taps Submit twice quickly
- **THEN** only one order is sent

### Requirement: Exit a symbol
The Exit screen SHALL find every account that holds the symbol and propose one leg per account: a market DAY order on the opposite side for the absolute quantity. An account that fails to load SHALL be skipped. The title SHALL be "Go flat — N accounts". Each leg SHALL be editable: the type (market, limit, or stop), the quantity, and the price. "Exit all" SHALL send all pending legs in parallel, and each leg SHALL get its own result. If every leg succeeds, the app SHALL show "Flat — Exited N account(s)." and go back. Otherwise it SHALL list each failed account with its error. A later "Exit all" SHALL resend only the legs that failed. With no holdings the screen SHALL show "No open position." and Cancel. Exiting SHALL NOT contact fa-techan.

#### Scenario: Partial failure retry
- **WHEN** two of three legs succeed and the user taps "Exit all" again
- **THEN** only the failed leg is sent

#### Scenario: Short position
- **WHEN** an account is short 10 shares
- **THEN** its leg is a buy of 10 shares

### Requirement: Strategy tags and filter
Positions and orders SHALL be tagged by joining fa-techan strategy positions on `broker:account_id:symbol`, case-sensitive. Rows without a match SHALL be "Unattributed". The strategy filter SHALL list the strategies alphabetically with "Unattributed" last, and SHALL start at "All". Selecting an option while "All" is active SHALL select only that option. Selecting none or every option SHALL return to "All". The button SHALL read "Strategy: All", the single selected name, or "N strategies". Account groups SHALL keep their order when filtered.

#### Scenario: fa-techan unavailable
- **WHEN** strategy positions cannot be loaded
- **THEN** every row is "Unattributed"
