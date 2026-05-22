# One Piece Card Value Finder

A web app for looking up **One Piece TCG** card prices, images, and market trends. Search by card name or card number (e.g. `OP06-001`), browse the most valuable cards, and open a detail view with raw and graded price breakdowns.

## What it does

- **Search** — Type a card name (fuzzy-friendly) or an exact card ID like `OP13-118`. Results appear in a dropdown; press **Enter** to show all matches on the home page.
- **Top 10** — On load, shows the highest market-price cards across sets, starter decks, promos, and DON cards (from live API data).
- **Card detail** — For a selected variant: current value, 30-day low/high/average, card image, set info, and optional price history when the source API supports it.
- **Price breakdown** — Raw market/listing prices plus graded estimates (PSA 9/10, CGC 10, CGC 10 Pristine, BGS 10, BGS 10 Black Label) when a reliable match is found.
- **Match quality** — Graded data shows **Verified** or **Unverified** with a confidence score and the matched listing title, so you can see which external price page was used.

Many cards share the same number but different arts (alternate, manga, SPR, etc.). The app picks the variant you clicked and uses image ID and override rules so graded prices align with that specific print when possible.

## Data sources

| Data | Source |
|------|--------|
| Card metadata, images, raw prices | [OPTCG API](https://www.optcgapi.com/) |
| Graded / ungraded guide prices | [PriceCharting](https://www.pricecharting.com/category/one-piece-cards) (fetched via a local dev proxy in `vite.config.js`) |

Graded prices are **not** from OPTCG. They are scraped from PriceCharting product pages during development. Accuracy depends on matching the correct variant; known fixes live in `graded-price-overrides.json`.

## Getting started

**Requirements:** Node.js 18+ and npm.

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Restart the dev server after changing `vite.config.js` or `graded-price-overrides.json`.

Other scripts:

```bash
npm run build    # production build to dist/
npm run preview  # preview production build
npm run lint     # ESLint
```

## Project layout

```
src/
  main.jsx                  # App entry
  one_piece_card_finder.jsx # Main UI and API logic
graded-price-overrides.json # Manual PriceCharting URL overrides by image_id / card+name
vite.config.js              # Vite + graded-price proxy middleware
```

## Graded price overrides

If a card’s PSA/CGC/BGS values look wrong, add an entry to `graded-price-overrides.json`:

- **`by_image_id`** — Best when OPTCG provides a unique `card_image_id` (e.g. `OP06-001_p1`).
- **`by_card_number_and_name`** — Fallback key: `CARDNUMBER|normalized name` (lowercase, simplified).

Use the exact PriceCharting game URL for that variant. Restart `npm run dev` after editing.

## Limitations

- Two-week price history from OPTCG often returns server errors; the UI may show a “history temporarily unavailable” notice while current prices still load.
- Graded matching is automated plus overrides; cards without a good PriceCharting page may show **N/A** or **Unverified** grades.
- The PriceCharting proxy runs only in Vite dev/preview; a production deploy needs an equivalent backend route if you host the app publicly.
