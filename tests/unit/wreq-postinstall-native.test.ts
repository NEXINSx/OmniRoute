import assert from "node:assert/strict";
import test from "node:test";

import {
  WREQ_JS_NATIVE_BINARY_NAMES,
  resolveWreqJsNativeBinaryName,
} from "../../scripts/build/wreqJsNative.mjs";

test("wreq-js 3.0.0 resolver covers every shipped native addon name", () => {
  assert.deepEqual([...WREQ_JS_NATIVE_BINARY_NAMES].sort(), [
    "wreq-js.darwin-arm64.node",
    "wreq-js.darwin-x64.node",
    "wreq-js.linux-arm64-gnu.node",
    "wreq-js.linux-arm64-musl.node",
    "wreq-js.linux-x64-gnu.node",
    "wreq-js.linux-x64-musl.node",
    "wreq-js.win32-x64-msvc.node",
  ]);
  assert.equal(
    resolveWreqJsNativeBinaryName({ platform: "darwin", arch: "arm64" }),
    "wreq-js.darwin-arm64.node"
  );
  assert.equal(
    resolveWreqJsNativeBinaryName({ platform: "darwin", arch: "x64" }),
    "wreq-js.darwin-x64.node"
  );
  assert.equal(
    resolveWreqJsNativeBinaryName({ platform: "linux", arch: "arm64", libc: "gnu" }),
    "wreq-js.linux-arm64-gnu.node"
  );
  assert.equal(
    resolveWreqJsNativeBinaryName({ platform: "linux", arch: "arm64", libc: "musl" }),
    "wreq-js.linux-arm64-musl.node"
  );
  assert.equal(
    resolveWreqJsNativeBinaryName({ platform: "linux", arch: "x64", libc: "gnu" }),
    "wreq-js.linux-x64-gnu.node"
  );
  assert.equal(
    resolveWreqJsNativeBinaryName({ platform: "linux", arch: "x64", libc: "musl" }),
    "wreq-js.linux-x64-musl.node"
  );
  assert.equal(
    resolveWreqJsNativeBinaryName({ platform: "win32", arch: "x64" }),
    "wreq-js.win32-x64-msvc.node"
  );
  assert.equal(resolveWreqJsNativeBinaryName({ platform: "win32", arch: "arm64" }), null);
  assert.equal(resolveWreqJsNativeBinaryName({ platform: "android", arch: "arm64" }), null);
});
