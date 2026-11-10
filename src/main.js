// Fonts are bundled (not fetched from the web) so the desktop app works offline.
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/500.css';
import '@fontsource/alegreya-sans/700.css';
import './style.css';
import { Game } from './game.js';

window.game = new Game();
