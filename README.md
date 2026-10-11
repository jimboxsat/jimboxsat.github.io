# Atelier — digital closet and outfit builder

Local-first web app. Vanilla JS (ES modules), IndexedDB for items, photos and outfits, LocalStorage for preferences, Canvas for cropping, export and screenshots.

## Run

ES modules need an HTTP server (not `file://`):

```
python3 -m http.server 8080
# open http://localhost:8080
```

## What's inside

- **Closet** — grid, categories, search, filters, add/edit/archive/delete (trash icon on every card), "From screenshot".
- **Outfit Builder** — opens on two options:
  - **Dress me**: swipe tops, bottoms and shoes, pin rows, dice (Random or Color match), Save, Open in canvas.
  - **Canvas**: free styling board (drag, resize, layer, shuffle, PNG export) and **My Outfits**.
- **Settings** — theme (system/light/dark), what the Outfit Builder opens on, dice mode, storage protection, backup export/import, delete data, help, About.

## Keeping your photos

Photos and outfits are stored in the browser's IndexedDB, so they survive closing and reopening the app. The app asks the browser to mark storage as persistent; Settings shows the status. For extra safety, use Settings > Export backup (one JSON file with photos) and Import backup to restore.

## Files

`src/database.js` storage · `src/closet.js`, `filters.js`, `item-editor.js` · `src/outfit-builder.js` canvas · `src/dress-me.js` · `src/settings.js`, `backup.js` · `src/screenshot.js` screenshot cropper · `src/demo.js` sample closet · `src/app.js` shell.

## Notes

- Color match is a local rule set (neutrals go with anything, one bold color at most), not AI.
- Websites can't be embedded in another page, so web search opens in a new tab and you bring the image back as a screenshot.
- No background removal beyond a plain-background option in the cropper.
