/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ASSET_BASE?: string;
  readonly VITE_CONTROL_PLANE_AGENT_ID?: string;
  readonly VITE_CONTROL_PLANE_AGENT_TOKEN?: string;
  readonly VITE_CONTROL_PLANE_BASE_URL?: string;
  readonly VITE_CONTROL_PLANE_MODE?: string;
  readonly VITE_CONTROL_PLANE_OPERATOR_TOKEN?: string;
  readonly VITE_DISABLE_IN_APP_LOGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
