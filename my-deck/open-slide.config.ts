import type { OpenSlideConfig } from '@open-slide/core';

// Decks are served by the Vyuham web app at /decks (built into frontend/public/decks by
// `npm run build:app`). The dev server uses the same base: http://localhost:5173/decks/
const openSlideConfig: OpenSlideConfig = {
  base: '/decks/',
};

export default openSlideConfig;
