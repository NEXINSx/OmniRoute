import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  describeVideoPart,
  normalizeVideoTranscript,
  type VideoCaptionFrame,
} from "../../../src/lib/guardrails/videoBridgeHelpers";

async function jpegFrame(color: string, timestampSeconds: number): Promise<VideoCaptionFrame> {
  const bytes = await sharp({
    create: { background: color, channels: 3, height: 24, width: 32 },
  })
    .jpeg()
    .toBuffer();
  return { dataUri: `data:image/jpeg;base64,${bytes.toString("base64")}`, timestampSeconds };
}

test("accepts only provenance-bearing transcript cues and deduplicates exact repeats", () => {
  const cues = normalizeVideoTranscript(
    {
      cues: [
        { text: "hello", start: 1, end: 3, source: "client", confidence: 0.8 },
        { text: "hello", start: 1, end: 3, source: "client", confidence: 0.8 },
        { text: "world", startSeconds: 3, endSeconds: 5, source: "audio-bridge" },
      ],
    },
    10
  );

  assert.deepEqual(cues, [
    { text: "hello", startSeconds: 1, endSeconds: 3, source: "client", confidence: 0.8 },
    { text: "world", startSeconds: 3, endSeconds: 5, source: "audio-bridge", confidence: 1 },
  ]);
});

test("rejects untrusted sources, malformed cues, and out-of-range timestamps", () => {
  assert.throws(
    () =>
      normalizeVideoTranscript({ cues: [{ text: "x", start: 1, end: 2, source: "unknown" }] }, 10),
    /source/i
  );
  assert.throws(
    () =>
      normalizeVideoTranscript({ cues: [{ text: "x", start: -1, end: 2, source: "client" }] }, 10),
    /timestamp|range/i
  );
  assert.throws(
    () =>
      normalizeVideoTranscript({ cues: [{ text: "x", start: 4, end: 4, source: "embedded" }] }, 10),
    /timestamp|range/i
  );
  assert.throws(
    () =>
      normalizeVideoTranscript(
        { cues: [{ text: "x", start: 9, end: 11, source: "embedded" }] },
        10
      ),
    /timestamp|range/i
  );
});

test("keeps transcript provenance attached to the described video output", async () => {
  const frames: VideoCaptionFrame[] = [
    { dataUri: "data:image/jpeg;base64,AA==", timestampSeconds: 2 },
    { dataUri: "data:image/jpeg;base64,AA==", timestampSeconds: 8 },
  ];
  const described = await describeVideoPart(
    {
      container: "messages",
      messageIndex: 0,
      partIndex: 0,
      ref: "data:video/mp4;base64,AA==",
      shape: "data_uri_string",
      transcript: {
        cues: [{ text: "spoken words", start: 1, end: 3, source: "audio-bridge", confidence: 0.9 }],
      },
    },
    { frameCount: 2, timeoutMs: 1000 },
    async () => "a scene",
    {
      extractFrames: async () => ({ durationSeconds: 10, frames }),
    }
  );

  assert.equal(described.transcriptCues?.length, 1);
  assert.match(described.description, /transcript\[source=audio-bridge;confidence=0\.90/);
  assert.match(described.description, /spoken words/);
});

test("fuses an explicitly supplied audio-bridge track without starting STT", async () => {
  let captionCalls = 0;
  const described = await describeVideoPart(
    {
      container: "messages",
      messageIndex: 0,
      partIndex: 0,
      ref: "data:video/mp4;base64,AA==",
      shape: "data_uri_string",
      audioTranscript: {
        cues: [{ text: "audio cue", start: 1, end: 3, source: "audio-bridge" }],
      },
    },
    { frameCount: 1, timeoutMs: 1000 },
    async () => {
      captionCalls += 1;
      return "visual cue";
    },
    {
      extractFrames: async () => ({
        durationSeconds: 5,
        frames: [{ dataUri: "data:image/jpeg;base64,AA==", timestampSeconds: 2 }],
      }),
    }
  );

  assert.equal(captionCalls, 1);
  assert.equal(described.transcriptCues?.[0]?.source, "audio-bridge");
  assert.match(described.description, /audio cue/);
  assert.deepEqual(described.fusion, {
    audioAvailable: true,
    videoAvailable: true,
    partial: false,
  });
});

test("renders fused video and audio observations in chronological order", async () => {
  const described = await describeVideoPart(
    {
      container: "messages",
      messageIndex: 0,
      partIndex: 0,
      ref: "data:video/mp4;base64,AA==",
      shape: "data_uri_string",
      audioTranscript: {
        cues: [{ text: "middle audio", start: 3, end: 4, source: "audio-bridge" }],
      },
    },
    { frameCount: 2, timeoutMs: 1000 },
    async (_frame, timestampSeconds) => `visual at ${timestampSeconds}`,
    {
      extractFrames: async () => ({
        durationSeconds: 6,
        frames: [
          { dataUri: "data:image/jpeg;base64,AA==", timestampSeconds: 1 },
          { dataUri: "data:image/jpeg;base64,AQ==", timestampSeconds: 5 },
        ],
      }),
    }
  );

  const firstVisual = described.description.indexOf("frame@t=00:01.000 visual at 1");
  const audio = described.description.indexOf("middle audio");
  const secondVisual = described.description.indexOf("frame@t=00:05.000 visual at 5");
  assert.ok(firstVisual >= 0);
  assert.ok(audio > firstVisual);
  assert.ok(secondVisual > audio);
  assert.equal(described.transcriptCues?.[0]?.text, "middle audio");
  assert.deepEqual(described.fusion, {
    audioAvailable: true,
    videoAvailable: true,
    partial: false,
  });
});

test("preserves provided and fused transcript cues without rendering either twice", async () => {
  const described = await describeVideoPart(
    {
      container: "messages",
      messageIndex: 0,
      partIndex: 0,
      ref: "data:video/mp4;base64,AA==",
      shape: "data_uri_string",
      transcript: {
        cues: [
          { text: "provided cue", start: 0.25, end: 0.75, source: "client" },
          { text: "late client cue", start: 4, end: 4.5, source: "client" },
        ],
      },
      audioTranscript: {
        cues: [{ text: "fused cue", start: 2, end: 3, source: "audio-bridge" }],
      },
    },
    { frameCount: 1, timeoutMs: 1000 },
    async () => "visual cue",
    {
      extractFrames: async () => ({
        durationSeconds: 5,
        frames: [{ dataUri: "data:image/jpeg;base64,AA==", timestampSeconds: 1 }],
      }),
    }
  );

  assert.deepEqual(
    described.transcriptCues?.map((cue) => cue.text),
    ["provided cue", "fused cue", "late client cue"]
  );
  assert.equal(described.description.split("provided cue").length - 1, 1);
  assert.equal(described.description.split("fused cue").length - 1, 1);
  assert.equal(described.description.split("late client cue").length - 1, 1);
  const provided = described.description.indexOf("provided cue");
  const visual = described.description.indexOf("frame@t=00:01.000 visual cue");
  const fused = described.description.indexOf("fused cue");
  const lateProvided = described.description.indexOf("late client cue");
  assert.ok(provided >= 0);
  assert.ok(visual > provided);
  assert.ok(fused > visual);
  assert.ok(lateProvided > fused);
  assert.deepEqual(described.fusion, {
    audioAvailable: true,
    videoAvailable: true,
    partial: false,
  });
});

test("deduplicates an exact cue shared by provided and fused transcript tracks", async () => {
  const sharedCue = {
    confidence: 0.8,
    end: 3,
    source: "audio-bridge" as const,
    start: 2,
    text: "shared audio cue",
  };
  const described = await describeVideoPart(
    {
      container: "messages",
      messageIndex: 0,
      partIndex: 0,
      ref: "data:video/mp4;base64,AA==",
      shape: "data_uri_string",
      transcript: { cues: [sharedCue] },
      audioTranscript: { cues: [sharedCue] },
    },
    { frameCount: 1, timeoutMs: 1000 },
    async () => "visual cue",
    {
      extractFrames: async () => ({
        durationSeconds: 5,
        frames: [{ dataUri: "data:image/jpeg;base64,AA==", timestampSeconds: 1 }],
      }),
    }
  );

  assert.equal(described.transcriptCues?.length, 1);
  assert.equal(described.description.split("shared audio cue").length - 1, 1);
});

test("preserves client and embedded provenance from the fused transcript track", async () => {
  const sharedCues = [
    { confidence: 0.8, end: 2, source: "client" as const, start: 1, text: "client cue" },
    { confidence: 0.9, end: 4, source: "embedded" as const, start: 3, text: "embedded cue" },
  ];
  const described = await describeVideoPart(
    {
      container: "messages",
      messageIndex: 0,
      partIndex: 0,
      ref: "data:video/mp4;base64,AA==",
      shape: "data_uri_string",
      transcript: { cues: sharedCues },
      audioTranscript: { cues: sharedCues },
    },
    { frameCount: 1, timeoutMs: 1000 },
    async () => "visual cue",
    {
      extractFrames: async () => ({
        durationSeconds: 5,
        frames: [{ dataUri: "data:image/jpeg;base64,AA==", timestampSeconds: 0.5 }],
      }),
    }
  );

  assert.deepEqual(
    described.transcriptCues?.map((cue) => cue.source),
    ["client", "embedded"]
  );
  assert.equal(described.description.split("client cue").length - 1, 1);
  assert.equal(described.description.split("embedded cue").length - 1, 1);
});

test("keeps each successful caption attached to its source-frame timestamp", async (t) => {
  for (const omittedCaption of ["failed", "empty"] as const) {
    await t.test(omittedCaption, async () => {
      const described = await describeVideoPart(
        {
          container: "messages",
          messageIndex: 0,
          partIndex: 0,
          ref: "data:video/mp4;base64,AA==",
          shape: "data_uri_string",
          audioTranscript: {
            cues: [{ text: "audio before last frame", start: 4, end: 4.5, source: "audio-bridge" }],
          },
        },
        { frameCount: 3, timeoutMs: 20_000 },
        async (_frame, timestampSeconds) => {
          if (timestampSeconds === 3) {
            if (omittedCaption === "failed") throw new Error("caption unavailable");
            return "   ";
          }
          return timestampSeconds === 1 ? "first visual" : "last visual";
        },
        {
          extractFrames: async () => ({
            durationSeconds: 6,
            frames: [
              { dataUri: "data:image/jpeg;base64,AA==", timestampSeconds: 1 },
              { dataUri: "data:image/jpeg;base64,AQ==", timestampSeconds: 3 },
              { dataUri: "data:image/jpeg;base64,Ag==", timestampSeconds: 5 },
            ],
          }),
        }
      );

      const firstVisual = described.description.indexOf("frame@t=00:01.000 first visual");
      const audio = described.description.indexOf("audio before last frame");
      const lastVisual = described.description.indexOf("frame@t=00:05.000 last visual");
      assert.ok(firstVisual >= 0);
      assert.ok(audio > firstVisual);
      assert.ok(lastVisual > audio);
      assert.equal(described.framesUsed, 2);
    });
  }
});

test("uses the full contact-sheet timestamp range for fusion ordering", async () => {
  const described = await describeVideoPart(
    {
      container: "messages",
      contactSheet: true,
      messageIndex: 0,
      partIndex: 0,
      ref: "data:video/mp4;base64,AA==",
      shape: "data_uri_string",
      audioTranscript: {
        cues: [{ text: "shorter audio", start: 1, end: 7, source: "audio-bridge" }],
      },
    },
    { frameCount: 3, timeoutMs: 20_000 },
    async () => "whole contact sheet",
    {
      extractFrames: async () => ({
        durationSeconds: 10,
        frames: [
          await jpegFrame("red", 1),
          await jpegFrame("green", 5),
          await jpegFrame("blue", 9),
        ],
      }),
    }
  );

  assert.equal(described.contactSheetUsed, true);
  const audio = described.description.indexOf("shorter audio");
  const contactSheet = described.description.indexOf("whole contact sheet");
  assert.ok(audio >= 0);
  assert.ok(contactSheet > audio);
});

test("derives the contact-sheet interval from minimum and maximum timestamps", async () => {
  const described = await describeVideoPart(
    {
      container: "messages",
      contactSheet: true,
      messageIndex: 0,
      partIndex: 0,
      ref: "data:video/mp4;base64,AA==",
      shape: "data_uri_string",
      audioTranscript: {
        cues: [{ text: "late audio", start: 8, end: 8.5, source: "audio-bridge" }],
      },
    },
    { frameCount: 3, timeoutMs: 20_000 },
    async () => "unordered contact sheet",
    {
      extractFrames: async () => ({
        durationSeconds: 10,
        frames: [
          await jpegFrame("blue", 9),
          await jpegFrame("red", 1),
          await jpegFrame("green", 5),
        ],
      }),
    }
  );

  assert.equal(described.contactSheetUsed, true);
  const contactSheet = described.description.indexOf("unordered contact sheet");
  const audio = described.description.indexOf("late audio");
  assert.ok(contactSheet >= 0);
  assert.ok(audio > contactSheet);
});

test("an invalid audioTranscript degrades to a partial fusion and keeps the visual description", async () => {
  const described = await describeVideoPart(
    {
      container: "messages",
      messageIndex: 0,
      partIndex: 0,
      ref: "data:video/mp4;base64,AA==",
      shape: "data_uri_string",
      audioTranscript: {
        cues: [{ text: "late cue", start: 1, end: 99, source: "audio-bridge" }],
      },
    },
    { frameCount: 1, timeoutMs: 1000 },
    async () => "visual cue",
    {
      extractFrames: async () => ({
        durationSeconds: 5,
        frames: [{ dataUri: "data:image/jpeg;base64,AA==", timestampSeconds: 2 }],
      }),
    }
  );

  assert.match(described.description, /visual cue/);
  assert.equal(described.transcriptCues, undefined, "invalid audio must not add transcript cues");
  assert.deepEqual(described.fusion, {
    audioAvailable: false,
    videoAvailable: true,
    partial: true,
    failures: { audio: "FAILED" },
  });
});
