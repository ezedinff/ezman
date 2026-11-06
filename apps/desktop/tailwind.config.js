/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        method: {
          get: '#10b981',
          post: '#3b82f6',
          put: '#f59e0b',
          patch: '#8b5cf6',
          delete: '#ef4444',
          head: '#6366f1',
          options: '#6b7280',
        }
      }
    },
  },
  plugins: [],
};
