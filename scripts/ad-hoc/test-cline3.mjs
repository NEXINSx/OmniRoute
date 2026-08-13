import { getDbInstance } from "../../src/lib/db/core.ts";
import { decryptCredential } from "../../src/lib/db/encryption.ts";

async function run() {
  const db = getDbInstance();
  const rows = db
    .prepare("SELECT api_key FROM provider_connections WHERE provider = 'cline'")
    .all();
  if (rows.length === 0) {
    console.log("No cline keys found");
    return;
  }

  const rawKey = rows[0].api_key;
  let key = rawKey;
  if (rawKey.startsWith("enc:v1:")) {
    key = decryptCredential(rawKey);
  }
  console.log("Using key length:", key.length);

  const res = await fetch("https://api.cline.bot/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer workos:${key}`,
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
      "User-Agent": `Cline/3.8.53`,
      "X-IS-MULTIROOT": "false",
      "X-CLIENT-TYPE": "omniroute",
      "X-CLIENT-VERSION": "3.8.53",
      "X-PLATFORM": "darwin",
      "X-PLATFORM-VERSION": "24.18.0",
      "X-CORE-VERSION": "3.8.53",
      "X-Task-ID": "test-task-123",
    },
    body: JSON.stringify({
      model: "cline/deepseek/deepseek-v4-flash",
      messages: [{ role: "user", content: "Hello" }],
    }),
  });
  const text = await res.text();
  console.log(`Status: ${res.status}`);
  console.log(`Response: ${text}`);
}

run().catch(console.error);
