//! ta-droid core: domain logic and backend clients, independent of Tauri so it
//! is tested with plain `cargo test`.

pub mod accounts;
pub mod config;
pub mod indicators;
pub mod keys;
pub mod net;
pub mod profiles;
pub mod store;
