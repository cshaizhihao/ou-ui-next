import type { ReactNode } from 'react';
import { ApiContext } from './api-context';
import type { ControlPlaneApi } from './control-plane-api';

type ApiProviderProps = {
  api: ControlPlaneApi;
  children: ReactNode;
};

export function ApiProvider({ api, children }: ApiProviderProps) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}
