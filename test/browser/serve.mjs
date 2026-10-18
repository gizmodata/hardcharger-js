// Serves a blank page with the built package bundled for the browser. Fails if the bundle
// holds the Warp SQL client's Node build (undici) instead of its browser build.
import { createServer } from "node:http";

import { build } from "esbuild";

const port = Number(process.env.HARDCHARGER_JS_TEST_PAGE_PORT ?? 5174);
const bundle = await build({
  entryPoints: [new URL("entry.mjs", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2023",
  write: false,
  metafile: true,
});
const inputs = Object.keys(bundle.metafile.inputs);
if (inputs.some((path) => path.includes("node_modules/undici/"))) {
  console.error("the browser bundle holds undici: @gizmodata/warp-sql's Node build was picked");
  process.exit(1);
}
if (!inputs.some((path) => path.includes("node_modules/@gizmodata/warp-sql/dist/web/"))) {
  console.error("the browser bundle does not hold @gizmodata/warp-sql's browser build (dist/web)");
  process.exit(1);
}
const script = bundle.outputFiles[0].contents;
const page = `<!doctype html><meta charset="utf-8"><title>hardcharger-js</title><p id="status">loading</p><script type="module" src="/main.js"></script>`;

createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (path === "/") res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
  else if (path === "/main.js") res.writeHead(200, { "content-type": "text/javascript" }).end(script);
  else res.writeHead(404).end();
}).listen(port, "127.0.0.1", () => {
  console.log(`test page on http://127.0.0.1:${port} (${Math.round(script.byteLength / 1024)} KiB script)`);
});
