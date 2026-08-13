import { getDbInstance } from "../../src/lib/db/core.ts";
import { decryptCredential } from "../../src/lib/encryption.ts";

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
  console.log("Using key:", key.substring(0, 10) + "...");

  const testRequest = async (authHeader, clientVersion) => {
    console.log(
      `\nTesting with Auth: ${authHeader.substring(0, 20)}..., Version: ${clientVersion}`
    );
    const res = await fetch("https://api.cline.bot/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        "HTTP-Referer": "https://cline.bot",
        "X-Title": "Cline",
        "User-Agent": `Cline/${clientVersion}`,
        "X-IS-MULTIROOT": "false",
        "X-CLIENT-TYPE": "omniroute",
        "X-CLIENT-VERSION": clientVersion,
        "X-PLATFORM": "darwin",
        "X-PLATFORM-VERSION": "24.18.0",
        "X-CORE-VERSION": clientVersion,
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
  };

  await testRequest(`Bearer workos:${key}`, "3.8.49");
  await testRequest(`Bearer ${key}`, "3.8.49");
  await testRequest(`Bearer workos:${key}`, "3.0.54");
  await testRequest(`Bearer ${key}`, "3.0.54");
}

run().catch(console.error);
