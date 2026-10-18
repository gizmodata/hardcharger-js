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
