/// <reference types="vite/client" />

// Declare CSS module so TypeScript doesn't error on `import './index.css'`
declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}

// Harmony runtime config injected at load time
interface OncallRuntimeConfig {
  bedrockRoleArn: string;
  bedrockRegion: string;
  bedrockModelId: string;
  scenarioUrls?: string[];
}

interface Window {
  __ONCALL_CONFIG__?: OncallRuntimeConfig;
  harmony?: {
    authorization: {
      assume(roleArn: string): Promise<{
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken: string;
        expiration: Date;
      }>;
    };
  };
}
