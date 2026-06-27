import { useState, useEffect } from 'react';
import { Settings } from '../lib/useSettings';

interface SettingsPanelProps {
  settings: Settings;
  updateSettings: (newSettings: Partial<Settings>) => void;
  onClose: () => void;
}

export default function SettingsPanel({ settings, updateSettings, onClose }: SettingsPanelProps) {
  const [activeKeyIndex, setActiveKeyIndex] = useState<number | null>(null);

  useEffect(() => {
    if (activeKeyIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      
      const key = e.key.toLowerCase();
      // Ignore modifier keys
      if (['shift', 'control', 'alt', 'meta'].includes(key)) return;
      if (key === 'escape') {
        setActiveKeyIndex(null);
        return;
      }

      const newKeybinds = [...settings.keybinds];
      newKeybinds[activeKeyIndex] = key;
      updateSettings({ keybinds: newKeybinds });
      setActiveKeyIndex(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeKeyIndex, settings, updateSettings]);

  return (
    <div className="settings-overlay">
      <div className="settings-modal">
        <button className="settings-close" onClick={onClose}>&times;</button>
        <h2>Settings</h2>
        
        <div className="settings-section">
          <label>Volume: {settings.volume}%</label>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={settings.volume} 
            onChange={(e) => updateSettings({ volume: parseInt(e.target.value) })}
            className="volume-slider"
          />
        </div>

        <div className="settings-section">
          <label>Keybinds</label>
          <div className="keybinds-grid">
            {settings.keybinds.map((keybind, index) => (
              <div key={index} className="keybind-item">
                <span>Option {index + 1}</span>
                <button 
                  className={`keybind-btn ${activeKeyIndex === index ? 'active' : ''}`}
                  onClick={() => setActiveKeyIndex(index)}
                >
                  {activeKeyIndex === index ? 'Press any key...' : keybind.toUpperCase()}
                </button>
              </div>
            ))}
          </div>
        </div>

        <button className="btn" style={{ width: '100%', marginTop: '1rem' }} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
