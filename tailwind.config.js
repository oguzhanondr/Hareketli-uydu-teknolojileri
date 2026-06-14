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
        glow: '0 0 18px rgba(0, 212, 255, 0.55), 0 0 4px rgba(0, 212, 255, 0.9)',
        'glow-lg': '0 0 32px rgba(0, 212, 255, 0.7), 0 0 8px rgba(0, 212, 255, 0.9)',
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
          '0%, 100%': { boxShadow: '0 0 14px rgba(0,212,255,0.45)' },
          '50%': { boxShadow: '0 0 28px rgba(0,212,255,0.85)' },
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
