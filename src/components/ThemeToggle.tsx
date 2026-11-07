
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { Sun, Moon } from 'lucide-react';

type Theme = 'dark' | 'light';

const THEME_KEY = 'smartscanner-theme';

function getSavedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light'
      ? 'light'
      : 'dark';
  } catch {
    return 'dark';
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getSavedTheme);

  function changeTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    const applyTheme = () => {
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      flushSync(() => setTheme(next));
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // Storage may be unavailable.
      }
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !document.startViewTransition) {
      applyTheme();
      return;
    }
    const transition = document.startViewTransition(applyTheme);
    void transition.finished.catch(() => {});
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={changeTheme}
      title={theme === 'dark' ? 'حالت روز' : 'حالت شب'}
      aria-label={
        theme === 'dark'
          ? 'فعال کردن حالت روز'
          : 'فعال کردن حالت شب'
      }
      aria-pressed={theme === 'light'}
    >
      <span className="theme-toggle-icon">
        <Sun className="theme-sun" size={18} />
        <Moon className="theme-moon" size={18} />
      </span>

      <span className="theme-toggle-label">
        {theme === 'dark' ? 'حالت روز' : 'حالت شب'}
      </span>
    </button>
  );
}
