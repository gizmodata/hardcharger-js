<p align="center">
  <a href="https://github.com/gizmodata/hardcharger">
    <img src="docs/assets/hardcharger-js-banner.svg" alt="Hardcharger JS: hardcharger:// from Node and browsers. By GizmoData." width="100%">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/npm-%40gizmodata%2Fhardcharger-cb3837.svg?logo=npm" alt="npm: @gizmodata/hardcharger">
  <img src="https://img.shields.io/badge/TypeScript-ESM%20%2B%20CJS-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript, ESM and CJS">
  <img src="https://img.shields.io/badge/Node-%E2%89%A522.19-339933.svg?logo=node.js&logoColor=white" alt="Node 22.19 or later">
  <img src="https://img.shields.io/badge/also-browsers%20%7C%20Deno%20%7C%20Bun%20%7C%20Workers-lightgrey.svg" alt="Browsers, Deno, Bun, Workers">
  <a href="https://github.com/gizmodata/warp-sql"><img src="https://img.shields.io/badge/protocol-Warp%20SQL-31a8db.svg" alt="Warp SQL protocol"></a>
  <a href="https://github.com/gizmodata/warp-sql-js"><img src="https://img.shields.io/badge/built%20on-Warp%20SQL%20JS-31a8db.svg" alt="Built on the Warp SQL JavaScript client"></a>
  <a href="https://github.com/gizmodata/hardcharger"><img src="https://img.shields.io/badge/server-Hardcharger-f15a24.svg" alt="Hardcharger"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-brightgreen.svg" alt="Apache 2.0 license"></a>
  <a href="https://gizmodata.com"><img src="https://img.shields.io/badge/by-GizmoData-f15a24.svg" alt="GizmoData"></a>
</p>

<h3 align="center">Query Hardcharger from JavaScript and TypeScript: <code>hardcharger://</code> URLs, Arrow back.</h3>

---

## 🔌 What is it?

The JavaScript/TypeScript client for [Hardcharger](https://github.com/gizmodata/hardcharger),
GizmoData's DuckDB 2.0 server. Hardcharger speaks [Warp SQL](https://github.com/gizmodata/warp-sql),
so this package is a thin layer on the [Warp SQL JavaScript client](https://github.com/gizmodata/warp-sql-js)
(`@gizmodata/warp-sql`), which it depends on and re-exports, the way
[adbc-driver-hardcharger](https://github.com/gizmodata/hardcharger-adbc) sits on the Warp SQL ADBC
driver and [hardcharger-jdbc](https://github.com/gizmodata/hardcharger-jdbc) on the Warp SQL JDBC
driver. It adds:

- 🏎️ **`hardcharger://` URLs**, with Hardcharger's port 31337 as the default, meaning exactly
  what they mean in the ADBC driver;
- 🪪 **`authType: "mtls"`**, the ADBC and JDBC drivers' name for client certificate sign-in;
- 🏷️ **Hardcharger names** for the Warp SQL client's classes (`HardchargerError`,
  `HardchargerConnection`, `HardchargerErrorCode`): the same objects, so `instanceof` works
  with either name.

Everything else, from Arrow results and bind parameters to split results, ingest,
transactions, cancel, TLS and client certificates, is the Warp SQL client's: Node, browsers,
Deno, Bun and Cloudflare Workers, no native code. Its whole API comes through this package,
so you never import `@gizmodata/warp-sql` yourself. For a Warp SQL server other than
Hardcharger, use `@gizmodata/warp-sql` directly.

> **Status: in development, unreleased (0.1.0).** Built on warp-sql-js `ef5e84c`; tested
> against `hardcharger-server` from Hardcharger's main branch. Not published to npm yet.

| Package                               | What it is                                                              |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `@gizmodata/hardcharger`              | this client: `hardcharger://` URLs, Hardcharger names, everything below |
| `@gizmodata/warp-sql`                 | the generic Warp SQL client it is built on, for any Warp SQL server     |
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

Not on npm yet. Until it is, build the package from this repository and install the tarball;
`@gizmodata/warp-sql` isn't on npm either, so install its tarball too (see
[Building and testing](#%EF%B8%8F-building-and-testing)):

```bash
npm install apache-arrow ./gizmodata-warp-sql-0.1.0.tgz ./gizmodata-hardcharger-0.1.0.tgz
```

Once both are published, this is `npm install @gizmodata/hardcharger apache-arrow`.

## 🔗 URLs

| URL                                     | Meaning                                           |
| --------------------------------------- | ------------------------------------------------- |
| `hardcharger://host`                    | HTTPS to `host:31337`                             |
| `hardcharger://host:port`               | HTTPS to another port                             |
| `hardcharger://host?tls=false`          | Plain HTTP (development, loopback)                |
| `hardcharger://host:port/custom/prefix` | The server mounts Warp SQL under `/custom/prefix` |
| `warp://…`, `https://…`, `http://…`     | The Warp SQL client's own spellings, as they are  |

`hardcharger://` means exactly what Warp SQL's `warp://` means, so TLS is on unless the URL says
`?tls=false` (or `tls=0`; `true` and `1` keep it on). These are the URLs the ADBC driver
accepts. Refused before anything is sent, each with an `invalid_argument` error that says why:

- `hardcharger+http://…` and every other `hardcharger+…` scheme: there is deliberately one
  spelling for plain HTTP, `?tls=false`, the same in every Hardcharger client;
- `jdbc:hardcharger://…`, and a `useEncryption` parameter (the JDBC driver's property): the
  message says to drop `jdbc:` and use `?tls=false`;
- credentials in the URL (pass `username` and `password`), any other URL parameter, a URL
  without a host or with a scheme the client doesn't know.

`toWarpUrl(url)` shows what a URL stands for (`hardcharger://db.example.com` →
`https://db.example.com:31337`), and `parseUrl(url)` the Warp SQL base URL the client calls
(`https://db.example.com:31337/warp`); both throw the errors above.

## ⚙️ Options

`connect` takes the Warp SQL client's options, with their defaults: one credential
(`username` and `password`, `token`, `tokenProvider`, `subjectToken` for SSO token exchange, or
`authType: "client_certificate"`), `tls` (`ca`, `cert`, `key`, `servername`, `skipVerify`;
Node, Deno and Bun), `catalog`, `schema`, `sessionOptions`, retries, and the statement
defaults (`resultPartitions`, 8 in Node and 4 in browsers; `resultOrder`, `async`,
`retainResult`, `statementTimeoutMs`, `queryTag`, `ipcCompression`). The
[Warp SQL client's README](https://github.com/gizmodata/warp-sql-js#-connecting) describes
each one. What differs:

| Option     | Here                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `url`      | also `hardcharger://` URLs (above)                                                                 |
| `authType` | also `"mtls"`, the same as `"client_certificate"` (as in the ADBC and JDBC drivers)                |
| `schemes`  | not taken: the URL schemes are this package's (use `@gizmodata/warp-sql` for schemes of your own)  |
| `logger`   | warnings (a session the server lost and the client replaced, say) are printed with `[hardcharger]` |

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
`unknown_certificate_identity`, `client_certificate_required`, `certificate_revoked`,
`certificate_mismatch` and `certificate_identity_mismatch`. In a browser the certificate is the
one the user picks from the browser's store, so there are no `tls` options; the
[Warp SQL client's README](https://github.com/gizmodata/warp-sql-js#-client-certificate-sign-in)
has the details.

## 🖥️ Browsers, Deno, Bun and Workers

One build serves every runtime: this layer has no platform-specific code, and it imports
`@gizmodata/warp-sql` by name, so your bundler or runtime picks that package's own build through
its export conditions (`node` for Node, Deno and Bun; `default` for browsers and edge runtimes).
The browser tests bundle this package with esbuild for the browser, check that the bundle holds
the Warp SQL client's browser build, and run it in Chromium and WebKit against a server that
allows the page's origin (`hardcharger-server --cors-origins https://app.example.com`), with the
same calls as in Node.

## 🧭 API

| Export                                                                                                                                        | What it is                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `connect(options)`                                                                                                                            | a `Connection` (`HardchargerConnection`): `query`, `stream`, `execute`, `prepare`, `ingest`, `metadata`, `transaction`, `close`, ... |
| `HardchargerError` (= `WarpSqlError`)                                                                                                         | every error the client raises: `code`, `status`, `sqlstate`, `detail`, `requestId`, ...                                              |
| `HardchargerErrorCode` (= `ErrorCode`)                                                                                                        | the codes, e.g. `HardchargerErrorCode.sqlError` is `"sql_error"`                                                                     |
| `toWarpUrl(url)`, `parseUrl(url)`, `scheme`, `defaultPort`                                                                                    | the URL translation above; `"hardcharger"`, `31337`                                                                                  |
| `version`                                                                                                                                     | this package's version                                                                                                               |
| `Connection`, `PreparedStatement`, `ResultStream`, `Metadata`, `Capability`, `WarpSqlError`, `ErrorCode`                                      | the Warp SQL client's, under their own names                                                                                         |
| types: `ConnectOptions`, `CallOptions`, `StatementOptions`, `IngestOptions`, `Parameters`, `TlsOptions`, `ColumnInfo`, `ProblemDocument`, ... | the Warp SQL client's types                                                                                                          |

The [Warp SQL client's API table](https://github.com/gizmodata/warp-sql-js#-api) describes
every method, and [How it behaves](https://github.com/gizmodata/warp-sql-js#-how-it-behaves)
the retries, split results, cancel and lost sessions.

## ⚠️ Errors

Every error is a `HardchargerError` with a stable `code`: the server's (`sql_error`,
`invalid_credentials`, `statement_cancelled`, `statement_timeout`, `permission_denied`, ...) or
one of the client's (`invalid_argument` before anything is sent, `transport_error` with no HTTP
answer, `connection_closed`, ...), with `status`, `sqlstate`, `detail` and `requestId` beside it.
`HardchargerError.is(err, "sql_error")` checks the class and the code at once. The live tests
assert each code this client meets: `sql_error` (400, with the SQLSTATE), `invalid_credentials`
(401), `statement_cancelled`, `statement_timeout`, `unknown_certificate_identity` (401),
`not_implemented`, `transport_error`, `invalid_argument` and `connection_closed`.

The class is the Warp SQL client's, under a Hardcharger name (its `name` stays
`"WarpSqlError"`): one class, so errors from anywhere in the client are `instanceof` both.

## 🛠️ Building and testing

Node 22.19 or later. `@gizmodata/warp-sql` isn't on npm yet, so it is built from
[gizmodata/warp-sql-js](https://github.com/gizmodata/warp-sql-js) at the commit pinned in
[scripts/warp-sql-js.commit](scripts/warp-sql-js.commit) and packed to `.warp-sql/`, where
`package-lock.json` finds it. `package.json`, and so the published package, names the npm
package and its range (`^0.1.0`); the tarball is a stand-in for development and CI only.

```bash
npm run warp-sql        # clone warp-sql-js (git access needed), build and pack the pinned commit
npm ci
npm run lint            # eslint (typed rules), prettier, and the lock's shape (scripts/check-lock.mjs)
npm run typecheck       # src, tests and configs
npm test                # unit tests (no server)
npm run build           # dist/: ESM, CJS and types
npm run check:package   # the packed package: this layer only, a few KB, publint, are-the-types-wrong
```

`HARDCHARGER_JS_WARP_SQL_REPO=/path/to/warp-sql-js npm run warp-sql` builds from a local
checkout. TypeScript stays on 6.0: typescript-eslint and the declaration build need the
TypeScript compiler API, which TypeScript 7 doesn't ship.

The live suites start `hardcharger-server` themselves, on free loopback ports (and one on
31337, to prove a URL without a port reaches it), with a fresh administrator password that
contains `:` and `@`, an empty home directory (DuckDB's secrets directory included), and only
`PATH`, `HOME`, `TMPDIR` and the password in its environment. Without the binary they fail;
they never skip, and a run in which no test reached a server fails too.

```bash
export HARDCHARGER_JS_TEST_SERVER_BINARY=/path/to/hardcharger-server
npm run test:live       # Node (vitest): sign-in, queries, parameters, split results, ingest,
                        # transactions, cancel, certificate sign-in, error codes
npm run build && npx playwright install chromium webkit && npm run test:browser
npm run build && npm run test:examples   # this README's examples, on port 31337
```

Negative tests assert the error code, each beside a positive twin. CI runs everything against
the image of Hardcharger's main branch (`ghcr.io/gizmodata/hardcharger:main`, private), pulled
with the workflow's `GITHUB_TOKEN`; the package must grant this repository read access
(package settings, "Manage Actions access"), or the live jobs fail. While warp-sql-js is
internal, CI clones it with `DEPLOY_KEY_WARP_SQL_JS`, a read-only deploy key of that repository.

## 📦 Releasing

Releases follow [semantic versioning](https://semver.org) and [CHANGELOG.md](CHANGELOG.md):
update both and `package.json`'s version, commit, and push `main` and `vX.Y.Z` together.
`release.yml` runs the full CI on the tagged commit, then makes a GitHub Release with the
package tarball and the CHANGELOG section, then (once enabled) publishes to npm with trusted
publishing (OIDC, no stored token). Publishing is off until `@gizmodata/warp-sql` is on npm,
GizmoData sets up `@gizmodata/hardcharger` there with this repository's `release.yml`
(environment `npm`) as its trusted publisher, and the repository variable
`NPM_PUBLISH_ENABLED` is `true`. `npm publish` from a laptop refuses to run.

## 📄 License

[Apache License 2.0](LICENSE).

---

<p align="center">
  <a href="https://gizmodata.com"><img src="docs/assets/gizmodata-logo.png" alt="GizmoData" width="56"></a><br>
  <sub>Built by <a href="https://gizmodata.com">GizmoData</a></sub>
</p>
