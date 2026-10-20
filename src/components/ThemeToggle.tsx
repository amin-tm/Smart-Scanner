
import { useState, type MouseEvent } from 'react';
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

  function changeTheme(event: MouseEvent<HTMLButtonElement>) {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const applyTheme = () => {
      root.dataset.theme = next;
      root.style.colorScheme = next;
      setTheme(next);

      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // Storage may be unavailable
      }
    };

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    type ViewTransition = {
      ready: Promise<void>;
      finished: Promise<void>;
    };

    const doc = document as Document & {
      startViewTransition?: (
        callback: () => void
      ) => ViewTransition;
    };

    if (reduceMotion || !doc.startViewTransition) {
      applyTheme();
      return;
    }

    root.classList.add('theme-revealing');

    const transition = doc.startViewTransition(applyTheme);

    void transition.ready.then(() => {
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      );

      root.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`
          ]
        },
        {
          duration: 620,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)'
        }
      );
    }).catch(() => {});

    void transition.finished.finally(() => {
      root.classList.remove('theme-revealing');
    });
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
