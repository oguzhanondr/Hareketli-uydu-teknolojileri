/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Theme tokens are driven by CSS variables (see index.css) so the
        // same utility classes work in both dark and light themes.
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        card: 'var(--card)',
        border: 'var(--border)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        accent: 'var(--accent)',
        // Domain colors (stable across themes).
        survivor: '#ffd400',
        debris: '#ff3b3b',
        terminal: '#2f6fff',
        irs: '#a855f7',
        los: '#22c55e',
      },
      fontFamily: {
        head: ['Rajdhani', 'sans-serif'],
        body: ['"DM Sans"', 'sans-serif'],
      },
      boxShadow: {
        glow:
          '0 14px 34px rgba(3, 10, 24, 0.24), 0 2px 10px rgba(3, 10, 24, 0.16), 0 0 0 1px rgba(0, 168, 204, 0.14)',
        'glow-lg':
          '0 24px 56px rgba(3, 10, 24, 0.3), 0 10px 22px rgba(3, 10, 24, 0.18), 0 0 0 1px rgba(0, 168, 204, 0.16)',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        spin: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        pulseGlow: {
          '0%, 100%': {
            boxShadow:
              '0 12px 30px rgba(3,10,24,0.22), 0 0 0 1px rgba(0,168,204,0.12)',
          },
          '50%': {
            boxShadow:
              '0 18px 38px rgba(3,10,24,0.28), 0 0 0 1px rgba(0,168,204,0.18)',
          },
        },
      },
      animation: {
        fadeInUp: 'fadeInUp 0.45s ease-out both',
        spin: 'spin 0.9s linear infinite',
        pulseGlow: 'pulseGlow 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
