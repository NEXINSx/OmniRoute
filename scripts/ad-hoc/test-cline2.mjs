async function testRequest(authHeader, clientVersion) {
  console.log(`\nTesting with Auth: ${authHeader}, Version: ${clientVersion}`);
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
}

async function run() {
  await testRequest(`Bearer workos:sk_cline_1234567890abcdef`, "3.8.49");
  await testRequest(`Bearer sk_cline_1234567890abcdef`, "3.8.49");
  await testRequest(`Bearer workos:sk_cline_1234567890abcdef`, "3.0.54");
  await testRequest(`Bearer sk_cline_1234567890abcdef`, "3.0.54");
  await testRequest(`Bearer workos:sk_cline_1234567890abcdef`, "3.8.53");
  await testRequest(`Bearer sk_cline_1234567890abcdef`, "3.8.53");
}

run().catch(console.error);
