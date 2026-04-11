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
}
