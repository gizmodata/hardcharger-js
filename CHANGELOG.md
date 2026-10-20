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
- Re-exported types `CancelReason`, `InvalidTokenReason`, `ServerInfo` and `TransactionState`.
- Tests: unit tests for the renamed and new codes and capabilities; live tests for server-info's
  keys, `execution_error` (422) on both submit paths, and a submit-time `statement_timeout` (409
  with `statementId` and `cancelReason`) on both paths; browser sign-in: unit tests for a failed
  flow's code without a status, a failed flow without a code, an unknown flow state and the
  sign-in timeout, and a live test that a provider's refusal is `access_denied`.

### Changed

- Built on warp-sql-js `4a27d4d`, the client for Warp SQL protocol 1.0.0 with browser sign-in (was
  `89e707c`).
- **Breaking:** the client's own error codes begin with `client_`, as the protocol now requires:
  the URL and `connect` refusals are `client_invalid_argument`
  (`HardchargerErrorCode.clientInvalidArgument`), and the re-exported codes are
  `client_transport_error`, `client_protocol_error`, `client_http_error` (new: an error answer
  without a problem document), `client_incomplete_stream`, `client_result_buffer_exceeded` and
  `client_connection_closed`. `client_certificate_required` is `certificate_required`. New server
  codes: `partition_not_found`, `internal_error`; a forgotten statement is `statement_not_found`.
- **Breaking:** `Capability.resultRetention` and `Capability.partitionedResults` are gone, and so
  is `DiscoveryDocument.draft`; `Capability.resultLocations` is new.
- A run-time failure is `execution_error` with status 422 (was 500), and a statement cancelled or
  timed out before its submit is answered is a 409 error carrying `statementId` and
  `cancelReason`. `invalid_token` is renewed only when its reason allows it (not after
  `token_revoked`, `credentials_changed` or `principal_dropped`). All from the Warp SQL client.
- `conn.metadata.serverInfo()` has the protocol's 1.0 keys (`server_name`, `server_version`,
  `server_arrow_version`, `server_read_only`, `sql_identifier_quote_char`,
  `sql_transactions_supported`) and Hardcharger's prefixed ones (`duckdb_version`,
  `hardcharger_instance_id`, `hardcharger_access_control`); `protocol` is no longer in it.
- Browser sign-in errors (warp-sql-js `4a27d4d`): a sign-in not completed in time is
  `client_sign_in_timeout` (was `statement_timeout`); a failed flow's error carries the flow's
  code (`access_denied`, `identity_provider_error`, `invalid_credentials`, ...) with no `status`
  (was 401); a failed flow without a code is `client_protocol_error`; a flow state the client
  doesn't know keeps polling. The README says so.

### Documentation

- The README banner is the new Hardcharger™ logo, the bull mascot lockup in a light and a dark
  version that follows the reader's color scheme, in place of the GizmoData banner card.

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
