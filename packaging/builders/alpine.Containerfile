# Builds the Linux app for postmarketOS (musl). Matches the Alpine release
# under the pmOS test VM (v26.06 -> Alpine 3.24). Native on x86_64; for the
# one-time aarch64 phone package, build with --platform linux/arm64 (qemu-user).
FROM docker.io/library/alpine:3.24
RUN apk add --no-cache build-base curl pkgconf perl \
      webkit2gtk-4.1-dev gtk+3.0-dev libsoup3-dev openssl-dev \
      librsvg-dev libayatana-appindicator-dev dbus-dev abuild
ARG RUST_VERSION=1.96.0
ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:$PATH
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal \
      --default-toolchain "$RUST_VERSION" --no-modify-path
# rustup's musl toolchain links statically by default; GTK and WebKit are
# shared system libraries, so link dynamically like Alpine's own rust.
ENV RUSTFLAGS="-C target-feature=-crt-static"
WORKDIR /src
