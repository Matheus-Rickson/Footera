import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import { applyTheme, storedTheme } from './theme.ts';

applyTheme(storedTheme());

createRoot(document.getElementById('root')!).render(<App />);
