import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.stubEnv('VITE_CONTROL_PLANE_MOCK_SEEDED', 'true');
