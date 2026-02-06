/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './App.tsx',
    './index.tsx',
    './components/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        rose: {
          50: 'rgb(var(--theme-50) / <alpha-value>)',
          100: 'rgb(var(--theme-100) / <alpha-value>)',
          200: 'rgb(var(--theme-200) / <alpha-value>)',
          300: 'rgb(var(--theme-300) / <alpha-value>)',
          400: 'rgb(var(--theme-400) / <alpha-value>)',
          500: 'rgb(var(--theme-500) / <alpha-value>)',
          600: 'rgb(var(--theme-600) / <alpha-value>)',
          700: 'rgb(var(--theme-700) / <alpha-value>)',
          800: 'rgb(var(--theme-800) / <alpha-value>)',
          900: 'rgb(var(--theme-900) / <alpha-value>)'
        },
        dreamy: {
          300: '#aab7d6',
          400: '#8da4cd',
          500: '#6d7fcc',
          900: '#2d334d'
        }
      },
      keyframes: {
        'slide-in-right': {
          '0%': { transform: 'translateX(20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' }
        },
        'slide-in-left': {
          '0%': { transform: 'translateX(-20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' }
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        }
      },
      animation: {
        'slide-in-right': 'slide-in-right 0.3s ease-out forwards',
        'slide-in-left': 'slide-in-left 0.3s ease-out forwards',
        'fade-in': 'fade-in 0.3s ease-out forwards'
      }
    }
  }
};
