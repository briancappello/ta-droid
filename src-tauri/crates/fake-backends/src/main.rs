//! `fake-backends [--addr 127.0.0.1:8787] [--log requests.jsonl]`

use std::path::PathBuf;

use fake_backends::FakeState;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let mut addr = String::from("127.0.0.1:8787");
    let mut log: Option<PathBuf> = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--addr" => addr = args.next().expect("--addr needs a value"),
            "--log" => log = Some(args.next().expect("--log needs a value").into()),
            other => panic!("unknown argument: {other}"),
        }
    }
    let state = log.map(FakeState::with_log_file).unwrap_or_default();
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    eprintln!(
        "fake-backends listening on http://{}",
        listener.local_addr()?
    );
    tokio::select! {
        r = fake_backends::serve(listener, state) => r,
        _ = tokio::signal::ctrl_c() => Ok(()),
    }
}
