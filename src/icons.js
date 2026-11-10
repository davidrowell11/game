// A small, consistent SVG icon set (24x24, stroked) used across the HUD and
// menus. Emoji render differently on every OS; these always match the art.
const P = {
  sword: 'M14.5 3.5H20.5V9.5L9.5 20.5L3.5 14.5Z M7 12l5 5 M3 21l3-3',
  bolt: 'M12 2v4 M12 18v4 M2 12h4 M18 12h4 M5 5l2.5 2.5 M16.5 16.5L19 19 M5 19l2.5-2.5 M16.5 7.5L19 5 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  dash: 'M4 6l6 6-6 6 M12 6l6 6-6 6',
  flask: 'M9 3h6 M10 3v6L4.8 18.2A2 2 0 0 0 6.6 21h10.8a2 2 0 0 0 1.8-2.8L14 9V3 M7 15h10',
  heart: 'M12 20.5s-7.5-4.6-9.3-9.2A5 5 0 0 1 12 6.6a5 5 0 0 1 9.3 4.7C19.5 15.9 12 20.5 12 20.5z',
  shield: 'M12 3l8 3v6c0 5-3.6 8.2-8 9-4.4-.8-8-4-8-9V6z M12 8v8 M8.5 11h7',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  skull: 'M12 3a8 8 0 0 0-8 8c0 3 1.5 4.6 3 5.6V20h10v-3.4c1.5-1 3-2.6 3-5.6a8 8 0 0 0-8-8z M9 11.5h.01 M15 11.5h.01 M10.5 20v-2 M13.5 20v-2',
  drop: 'M12 3s6.5 6.6 6.5 11.2a6.5 6.5 0 0 1-13 0C5.5 9.6 12 3 12 3z M9 15a3 3 0 0 0 3 3',
  leaf: 'M5 19C5 10 11 5 20 5c0 9-5 15-14 15z M5 19l8-8',
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v10 M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4',
  spikes: 'M2 20l3-8 3 8 4-14 4 14 3-8 3 8z',
  hammer: 'M4 20l8.5-8.5 M9.5 7.5L14 3l7 7-4.5 4.5z',
  clock: 'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19z M12 7v5l3.5 2',
  boot: 'M8 3h5v9l7 2v4l-3 2H4v-4l4-3z M4 18h16',
  star: 'M12 2.5l2.8 6.4 6.9.6-5.2 4.6 1.6 6.8L12 17.3l-6.1 3.6 1.6-6.8L2.3 9.5l6.9-.6z',
  split: 'M12 21v-9 M12 12L5 5 M12 12l7-7 M5 5v4.5 M5 5h4.5 M19 5v4.5 M19 5h-4.5',
  pierce: 'M2 12h16 M14 7l5 5-5 5 M6 8v8 M10 9v6',
  reach: 'M3 12h18 M7 8l-4 4 4 4 M17 8l4 4-4 4',
  crown: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z',
  flame: 'M12 2.5c2 4.2 6 6.2 6 11a6 6 0 0 1-12 0c0-3 1.8-5 3-7 .8 2 2 3 3 3 0-3-1-5 0-7z',
  gem: 'M6 3h12l3 6-9 12L3 9z M3 9h18 M9 3l3 6 3-6 M12 9v12',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
  gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9L7 7 M17 17l2.1 2.1 M4.9 19.1L7 17 M17 7l2.1-2.1',
  door: 'M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16 M3 21h18 M14 12h.01',
};

export function icon(name, cls = '') {
  const d = P[name] || P.star;
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}
