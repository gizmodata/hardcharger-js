# Changelog

All notable changes to `@gizmodata/hardcharger` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Browser sign-in (warp-sql spec §4.3): `authType: "external"` (or `"oauth_browser"`) with
  `openUrl` signs in with the server's identity provider through a browser, on the server's main
  port. `startBrowserSignIn`, `pollBrowserSignIn`, `browserSignIn`, `beginBrowserRedirectSignIn`
  and `completeBrowserRedirectSignIn` take `hardcharger://` URLs; `browserSignInProvider`,
  `takeBrowserSignInFlowId` and the new error codes come from the Warp SQL client. Unit tests (5)
  and live tests (2) against `hardcharger-server --oauth-client-id` with a mock OpenID Connect
  provider (`test/live/idp.ts`).

### Changed

- Built on warp-sql-js `89e707c` (browser sign-in).

## [0.1.0] - unreleased

### Added

- `@gizmodata/hardcharger`, the JavaScript/TypeScript client for Hardcharger: a thin layer on
  the Warp SQL client `@gizmodata/warp-sql` (a dependency, `^0.1.0`; built from warp-sql-js
  `6dea14c` until it is on npm), for Node 22.19+, browsers, Deno, Bun and edge runtimes, as ESM
  and CJS.
- `connect({ url: "hardcharger://host[:port][/prefix][?tls=false]", ... })`: HTTPS to port 31337
  unless the URL says otherwise, as in the Hardcharger ADBC driver; `warp://`, `https://` and
  `http://` URLs pass through. `hardcharger+http://` and other `hardcharger+…` schemes, JDBC URLs,
  `useEncryption`, credentials and unknown parameters are refused before anything is sent, with
  `invalid_argument` errors that say what to write instead. `parseUrl` shows what a URL stands
  for. The Warp SQL client parses the URL (`schemes`), so an explicit port is kept, `:443` on
  plain HTTP included (warp-sql-js `3578476`).
- `authType: "mtls"`, the ADBC and JDBC drivers' name for `"client_certificate"` (client
  certificate sign-in).
- The Warp SQL client's whole API, re-exported, with Hardcharger names for its classes:
  `HardchargerError` (= `WarpSqlError`), `HardchargerErrorCode` (= `ErrorCode`) and
  `HardchargerConnection` (= `Connection`).
- Tests: unit tests for every URL form; live tests against `hardcharger-server` (password and
  client certificate sign-in, queries, bind parameters, split results, ingest, transactions,
  cancel, the default port, error codes); the built package in Chromium and WebKit; the
  README's examples, installed from the packed tarball. CI on Node 22, 24 and 26, and a release
  workflow that runs it all on the tagged commit before a GitHub Release (npm publishing
  prepared, off).
