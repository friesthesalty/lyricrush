import { useState, useEffect } from 'react';

export interface Settings {
  volume: number;
  keybinds: string[];
}

const defaultSettings: Settings = {
  volume: 100,
  keybinds: ['e', 'i', 'd', 'j'],
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('lyricrush_settings');
      if (stored) {
        setSettings({ ...defaultSettings, ...JSON.parse(stored) });
      }
    } catch (e) {
      console.error('Failed to parse settings from localStorage', e);
    }
    setLoaded(true);
  }, []);

  const updateSettings = (newSettings: Partial<Settings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      localStorage.setItem('lyricrush_settings', JSON.stringify(updated));
      return updated;
    });
  };

  return { settings, updateSettings, loaded };
}
