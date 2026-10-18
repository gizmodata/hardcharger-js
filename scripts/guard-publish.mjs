// npm runs this before `npm publish`. Publishing happens only from the release workflow
// (trusted publishing, gated on the full test suite), which sets HARDCHARGER_JS_RELEASE=1.
if (process.env.HARDCHARGER_JS_RELEASE !== "1") {
  console.error("Refusing to publish: @gizmodata/hardcharger is published only by .github/workflows/release.yml.");
  process.exit(1);
}
