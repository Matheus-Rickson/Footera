import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
// fonte condensada dos títulos, números e botões (empacotada no build: o jogo roda offline)
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/barlow-condensed/latin-ext-600.css';
import '@fontsource/barlow-condensed/latin-ext-700.css';
import '@fontsource/barlow-condensed/latin-ext-800.css';
import './styles/index.css';
import { applyTheme, storedTheme } from './theme.ts';

applyTheme(storedTheme());

createRoot(document.getElementById('root')!).render(<App />);
