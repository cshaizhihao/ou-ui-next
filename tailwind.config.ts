import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#E61919',
        secondary: '#050505',
        accent: '#E61919',
        blue: {
          50: '#f4f4f0',
          100: '#e7e3da',
          200: '#d4cdc0',
          300: '#bcb4a3',
          400: '#8f8677',
          500: '#5d564b',
          600: '#3f3b33',
          700: '#26231f',
          800: '#151312',
          900: '#0d0c0b',
          950: '#050505'
        },
        sky: {
          50: '#f8f7f4',
          100: '#ece8e0',
          200: '#ddd6c9',
          300: '#c2baa9',
          400: '#9a907f',
          500: '#6a6357',
          600: '#4b453c',
          700: '#302c26',
          800: '#1d1a17',
          900: '#11100e',
          950: '#050505'
        },
        cyan: {
          50: '#f8f7f4',
          100: '#ece8e0',
          200: '#ddd6c9',
          300: '#c2baa9',
          400: '#9a907f',
          500: '#6a6357',
          600: '#4b453c',
          700: '#302c26',
          800: '#1d1a17',
          900: '#11100e',
          950: '#050505'
        },
        indigo: {
          50: '#f8f7f4',
          100: '#ece8e0',
          200: '#ddd6c9',
          300: '#c2baa9',
          400: '#9a907f',
          500: '#6a6357',
          600: '#4b453c',
          700: '#302c26',
          800: '#1d1a17',
          900: '#11100e',
          950: '#050505'
        }
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
