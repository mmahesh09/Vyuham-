"use client";

import { useEffect } from "react";

import { useSupportConfig, useSupportIdentity } from "./api";

/** The parts of Chatwoot's website SDK we use (https://www.chatwoot.com/docs/product/channels/live-chat/sdk/setup). */
type ChatwootApi = {
  setUser: (identifier: string, user: { name?: string; email?: string; identifier_hash: string }) => void;
  setCustomAttributes: (attributes: Record<string, string>) => void;
  toggle: (state?: "open" | "close") => void;
  reset: () => void;
};

declare global {
  interface Window {
    $chatwoot?: ChatwootApi;
    chatwootSDK?: { run: (options: { websiteToken: string; baseUrl: string }) => void };
    chatwootSettings?: Record<string, unknown>;
  }
}

const SCRIPT_ID = "chatwoot-sdk";

/** Opens the support chat. Returns false when the widget isn't loaded (not configured, or blocked). */
export function openSupportChat(): boolean {
  if (!window.$chatwoot) return false;
  window.$chatwoot.toggle("open");
  return true;
}

/** Forget the chat session on this device. Called on logout so the next person can't see it. */
export function resetSupportChat() {
  try {
    window.$chatwoot?.reset();
  } catch {
    /* widget not ready: nothing to forget */
  }
}

/**
 * Loads Chatwoot's website widget inside the signed-in app and identifies the customer with the
 * identity the backend signed from the session. Renders nothing; does nothing unless configured.
 */
export function SupportWidget() {
  const { data: config } = useSupportConfig();
  const enabled = config?.enabled === true;
  const { data: identity } = useSupportIdentity(enabled);

  useEffect(() => {
    if (!config?.enabled || !identity) return;
    const identify = () => {
      window.$chatwoot?.setUser(identity.identifier, {
        name: identity.name,
        ...(identity.email ? { email: identity.email } : {}),
        identifier_hash: identity.identifier_hash,
      });
      window.$chatwoot?.setCustomAttributes({ workspace_id: identity.workspace_id });
    };
    // Already loaded (e.g. signed out and back in without a page reload): identify the new person now.
    if (window.$chatwoot && document.getElementById(SCRIPT_ID)) {
      identify();
      return;
    }
    window.addEventListener("chatwoot:ready", identify, { once: true });
    if (!document.getElementById(SCRIPT_ID)) {
      window.chatwootSettings = { position: "right", type: "standard", launcherTitle: "Help" };
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = `${config.base_url}/packs/js/sdk.js`;
      script.async = true;
      script.onload = () => window.chatwootSDK?.run({ websiteToken: config.website_token, baseUrl: config.base_url });
      document.body.appendChild(script);
    }
    return () => window.removeEventListener("chatwoot:ready", identify);
  }, [config, identity]);

  return null;
}
