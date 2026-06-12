import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#2563EB',
        secondary: '#F97316',
        accent: '#F97316'
      },
      fontFamily: {
        sans: [
          'Geist',
          'Cabinet Grotesk',
          'Satoshi',
          'Outfit',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'Segoe UI',
          'sans-serif'
        ]
      }
    }
  },
  plugins: []
} satisfies Config;
