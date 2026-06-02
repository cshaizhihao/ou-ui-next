import { useContext } from 'react';
import { ApiContext } from './api-context';

export function useApi() {
  const api = useContext(ApiContext);

  if (!api) {
    throw new Error('useApi must be used within ApiProvider');
  }

  return api;
}
