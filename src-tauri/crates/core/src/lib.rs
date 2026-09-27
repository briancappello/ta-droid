//! ta-droid core: domain logic and backend clients, independent of Tauri so it
//! is tested with plain `cargo test`.

pub mod accounts;
pub mod broker;
pub mod config;
pub mod indicators;
pub mod keys;
pub mod marketstore;
pub mod net;
pub mod profiles;
pub mod store;
pub mod stream;
pub mod watchlists;
