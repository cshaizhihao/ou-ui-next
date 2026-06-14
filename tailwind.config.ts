import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#1E3AFF',
        secondary: '#07111F',
        accent: '#FF3D18',
        blue: {
          50: '#EEF0FF',
          100: '#DCE1FF',
          200: '#BBC5FF',
          300: '#8FA0FF',
          400: '#5F74FF',
          500: '#1E3AFF',
          600: '#1830D6',
          700: '#14279F',
          800: '#101E6C',
          900: '#0B1644',
          950: '#07111F'
        },
        sky: {
          50: '#E9FFF3',
          100: '#CFFFE4',
          200: '#95FFC5',
          300: '#55F39F',
          400: '#1ED47F',
          500: '#00A878',
          600: '#008760',
          700: '#006448',
          800: '#084633',
          900: '#062D23',
          950: '#031A14'
        },
        cyan: {
          50: '#FBFFE1',
          100: '#F4FFC1',
          200: '#ECFF7A',
          300: '#E3FF3E',
          400: '#D9FF00',
          500: '#D9FF00',
          600: '#A6BC00',
          700: '#788800',
          800: '#566100',
          900: '#343B00',
          950: '#1E2400'
        },
        indigo: {
          50: '#FFF0E8',
          100: '#FFD8C6',
          200: '#FFAD8D',
          300: '#FF8158',
          400: '#FF5A2C',
          500: '#FF3D18',
          600: '#D92E12',
          700: '#A82311',
          800: '#711A11',
          900: '#45100C',
          950: '#260907'
        },
        emerald: {
          50: '#E9FFF3',
          100: '#CFFFE4',
          200: '#95FFC5',
          300: '#55F39F',
          400: '#1ED47F',
          500: '#00A878',
          600: '#008760',
          700: '#006448',
          800: '#084633',
          900: '#062D23',
          950: '#031A14'
        },
        amber: {
          50: '#FBFFE1',
          100: '#F4FFC1',
          200: '#ECFF7A',
          300: '#E3FF3E',
          400: '#D9FF00',
          500: '#D9FF00',
          600: '#A6BC00',
          700: '#788800',
          800: '#566100',
          900: '#343B00',
          950: '#1E2400'
        },
        orange: {
          50: '#FFF0E8',
          100: '#FFD8C6',
          200: '#FFAD8D',
          300: '#FF8158',
          400: '#FF5A2C',
          500: '#FF3D18',
          600: '#D92E12',
          700: '#A82311',
          800: '#711A11',
          900: '#45100C',
          950: '#260907'
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
