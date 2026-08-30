import { NextResponse } from "next/server";
import { createProviderConnection } from "@/lib/db/providers";
import { v4 as uuidv4 } from "uuid";

// Enable CORS for chatgpt.com
function setCORSHeaders(res: Response) {
  res.headers.set("Access-Control-Allow-Origin", "https://chatgpt.com");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export async function OPTIONS() {
  return setCORSHeaders(new NextResponse(null, { status: 204 }));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const token = body.data || body.accessToken;
    if (!token) return setCORSHeaders(NextResponse.json({ error: "No token" }, { status: 400 }));

    await createProviderConnection({
      id: "chatgpt_captured_" + uuidv4().substring(0,8),
      provider: "chatgpt-web",
      name: "ChatGPT Web (Captured)",
      authType: "cookie",
      apiKey: token,
      isActive: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: "{}"
    });

    return setCORSHeaders(NextResponse.json({ success: true }));
  } catch (error) {
    return setCORSHeaders(NextResponse.json({ error: String(error) }, { status: 500 }));
  }
}
