import { createRoot } from 'react-dom/client';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
// visual do jogo (tokens, base, componentes): o Laboratório só acrescenta classes lab-*
import '../../src/renderer/styles/tokens.css';
import '../../src/renderer/styles/base.css';
import '../../src/renderer/styles/ui.css';
import './lab.css';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(<App />);
