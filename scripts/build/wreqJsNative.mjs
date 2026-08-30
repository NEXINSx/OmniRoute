/** Exact native-addon layout published by wreq-js 3.0.0. */
export const WREQ_JS_NATIVE_BINARY_NAMES = Object.freeze([
  "wreq-js.darwin-arm64.node",
  "wreq-js.darwin-x64.node",
  "wreq-js.linux-arm64-gnu.node",
  "wreq-js.linux-arm64-musl.node",
  "wreq-js.linux-x64-gnu.node",
  "wreq-js.linux-x64-musl.node",
  "wreq-js.win32-x64-msvc.node",
]);

/** Detect the C library used by the current Linux runtime. */
export function detectRuntimeLibc() {
  if (process.platform !== "linux") return undefined;
  try {
    const report = process.report?.getReport();
    return report?.header?.glibcVersionRuntime ? "gnu" : "musl";
  } catch {
    return "musl";
  }
}

/** Resolve the exact addon filename that wreq-js 3.0.0 will load. */
export function resolveWreqJsNativeBinaryName({ platform, arch, libc }) {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
    return `wreq-js.darwin-${arch}.node`;
  }
  if (platform === "linux" && (arch === "arm64" || arch === "x64")) {
    const linuxLibc = libc ?? detectRuntimeLibc();
    if (linuxLibc !== "gnu" && linuxLibc !== "musl") return null;
    return `wreq-js.linux-${arch}-${linuxLibc}.node`;
  }
  if (platform === "win32" && arch === "x64") {
    return "wreq-js.win32-x64-msvc.node";
  }
  return null;
}
