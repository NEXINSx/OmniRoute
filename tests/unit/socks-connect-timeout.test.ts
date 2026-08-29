import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SocksClient } from "socks";

// Lightweight oracle — node:test, no vi.mock.
// We patch SocksClient.createConnection (writable) and inject a fake
// buildConnector via the 5th param to capture the TLS timeout without
// mutating the read-only undici module.

describe("socks connectTimeout forwarder", () => {
  let capturedTimeout: any = undefined;
  let capturedTlsTimeout: any = undefined;
  let capturedTlsUndefined = false;
  let origCreateConnection: any;

  beforeEach(() => {
    origCreateConnection = SocksClient.createConnection;
    capturedTimeout = undefined;
    capturedTlsTimeout = undefined;
    capturedTlsUndefined = false;
    (SocksClient as any).createConnection = async (opts: any) => {
      capturedTimeout = opts?.timeout;
      return { socket: { setNoDelay: () => ({ setNoDelay: () => {} }) } } as any;
    };
  });

  afterEach(() => {
    (SocksClient as any).createConnection = origCreateConnection;
    capturedTimeout = undefined;
    capturedTlsTimeout = undefined;
    capturedTlsUndefined = false;
  });

  function fakeBuildConnector(opts: any = {}) {
    if (opts && typeof opts.timeout !== "undefined") capturedTlsTimeout = opts.timeout;
    else capturedTlsUndefined = true;
    return (_options: any, cb: any) => cb(null, { setNoDelay: () => ({}) } as any);
  }

  async function driveConnector(args: {
    family: 4 | 6 | null;
    tlsOpts?: any;
    connectTimeout?: number;
    protocol?: string;
    hostname?: string;
    port?: string;
  }) {
    const mod: any = await import(`../../open-sse/utils/socksConnectorWithFamily.ts?t=${Date.now()}-${Math.random()}`);
    const proxy = { host: "1.2.3.4", port: 1080, type: 5 } as any;
    const tlsOpts = args.tlsOpts ?? {};
    const connectTimeout = args.connectTimeout;
    const connector: any = mod.socksConnectorWithFamily(proxy, args.family, tlsOpts, connectTimeout, fakeBuildConnector as any);
    await new Promise<void>((resolve, reject) =>
      connector(
        { protocol: args.protocol ?? "https:", hostname: args.hostname ?? "example.com", port: args.port ?? "443" } as any,
        (err: any) => (err ? reject(err) : resolve())
      )
    );
    return { capturedTimeout, capturedTlsTimeout, capturedTlsUndefined, mod, connector };
  }

  it("U1: Agent.connectTimeout → SocksClient.timeout + TLS timeout", async () => {
    const { capturedTimeout: t, capturedTlsTimeout: tls } = await driveConnector({ family: 4, tlsOpts: {}, connectTimeout: 5000, protocol: "https:", port: "443" });
    assert.equal(t, 5000);
    assert.equal(tls, 5000);
  });

  it("U2: fallback sans connectTimeout → SOCKS_HANDSHAKE (TLS no timeout)", async () => {
    const prev = process.env.SOCKS_HANDSHAKE_TIMEOUT_MS;
    process.env.SOCKS_HANDSHAKE_TIMEOUT_MS = "7777";
    try {
      const { capturedTimeout: t, capturedTlsUndefined: tlsUndef } = await driveConnector({ family: 6, tlsOpts: {}, connectTimeout: undefined, protocol: "https:", port: "443" });
      assert.equal(t, 7777);
      assert.equal(tlsUndef, true);
    } finally {
      if (prev === undefined) delete process.env.SOCKS_HANDSHAKE_TIMEOUT_MS;
      else process.env.SOCKS_HANDSHAKE_TIMEOUT_MS = prev;
    }
  });

  it("U3: http (no TLS) still bounds SocksClient", async () => {
    const { capturedTimeout: t } = await driveConnector({ family: null, tlsOpts: {}, connectTimeout: 5000, protocol: "http:", port: "80" });
    assert.equal(t, 5000);
  });

  it("U4: connectTimeout=0 → SocksClient undefined (SOCKS defaults to 30s) + TLS timeout 0 (disabled)", async () => {
    const { capturedTimeout: t, capturedTlsTimeout: tls } = await driveConnector({ family: 4, tlsOpts: {}, connectTimeout: 0, protocol: "https:", port: "443" });
    assert.equal(t, undefined);
    assert.equal(tls, 0);
  });
});
