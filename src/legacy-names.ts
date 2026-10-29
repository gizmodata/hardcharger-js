// Licensed under the Apache License, Version 2.0.
//
// Names this package exported before the protocol was renamed to Chargewire, kept so that
// code written against them still compiles and runs. Each one is the current object or type
// under its old name. This module and its tests are the only places the old spelling is
// written down. URLs from before the rename (the old scheme, the old base path, and servers
// that still speak the old spelling) are the Chargewire client's to handle, and it does.

import { ChargewireError, type ChargewireErrorInit } from "@gizmodata/chargewire";

/** @deprecated Use `HardchargerError` (or `ChargewireError`): the same class. */
export const WarpSqlError = ChargewireError;
/** @deprecated Use `HardchargerError` (or `ChargewireError`): the same class. */
export type WarpSqlError = ChargewireError;

/** @deprecated Use `ChargewireErrorInit`. */
export type WarpSqlErrorInit = ChargewireErrorInit;
