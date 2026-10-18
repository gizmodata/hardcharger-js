// The page's script: the built package (dist/, as it ships) and Apache Arrow, on globalThis.
import { tableFromArrays } from "apache-arrow";

import * as hardcharger from "../../dist/index.mjs";

globalThis.hardcharger = { ...hardcharger, tableFromArrays };
document.getElementById("status").textContent = "ready";
