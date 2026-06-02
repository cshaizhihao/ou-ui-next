import { createContext } from 'react';
import type { ControlPlaneApi } from './control-plane-api';

export const ApiContext = createContext<ControlPlaneApi | null>(null);
