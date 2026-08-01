'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const ThemeContext = createContext({ theme: 'light', toggleTheme: () => { }, setTheme: () => { } });

const STORAGE_KEY = 'realzentic-dubai-theme';

function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
}

export function ThemeProvider({ children }) {
    const [theme, setThemeState] = useState('light');

    // Sync with the value the anti-FOUC script already applied
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        const initial =
            stored === 'dark' || stored === 'light'
                ? stored
                : window.matchMedia?.('(prefers-color-scheme: dark)').matches
                    ? 'dark'
                    : 'light';
        setThemeState(initial);
        applyTheme(initial);
    }, []);

    const setTheme = useCallback((next) => {
        setThemeState(next);
        applyTheme(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch { }
    }, []);

    const toggleTheme = useCallback(() => {
        setTheme(theme === 'dark' ? 'light' : 'dark');
    }, [theme, setTheme]);

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    return useContext(ThemeContext);
}

// Inline script string injected in <head> to set the theme before first paint
// (prevents a flash of the wrong theme on load).
export const themeInitScript = `(function(){try{var k='${STORAGE_KEY}';var t=localStorage.getItem(k);if(t!=='dark'&&t!=='light'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;
