# Vendored TA-Lib

- Upstream: https://github.com/TA-Lib/ta-lib
- Release: v0.6.4, `ta-lib-0.6.4-src.tar.gz`
- sha256 of the tarball: `aa04066d17d69c73b1baaef0883414d3d56ab3775872d82916d1cdb376a3ae86`
- Why 0.6.4: fa-techan pins the Python `ta-lib` 0.6.8 wheel (`uv.lock`), which
  is built on TA-Lib C 0.6.4. The same C library gives identical indicator output.
- Copied unchanged: `include/` (minus `ta_config.h.in`), `src/ta_common/*.{c,h}`,
  `src/ta_func/*.{c,h}`. Not copied: autotools files, `src/ta_abstract`, `src/tools`.
- License: BSD 3-clause, see `LICENSE` (copied from the file headers).
