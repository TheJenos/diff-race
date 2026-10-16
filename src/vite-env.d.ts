/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_DATABASE_URL?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_EMULATOR?: string;
  /** Exposes the game to the Playwright tests (`vite --mode e2e`) */
  readonly VITE_E2E?: string;
  /** Discord application (client) id, for running as a Discord Activity */
  readonly VITE_DISCORD_CLIENT_ID?: string;
  /** The deployed site's Netlify functions (Discord sign-in), e.g. https://your-site.netlify.app/.netlify/functions */
  readonly VITE_FUNCTIONS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
