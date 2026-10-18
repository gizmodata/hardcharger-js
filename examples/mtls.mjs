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
