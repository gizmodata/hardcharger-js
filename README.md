<p align="center">
  <a href="https://github.com/gizmodata/hardcharger">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/hardcharger-banner-dark.png">
      <img src="docs/assets/hardcharger-banner-light.png" alt="Hardcharger™" width="400">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@gizmodata/hardcharger"><img src="https://img.shields.io/npm/v/%40gizmodata%2Fhardcharger?logo=npm" alt="npm: @gizmodata/hardcharger version"></a>
  <a href="https://www.typescriptlang.org/docs/"><img src="https://img.shields.io/badge/TypeScript-ESM%20%2B%20CJS-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript, ESM and CJS"></a>
  <a href="https://nodejs.org/en/download"><img src="https://img.shields.io/node/v/%40gizmodata%2Fhardcharger?logo=node.js&logoColor=white" alt="Supported Node.js versions"></a>
  <a href="https://docs.hardcharger.gizmodata.com/clients/javascript/#in-the-browser"><img src="https://img.shields.io/badge/also-browsers%20%7C%20Deno%20%7C%20Bun%20%7C%20Workers-lightgrey.svg" alt="Browsers, Deno, Bun, Workers"></a>
  <a href="https://github.com/gizmodata/chargewire"><img src="https://img.shields.io/badge/protocol-Chargewire%201.0.0-31a8db.svg" alt="Chargewire protocol"></a>
  <a href="https://github.com/gizmodata/chargewire-js"><img src="https://img.shields.io/badge/built%20on-Chargewire%20JS-31a8db.svg" alt="Built on the Chargewire JavaScript client"></a>
  <a href="https://github.com/gizmodata/hardcharger"><img src="https://img.shields.io/badge/server-Hardcharger-f15a24.svg" alt="Hardcharger"></a>
  <a href="https://github.com/gizmodata/hardcharger-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-brightgreen.svg" alt="Apache 2.0 license"></a>
  <a href="https://gizmodata.com"><img src="https://img.shields.io/badge/by-GizmoData%E2%84%A2-f15a24.svg" alt="GizmoData™"></a>
</p>

<h3 align="center">Query Hardcharger™ from JavaScript and TypeScript: <code>hardcharger://</code> URLs, Arrow back.</h3>

---

## 🔌 What is it?

The JavaScript/TypeScript client for [Hardcharger™](https://github.com/gizmodata/hardcharger),
GizmoData™'s DuckDB 2.0 server. Hardcharger speaks [Chargewire](https://github.com/gizmodata/chargewire),
so this package is a thin layer on the [Chargewire JavaScript client](https://github.com/gizmodata/chargewire-js)
(`@gizmodata/chargewire`), which it depends on and re-exports, the way
[adbc-driver-hardcharger](https://github.com/gizmodata/hardcharger-adbc) sits on the Chargewire ADBC
driver and [hardcharger-jdbc](https://github.com/gizmodata/hardcharger-jdbc) on the Chargewire JDBC
driver. It adds:

- 🏎️ **`hardcharger://` URLs**, with Hardcharger's port 31337 as the default, meaning exactly
  what they mean in the ADBC driver;
- 🪪 **`authType: "mtls"`**, the ADBC and JDBC drivers' name for client certificate sign-in;
- 🏷️ **Hardcharger names** for the Chargewire client's classes (`HardchargerError`,
  `HardchargerConnection`, `HardchargerErrorCode`): the same objects, so `instanceof` works
  with either name.

Everything else, from Arrow results and bind parameters to split results, ingest,
transactions, cancel, TLS and client certificates, is the Chargewire client's: Node, browsers,
Deno, Bun and Cloudflare Workers, no native code. Its whole API comes through this package,
so you never import `@gizmodata/chargewire` yourself. For a Chargewire server other than
Hardcharger, use `@gizmodata/chargewire` directly.

> **Status: 2.0.2, with Hardcharger 2.0.0.** Built on `@gizmodata/chargewire` 1.0.0 (chargewire-js
> `1227155`, Chargewire protocol 1.0.0); tested against `hardcharger-server` from Hardcharger's main
> branch.

| Package                               | What it is                                                              |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `@gizmodata/hardcharger`              | this client: `hardcharger://` URLs, Hardcharger names, everything below |
| `@gizmodata/chargewire`               | the generic Chargewire client it is built on, for any Chargewire server |
| `pip install adbc-driver-hardcharger` | the ADBC driver: Python, C/C++, Go, R, Rust                             |
| `hardcharger-jdbc`                    | the JDBC driver: Java, DBeaver and other JDBC tools                     |

## 🚀 Quick start

Start a server (the [Hardcharger README](https://github.com/gizmodata/hardcharger) has
Docker and the installers):

```bash
HARDCHARGER_ADMIN_PASSWORD=change-me hardcharger-server
```

Then, from [examples/quickstart.mjs](examples/quickstart.mjs):

```js
import { tableFromArrays } from "apache-arrow";
import { HardchargerError, connect } from "@gizmodata/hardcharger";

const conn = await connect({
  url: "hardcharger://localhost?tls=false",
  username: "hardcharger",
  password: "change-me",
});

// A query, with bind parameters: an Arrow Table back.
const table = await conn.query("SELECT 42 AS answer, ?::VARCHAR AS greeting", ["hello"]);
console.log(table.toArray().map((row) => row.toJSON()));

// A big result, read in several partitions at once.
let rows = 0;
for await (const batch of conn.stream("SELECT * FROM range(10000000)")) rows += batch.numRows;
console.log(`streamed ${rows} rows`);

// Bulk ingest from Arrow, then a transaction (it rolls back if the function throws).
await conn.ingest("events", tableFromArrays({ id: Int32Array.from([1, 2, 3]) }), { mode: "replace" });
await conn.transaction(async (tx) => {
  await tx.execute("DELETE FROM events WHERE id = ?", [1]);
});
console.log((await conn.query("SELECT count(*) AS n FROM events")).get(0).toJSON());

// Errors carry the server's code; an AbortSignal cancels the statement on the server.
try {
  await conn.query("SELECT count(*) FROM range(1000000000000)", undefined, { signal: AbortSignal.timeout(1000) });
} catch (err) {
  if (!(err instanceof HardchargerError)) throw err;
  console.log(`${err.code}: ${err.message}`);
}

await conn.close();
```

```text
[ { answer: 42, greeting: 'hello' } ]
streamed 10000000 rows
{ n: 2n }
statement_timeout: the operation timed out (its AbortSignal fired)
```

`import * as hardcharger from "@gizmodata/hardcharger"` reads like the Python driver's
`from adbc_driver_hardcharger import dbapi as hardcharger`: `hardcharger.connect({ url, ... })`.
Results are [Apache Arrow](https://arrow.apache.org/docs/js/) Tables and RecordBatches, so
`apache-arrow` (21.2 or later) is a peer dependency: install it beside this package.

## 📦 Installing

```bash
npm install @gizmodata/hardcharger apache-arrow
```

`@gizmodata/chargewire` comes with it; `apache-arrow` (21.2 or later) is a peer dependency, so your
application and the client share one copy of Arrow's classes.

## 🔗 URLs

| URL                                       | Meaning                                             |
| ----------------------------------------- | --------------------------------------------------- |
| `hardcharger://host`                      | HTTPS to `host:31337`                               |
| `hardcharger://host:port`                 | HTTPS to another port                               |
| `hardcharger://host?tls=false`            | Plain HTTP (development, loopback)                  |
| `hardcharger://host:port/custom/prefix`   | The server mounts Chargewire under `/custom/prefix` |
| `chargewire://…`, `https://…`, `http://…` | The Chargewire client's own spellings, as they are  |

`hardcharger://` means exactly what Chargewire's `chargewire://` means, so TLS is on unless the URL says
`?tls=false` (or `tls=0`; `true` and `1` keep it on). These are the URLs the ADBC driver
accepts. Refused before anything is sent, each with a `client_invalid_argument` error that says why:

- `hardcharger+http://…` and every other `hardcharger+…` scheme: there is deliberately one
  spelling for plain HTTP, `?tls=false`, the same in every Hardcharger client;
- `jdbc:hardcharger://…`, and a `useEncryption` parameter (the JDBC driver's property): the
  message says to drop `jdbc:` and use `?tls=false`;
- credentials in the URL (pass `username` and `password`), any other URL parameter, a URL
  without a host or with a scheme the client doesn't know.

`parseUrl(url)` shows the Chargewire base URL a URL stands for (`hardcharger://db.example.com` →
`https://db.example.com:31337/chargewire`) and throws the errors above; `schemes` is the scheme map
`connect` hands the Chargewire client, which does the parsing.

## ⚙️ Options

`connect` takes the Chargewire client's options, with their defaults: one credential
(`username` and `password`, `token`, `tokenProvider`, `subjectToken` for SSO token exchange, or
`authType: "client_certificate"`), `tls` (`ca`, `cert`, `key`, `servername`, `skipVerify`;
Node, Deno and Bun), `catalog`, `schema`, `sessionOptions`, retries, and the statement
defaults (`resultPartitions`, 8 in Node and 4 in browsers; `resultOrder`, `async`,
`retainResult`, `statementTimeoutMs`, `queryTag`, `ipcCompression`). The
[Chargewire client's README](https://github.com/gizmodata/chargewire-js#-connecting) describes
each one. What differs:

| Option     | Here                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `url`      | also `hardcharger://` URLs (above)                                                                                                   |
| `authType` | also `"mtls"`, the same as `"client_certificate"`, and `"external"`, the same as `"oauth_browser"` (as in the ADBC and JDBC drivers) |
| `schemes`  | not taken: the URL schemes are this package's (use `@gizmodata/chargewire` for schemes of your own)                                  |
| `logger`   | warnings (a session the server lost and the client replaced, say) are printed with `[hardcharger]`                                   |

## 🪪 Client certificate sign-in (mutual TLS)

When the server verifies client certificates and lets them sign in, the certificate is the
credential: no user name or password.

```bash
HARDCHARGER_ADMIN_PASSWORD=change-me hardcharger-server --tls-cert server.pem --tls-key server-key.pem \
  --mtls-ca-cert client-ca.pem --mtls-certificate-sign-in --mtls-admin-identities ops@example.com
```

From [examples/mtls.mjs](examples/mtls.mjs):

```js
import { readFileSync } from "node:fs";

import { connect } from "@gizmodata/hardcharger";

const conn = await connect({
  url: "hardcharger://localhost",
  authType: "client_certificate",
  tls: {
    ca: readFileSync("server-ca.pem", "utf8"), // when the server's CA is private
    cert: readFileSync("client.pem", "utf8"),
    key: readFileSync("client-key.pem", "utf8"),
  },
});
console.log((await conn.query("SELECT HARDCHARGER_USER() AS who")).getChild("who").get(0));
await conn.close();
```

```text
ops@example.com
```

The identity is the certificate's e-mail SAN unless the server says otherwise
(`--mtls-identity-source`); it must be one of `--mtls-admin-identities` or, under access
control, a user of the store. The token the server issues is bound to the certificate, and
every connection the client opens (the partitions of a split result, uploads) presents it. The
client refuses a user name, password or token beside it, a missing `tls.cert` or `tls.key`, and
a plain-HTTP URL before sending anything, and a server that doesn't offer certificate sign-in
with `not_implemented`. The server's refusals keep their codes, each with HTTP 401:
`unknown_certificate_identity`, `certificate_required`, `certificate_revoked`,
`certificate_mismatch` and `certificate_identity_mismatch`. In a browser the certificate is the
one the user picks from the browser's store, so there are no `tls` options; the
[Chargewire client's README](https://github.com/gizmodata/chargewire-js#-client-certificate-sign-in)
has the details.

## 🌐 Browser sign-in (SSO)

When hardcharger-server signs people in with an identity provider (`--oauth-client-id`,
`--oauth-client-secret`, the provider in `--token-allowed-issuer`), `authType: "external"`
signs in as yourself in a browser. `openUrl` opens (or shows) the sign-in URL; the server
completes the sign-in with the provider and the client collects Hardcharger's own access token.

```ts
import { exec } from "node:child_process";
import { connect } from "@gizmodata/hardcharger";

const conn = await connect({
  url: "hardcharger://db.example.com",
  authType: "external",
  openUrl: (url) => void exec(`open ${JSON.stringify(url)}`),
});
```

The steps (`startBrowserSignIn`, `pollBrowserSignIn`, `browserSignIn`) and the helpers for web
pages that come back to themselves (`beginBrowserRedirectSignIn`, `completeBrowserRedirectSignIn`)
are the Chargewire client's, taking `hardcharger://` URLs here; see its
[README](https://github.com/gizmodata/chargewire-js#-browser-sign-in-sso). The server's sign-in
lives on its main port; there is no separate sign-in port.

A failed sign-in throws the flow's code (`access_denied` when the person or the provider refused,
`identity_provider_error`, `invalid_credentials` for a user the server doesn't allow), with no
HTTP `status`: decide on `code`. A wrong or used-up flow is `flow_not_found`, and a sign-in not
completed within `browserSignInTimeoutMs` (`timeoutMs` for `browserSignIn`) is
`client_sign_in_timeout`.

## 🖥️ Browsers, Deno, Bun and Workers

One build serves every runtime: this layer has no platform-specific code, and it imports
`@gizmodata/chargewire` by name, so your bundler or runtime picks that package's own build through
its export conditions (`node` for Node, Deno and Bun; `default` for browsers and edge runtimes).
The browser tests bundle this package with esbuild for the browser, check that the bundle holds
the Chargewire client's browser build, and run it in Chromium and WebKit against a server that
allows the page's origin (`hardcharger-server --cors-origins https://app.example.com`), with the
same calls as in Node.

## 🧭 API

| Export                                                                                                                                        | What it is                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `connect(options)`                                                                                                                            | a `Connection` (`HardchargerConnection`): `query`, `stream`, `execute`, `prepare`, `ingest`, `metadata`, `transaction`, `close`, ... |
| `HardchargerError` (= `ChargewireError`)                                                                                                      | every error the client raises: `code`, `status`, `sqlstate`, `detail`, `requestId`, ...                                              |
| `HardchargerErrorCode` (= `ErrorCode`)                                                                                                        | the codes, e.g. `HardchargerErrorCode.sqlError` is `"sql_error"`                                                                     |
| `parseUrl(url)`, `schemes`, `scheme`, `defaultPort`                                                                                           | the URL translation above; `"hardcharger"`, `31337`                                                                                  |
| `version`                                                                                                                                     | this package's version                                                                                                               |
| `Connection`, `PreparedStatement`, `ResultStream`, `Metadata`, `Capability`, `ChargewireError`, `ErrorCode`                                   | the Chargewire client's, under their own names                                                                                       |
| types: `ConnectOptions`, `CallOptions`, `StatementOptions`, `IngestOptions`, `Parameters`, `TlsOptions`, `ColumnInfo`, `ProblemDocument`, ... | the Chargewire client's types                                                                                                        |

The [Chargewire client's API table](https://github.com/gizmodata/chargewire-js#-api) describes
every method, and [How it behaves](https://github.com/gizmodata/chargewire-js#-how-it-behaves)
the retries, split results, cancel and lost sessions.

## ⚠️ Errors

Every error is a `HardchargerError` with a stable `code`: the server's (`sql_error`,
`invalid_credentials`, `statement_cancelled`, `statement_timeout`, `permission_denied`, ...) or
one of the client's, which begin with `client_` (`client_invalid_argument` before anything is
sent, `client_transport_error` with no HTTP answer, `client_http_error` for an error answer without
a problem document, `client_connection_closed`, ...), with `status`, `sqlstate`, `detail`,
`requestId`, `statementId`, `reason` and `cancelReason` beside it. Decide on `code`, never on the
message. A statement that fails at run time is `execution_error` (422); one cancelled or timed out
before its submit is answered is `statement_cancelled` or `statement_timeout` (409, with
`statementId` and `cancelReason`).
`HardchargerError.is(err, "sql_error")` checks the class and the code at once. The live tests
assert each code this client meets: `sql_error` (400, with the SQLSTATE), `invalid_credentials`
(401), `statement_cancelled`, `statement_timeout`, `unknown_certificate_identity` (401),
`not_implemented`, `execution_error` (422), `client_transport_error`, `client_invalid_argument` and
`client_connection_closed`.

The class is the Chargewire client's, under a Hardcharger name (its `name` stays
`"ChargewireError"`): one class, so errors from anywhere in the client are `instanceof` both.

## 🛠️ Building and testing

Node 22.19 or later. For development and CI, `@gizmodata/chargewire` is built from
[gizmodata/chargewire-js](https://github.com/gizmodata/chargewire-js) at the commit pinned in
[scripts/chargewire-js.commit](scripts/chargewire-js.commit) and packed to `.chargewire/`, where
`package-lock.json` finds it, so the tests run against that exact client. `package.json`, and so
the published package, names the npm package and its range (`^1.0.0`); the tarball is a stand-in
for development and CI only.

```bash
npm run chargewire      # clone chargewire-js (git access needed), build and pack the pinned commit
npm ci
npm run lint            # eslint (typed rules), prettier, and the lock's shape (scripts/check-lock.mjs)
npm run typecheck       # src, tests and configs
npm test                # unit tests (no server)
npm run build           # dist/: ESM, CJS and types
npm run check:package   # the packed package: this layer only, a few KB, publint, are-the-types-wrong
```

`HARDCHARGER_JS_CHARGEWIRE_REPO=/path/to/chargewire-js npm run chargewire` builds from a local
checkout. TypeScript stays on 6.0: typescript-eslint and the declaration build need the
TypeScript compiler API, which TypeScript 7 doesn't ship.

The live suites start `hardcharger-server` themselves, on free loopback ports (and one on
31337, to prove a URL without a port reaches it), with a fresh administrator password that
contains `:` and `@`, an empty home directory (DuckDB's secrets directory included), and only
`PATH`, `HOME`, `TMPDIR` and the password in its environment. Without the binary they fail;
they never skip, and a run in which no test reached a server fails too. The live suite also
checks a Hardcharger released before the protocol was renamed to Chargewire (the
`ghcr.io/gizmodata/hardcharger:2.2.0` image, already running, plain HTTP) when
`HARDCHARGER_JS_TEST_OLD_SERVER` names it (`host:port`, with
`HARDCHARGER_JS_TEST_OLD_SERVER_PASSWORD`); CI starts one, and there those tests fail without it.

```bash
export HARDCHARGER_JS_TEST_SERVER_BINARY=/path/to/hardcharger-server
npm run test:live       # Node (vitest): sign-in, queries, parameters, split results, ingest,
                        # transactions, cancel, certificate sign-in, error codes
npm run build && npx playwright install chromium webkit && npm run test:browser
npm run build && npm run test:examples   # this README's examples, on port 31337
```

Negative tests assert the error code, each beside a positive twin. CI runs everything against
the image of Hardcharger's main branch (`ghcr.io/gizmodata/hardcharger:main`), pulled with the
workflow's `GITHUB_TOKEN`; while the image is private the package must grant this repository
read access (package settings, "Manage Actions access"), or the live jobs fail. CI clones
chargewire-js with `DEPLOY_KEY_CHARGEWIRE_JS`, a read-only deploy key of that repository (needed
while it is private).

## 📦 Releasing

Releases follow [semantic versioning](https://semver.org) and [CHANGELOG.md](CHANGELOG.md):
update both and `package.json`'s version, commit, and push `main` and `vX.Y.Z` together.
`release.yml` runs the full CI on the tagged commit, then makes a GitHub Release with the
package tarball and the CHANGELOG section, then publishes to npm (public) with trusted
publishing (OIDC, no stored token) when the repository variable `NPM_PUBLISH_ENABLED` is `true`.
The npm job first checks that `@gizmodata/chargewire` is on npm in the range `package.json` names;
on npmjs.com, `@gizmodata/hardcharger`'s trusted publisher is this repository's `release.yml`
(environment `npm`). `npm publish` from a laptop refuses to run.

## 📄 License

[Apache License 2.0](LICENSE).

---

<p align="center">
  <a href="https://gizmodata.com"><img src="docs/assets/gizmodata-logo.png" alt="GizmoData™" width="56"></a><br>
  <sub>Built by <a href="https://gizmodata.com">GizmoData™</a></sub><br>
  <sub>Hardcharger™ and GizmoData™ are trademarks of GizmoData LLC.</sub>
</p>
