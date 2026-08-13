import { getDbInstance } from "../../src/lib/db/core.ts";
import { decryptCredential } from "../../src/lib/db/encryption.ts";
import { execSync } from "child_process";
import { config } from "dotenv";

config({ path: "/Users/raheem/work/tools/rashizun-omni/rashiza-omni/.env" });

const db = getDbInstance();
const rows = db.prepare("SELECT api_key FROM provider_connections WHERE provider = 'cline'").all();
if (rows.length === 0) {
  console.log("No cline keys");
  process.exit(1);
}

let key = rows[0].api_key;
if (key.startsWith("enc:v1:")) {
  key = decryptCredential(key);
}

console.log("Testing with curl (workos: prefix)...");
try {
  const out1 = execSync(
    `curl -s -X POST "https://api.cline.bot/api/v1/chat/completions" -H "Content-Type: application/json" -H "Authorization: Bearer workos:${key}" -H "HTTP-Referer: https://cline.bot" -H "X-Title: Cline" -H "User-Agent: Cline/3.0.54" -H "X-IS-MULTIROOT: false" -H "X-CLIENT-TYPE: omniroute" -H "X-CLIENT-VERSION: 3.0.54" -H "X-PLATFORM: darwin" -H "X-PLATFORM-VERSION: 24.18.0" -H "X-CORE-VERSION: 3.0.54" -H "X-Task-ID: test-task" -d '{"model":"cline/deepseek/deepseek-v4-flash","messages":[{"role":"user","content":"Hello"}]}'`
  );
  console.log("Response (workos):", out1.toString());
} catch (e) {
  console.log("Error:", e.message);
}

console.log("\nTesting with curl (NO prefix)...");
try {
  const out2 = execSync(
    `curl -s -X POST "https://api.cline.bot/api/v1/chat/completions" -H "Content-Type: application/json" -H "Authorization: Bearer ${key}" -H "HTTP-Referer: https://cline.bot" -H "X-Title: Cline" -H "User-Agent: Cline/3.0.54" -H "X-IS-MULTIROOT: false" -H "X-CLIENT-TYPE: omniroute" -H "X-CLIENT-VERSION: 3.0.54" -H "X-PLATFORM: darwin" -H "X-PLATFORM-VERSION: 24.18.0" -H "X-CORE-VERSION: 3.0.54" -H "X-Task-ID: test-task" -d '{"model":"cline/deepseek/deepseek-v4-flash","messages":[{"role":"user","content":"Hello"}]}'`
  );
  console.log("Response (no prefix):", out2.toString());
} catch (e) {
  console.log("Error:", e.message);
}
