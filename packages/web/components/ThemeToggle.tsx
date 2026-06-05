'use client';
import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

// Переключатель тёмная/светлая. Тема хранится в localStorage и применяется на <html>.
export function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    setLight(document.documentElement.getAttribute('data-theme') === 'light');
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    document.documentElement.setAttribute('data-theme', next ? 'light' : 'dark');
    try {
      localStorage.setItem('th_theme', next ? 'light' : 'dark');
    } catch {}
  }

  return (
    <button onClick={toggle} title={light ? 'Тёмная тема' : 'Светлая тема'} className="text-muted hover:text-text">
      {light ? <Moon size={17} /> : <Sun size={17} />}
    </button>
  );
}
