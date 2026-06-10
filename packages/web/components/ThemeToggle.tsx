'use client';
import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

// Переключатель тёмная/светлая. Тема хранится в localStorage и применяется на <html>.
export function ThemeToggle() {
  // Светлая тема — по умолчанию. data-theme='dark' включает тёмную.
  const [light, setLight] = useState(true);
  useEffect(() => {
    setLight(document.documentElement.getAttribute('data-theme') !== 'dark');
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    if (next) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', 'dark');
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
