// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Capture the onEvent handler the hook registers on the requests channel.
let capturedOnEvent: ((p: { channel: string }) => void) | null = null;
vi.mock("@/hooks/useLiveDashboard", () => ({
  useLiveDashboard: (opts: { onEvent?: (p: { channel: string }) => void }) => {
    capturedOnEvent = opts.onEvent ?? null;
    return { connection: { isConnected: true }, events: [] };
  },
}));

import { useOrchestrationSnapshot } from "@/app/(dashboard)/dashboard/orchestration/hooks/useOrchestrationSnapshot";

function HookProbe({
  onRender,
}: {
  onRender: (v: ReturnType<typeof useOrchestrationSnapshot>) => void;
}) {
  onRender(useOrchestrationSnapshot());
  return null;
}

const okJson = (body: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

describe("useOrchestrationSnapshot", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls the three endpoints and builds a snapshot; a failed source keeps the last good data", async () => {
    let latest: ReturnType<typeof useOrchestrationSnapshot> | null = null;
    const task = {
      id: "t1",
      providerId: "devin",
      status: "running",
      prompt: "p",
      source: { repoName: "r", repoUrl: "https://x" },
      options: {},
      activities: [],
      createdAt: "2026-08-30T10:00:00Z",
      updatedAt: "2026-08-30T10:00:00Z",
    };
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/v1/agents/tasks")) return okJson({ data: [task] });
      if (url.startsWith("/api/a2a/tasks"))
        return okJson({ tasks: [], total: 0, limit: 200, offset: 0 });
      return okJson({ offline: false, runners: [], tasks: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <HookProbe
          onRender={(v) => {
            latest = v;
          }}
        />
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(latest!.snapshot.nodes.some((n) => n.id === "cloud-agent:t1")).toBe(true);

    // Second tick: cloud agent fails — node must survive from the last good photo, source marked stale.
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/agents/tasks")) return Promise.reject(new Error("boom"));
      if (url.startsWith("/api/a2a/tasks"))
        return okJson({ tasks: [], total: 0, limit: 200, offset: 0 });
      return okJson({ offline: false, runners: [], tasks: [] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(latest!.snapshot.nodes.some((n) => n.id === "cloud-agent:t1")).toBe(true);
    const st = latest!.snapshot.sources.find((s) => s.source === "cloud-agent");
    expect(st?.ok).toBe(false);
  });

  it("a requests-channel WS event triggers a debounced immediate refetch", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/v1/agents/tasks")) return okJson({ data: [] });
      if (url.startsWith("/api/a2a/tasks"))
        return okJson({ tasks: [], total: 0, limit: 200, offset: 0 });
      return okJson({ offline: false, runners: [], tasks: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(<HookProbe onRender={() => {}} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const callsAfterMount = fetchMock.mock.calls.length;

    act(() => {
      capturedOnEvent?.({ channel: "requests" });
      capturedOnEvent?.({ channel: "requests" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    // Two burst events → exactly ONE extra round of 3 fetches (debounce), not two.
    expect(fetchMock.mock.calls.length).toBe(callsAfterMount + 3);
  });
});
