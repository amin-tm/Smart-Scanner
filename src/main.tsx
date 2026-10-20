import './polyfills';
import '@fontsource-variable/vazirmatn/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { loadAppFonts } from './lib/fonts';

loadAppFonts();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
