import { config } from "dotenv";
config({ path: "/Users/raheem/work/tools/rashizun-omni/rashiza-omni/.env" });

import { getProviderCredentials } from "../../src/sse/services/auth.ts";
import { DefaultExecutor } from "../../open-sse/executors/default.ts";
import { getDbInstance } from "../../src/lib/db/core.ts";

async function run() {
  const db = getDbInstance();
  // Clear the expired status
  db.prepare(
    "UPDATE provider_connections SET test_status = NULL, rate_limited_until = NULL WHERE provider = 'cline'"
  ).run();

  const credentials = await getProviderCredentials("cline");
  if (!credentials) {
    console.log("Still no credentials found!");
    return;
  }
  console.log("Got credentials. API Key available?", !!credentials.apiKey);

  const executor = new DefaultExecutor("cline");
  const headersWithWorkos = executor.buildHeaders(credentials, false, {});

  let res = await fetch("https://api.cline.bot/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersWithWorkos },
    body: JSON.stringify({
      model: "cline/deepseek/deepseek-v4-flash",
      messages: [{ role: "user", content: "Hello" }],
    }),
  });
  console.log(`\n[Default / workos:] Status: ${res.status}`);
  console.log(`[Default / workos:] Response: ${await res.text()}`);

  const rawKey = credentials.apiKey;
  const headersWithoutWorkos = { ...headersWithWorkos };
  headersWithoutWorkos.Authorization = `Bearer ${rawKey}`;

  res = await fetch("https://api.cline.bot/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersWithoutWorkos },
    body: JSON.stringify({
      model: "cline/deepseek/deepseek-v4-flash",
      messages: [{ role: "user", content: "Hello" }],
    }),
  });
  console.log(`\n[Modified / no-workos:] Status: ${res.status}`);
  console.log(`[Modified / no-workos:] Response: ${await res.text()}`);
}

run().catch(console.error);
