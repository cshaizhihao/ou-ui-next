export type RuntimeModuleKind = 'host-agent' | 'xray' | 'gost' | 'hysteria2' | 'flvx' | 'bbr';

export type RuntimeModuleState = 'installed' | 'running' | 'stopped' | 'degraded' | 'installing';

export type RuntimeModule = {
  id: string;
  kind: RuntimeModuleKind;
  label: string;
  version: string;
  state: RuntimeModuleState;
  configVersion: string;
  hotReload: boolean;
  lastReloadAt: string;
};
