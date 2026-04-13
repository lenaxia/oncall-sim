/// <reference types="vite/client" />

// Declare CSS module so TypeScript doesn't error on `import './index.css'`
declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}

interface Window {
  __ONCALL_CONFIG__?: {
    scenarioUrls?: string[];
  };
  __CONFIG__?: {
    debug?: boolean;
    /**
     * Short-lived HMAC-signed proxy token injected by server.js at page-serve time.
     * Sent as X-Proxy-Token on every LLM request to authenticate against the proxy.
     * Null when PROXY_TOKEN_SECRET is not configured (token protection disabled).
     */
    proxyToken?: string | null;
  };
}
