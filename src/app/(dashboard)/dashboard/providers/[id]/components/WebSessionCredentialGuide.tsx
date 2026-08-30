"use client";

// Issue #3501 Phase 1c — extracted from the god-component.
// Shared by AddApiKeyModal and EditConnectionModal; imports only leaf modules
// (no cycle risk).

import type { WebSessionCredentialRequirement } from "../webSessionCredentials";
import { providerText, type ProviderMessageTranslator } from "../providerPageHelpers";

export interface WebSessionCredentialGuideProps {
  requirement: WebSessionCredentialRequirement;
  providerName: string;
  providerWebsite?: string;
  t: ProviderMessageTranslator;
}

export function getProviderWebsiteHost(providerWebsite?: string): string | null {
  if (!providerWebsite) {
    return null;
  }

  try {
    return new URL(providerWebsite).host;
  } catch {
    return providerWebsite;
  }
}

export default function WebSessionCredentialGuide({
  requirement,
  providerName,
  providerWebsite,
  t,
}: WebSessionCredentialGuideProps) {
  const providerWebsiteHost = getProviderWebsiteHost(providerWebsite);

  if (requirement.kind === "none") {
    return (
      <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-3 text-sm text-text-muted">
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined mt-0.5 text-[18px] text-emerald-500">
            check_circle
          </span>
          <div>
            <p className="font-medium text-text-main">
              {providerText(t, "webNoAuthGuideTitle", "No credential required")}
            </p>
            <p className="mt-1">
              {providerText(
                t,
                "webNoAuthGuideBody",
                "{provider} does not need an API key or cookie. Save the connection to use its free web endpoint.",
                { provider: providerName }
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const requiredCredentialKey =
    requirement.kind === "token" ? "webTokenRequiredCredential" : "webCookieRequiredCredential";
  const requiredCredentialFallback =
    requirement.kind === "token" ? "Required token: {credential}" : "Required cookie: {credential}";
  const guideSteps = requirement.guideSteps;

  return (
    <div className="rounded-lg border border-purple-500/25 bg-purple-500/10 px-3 py-3 text-sm text-text-muted">
      <div className="flex items-start gap-2">
        <span className="material-symbols-outlined mt-0.5 text-[18px] text-purple-500">cookie</span>
        <div className="space-y-2">
          <div>
            <p className="font-medium text-text-main">
              {providerText(t, "webSessionGuideTitle", "How to get the session credential")}
            </p>
            <p className="mt-1">
              {providerText(
                t,
                "webSessionGuideIntro",
                "{provider} uses a browser web session instead of an API key.",
                { provider: providerName }
              )}
            </p>
          </div>
          <p className="font-medium text-text-main">
            {providerText(t, requiredCredentialKey, requiredCredentialFallback, {
              credential: requirement.credentialName,
            })}
          </p>
          
          {guideSteps ? (
            <div className="space-y-4">
              {requirement.credentialName.includes("Session JSON") && (
                <div className="rounded border border-sky-500/30 bg-sky-500/10 p-3">
                  <p className="font-semibold text-sky-400 mb-2">⚡ Option 1: 1-Click Auto-Capture (Recommended)</p>
                  <p className="mb-2 text-sm text-text-muted">1. Drag this button to your Bookmarks Bar:</p>
                  <a
                    className="inline-block bg-sky-600 hover:bg-sky-500 text-white px-3 py-1.5 rounded text-sm font-medium border border-dashed border-sky-300 cursor-grab mb-2"
                    href="javascript:(function(){if(!window.location.hostname.includes('chatgpt.com')){alert('⚠️ Go to chatgpt.com first!');window.open('https://chatgpt.com','_blank');return;}fetch('https://chatgpt.com/api/auth/session').then(r=>r.json()).then(d=>{if(!d||!d.accessToken)throw new Error('Not logged in');return fetch('http://localhost:20128/api/providers/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:JSON.stringify(d)})});}).then(r=>{if(r&&r.ok){alert('✓ Captured into OmniRoute!')}else{alert('Failed to reach OmniRoute.')}}).catch(e=>alert('Error: '+e.message));})();"
                    onClick={(e) => { e.preventDefault(); alert("Drag this button to your bookmarks bar, then click it on chatgpt.com!"); }}
                  >
                    ⚡ Capture ChatGPT Session
                  </a>
                  <p className="text-sm text-text-muted">2. Open <a href="https://chatgpt.com" target="_blank" className="text-sky-400 hover:underline">chatgpt.com</a> and click the bookmark.</p>
                </div>
              )}
              
              <p className="font-semibold text-text-main mt-4">Option 2: Manual Copy & Paste</p>
              <ol className="list-decimal space-y-1 pl-5">
                {guideSteps.map((step, index) => (
                  <li key={step}>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          ) : (

            <ol className="list-decimal space-y-1 pl-5">
              <li>
                {providerText(t, "webSessionGuideStep1", "Sign in to {provider} in your browser.", {
                  provider: providerName,
                })}
                {providerWebsite && providerWebsiteHost && (
                  <a
                    href={providerWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {providerText(t, "webSessionGuideOpenProvider", "Open {host}", {
                      host: providerWebsiteHost,
                    })}
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                      open_in_new
                    </span>
                  </a>
                )}
              </li>
              <li>
                {providerText(
                  t,
                  "webSessionGuideStep2Fast",
                  "Fast path: install the Cookie Editor extension (chromewebstore.google.com → Cookie Editor), open it on the {provider} tab, find {credential} (select all numbered chunks if split), and click Export → Copy with the export format set to “Cookie header”.",
                  { provider: providerName, credential: requirement.credentialName }
                )}
              </li>
              <li>
                {providerText(
                  t,
                  "webSessionGuideStep3Manual",
                  "Manual path: open the browser developer tools (F12 → Network), refresh the page, open an authenticated request, and copy the Cookie header value from Request Headers — omit the Cookie: prefix."
                )}
              </li>
              <li>
                {providerText(
                  t,
                  "webSessionGuideStep4",
                  "Paste it here and check the connection. If it stops working, sign in again and replace it with a fresh value."
                )}
              </li>
            </ol>
          )}
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {requirement.guideNote ??
              providerText(
                t,
                "webSessionSecurityHint",
                "Treat this like a password: it may access your signed-in web account until it expires or is revoked."
              )}
          </p>
        </div>
      </div>
    </div>
  );
}
