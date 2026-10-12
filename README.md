# Atelier — a digital closet &amp; outfit builder

Local-first web app — vanilla JavaScript (ES modules). Your photos, items and outfits live in the browser's IndexedDB, preferences in LocalStorage. No account, no tracking, no server: everything stays on your device.

Version: **alpha 0.4.0**

## Features

### Closet
- Collapsible **Home** strip at the top: a big time-of-day greeting (with your name, if you set one), a weather chip on the right that opens a **drop-down** with the current conditions and the next 3 days, and a shortcut row (Add item / Dress me / Canvas).
- Card grid of your clothes with category tabs and subcategory navigation.
- Search by name, brand, color or tag; filter by colors, brands, seasons, occasions, tags and favorites (with removable filter pills and an active-filter count).
- Favorite any item with a tap on its star.
- **Archive** instead of delete: keep things you no longer wear out of the way. The Archived view lets you select items and bulk-unarchive them; nothing is lost.
- Delete with safety confirmations (Atelier warns you if an item is used in saved outfits).
- Sample closet demo content you can add on first open and remove anytime in Settings.
- Responsive layout with a compact density option.

### Adding &amp; editing items
- Two-step wizard: Photo, then Details.
- Photo sources: **Upload** (tap, drag &amp; drop, or paste a screenshot from the web), **Camera**, **Image URL**, or no image at all.
- Built-in **crop view** that opens as soon as a photo arrives, with image tools:
  - rotate left/right, zoom, and horizontal/vertical position
  - crop frames: original, square, or portrait
  - **remove background** (plain-background cutout with adjustable tolerance; transparent PNGs supported)
- Details: name, brand, main color + additional colors, category and subcategory, season, occasion, style tags, notes, purchase price and date, and favorite.
- Full category set — Tops (including Zip-up Hoodies, Crewneck), Bottoms (including Jorts, Cargo Shorts, Cargo Pants), Outerwear, Shoes (including Slides), Accessories, Bags, Sportswear, Swimwear, Formalwear and Other — with 15 colors, 4 seasons and 7 occasions.
- Custom categories are allowed too.

### Outfit Builder
Opens on a choice between two modes (or jumps straight into your preferred one):

- **Dress me** — swipe rows of Tops, Bottoms and Shoes:
  - rows **loop infinitely**, wrapping from the last item back to the first
  - the piece resting in the middle of a row is the pick
  - **pin** a row so the dice skips it (floating pin button on mobile, header pin on desktop)
  - dice picks a look with **Random** or **Color match**
  - pictures are sized so every piece shows fully, even on the smallest phones (the whole screen fits without scrolling)
  - save the look to My Outfits or jump straight into the Canvas with it.

- **Canvas** — a free-form styling board:
  - drag pieces to move them, drag the handle to resize, rotate, and layer them (bring forward/send backward)
  - full keyboard support: arrows nudge, `+`/`−` resize, `R` rotates, `[`/`]` change layers, `Delete` removes
  - **auto-layout** drops chosen pieces onto the stage, **Shuffle** restyles it while keeping pinned pieces
  - selected-piece toolbar: nudge, resize, rotate, layer, pin/unpin, duplicate, replace with another item, remove
  - undo/redo history, name your outfit, save, and **export as PNG**
  - duplicate or delete saved outfits.

- **My Outfits** — search and sort your saved looks (recently modified, recently created, or A–Z), then open, edit, duplicate, export or delete them.

### Settings
- **Appearance** — follow your device's theme, or force light/dark.
- **Home** — set the name used in the greeting (and whether the first-open prompt is skipped), and turn the weather widget on/off with a city for the forecast.
- **Outfit Builder** — choose whether it asks which mode to open, and the default dice mode.
- **Photos and data** — see what's saved and how much space it uses; ask the browser to **protect your data** (persistent storage); **Export backup** / **Import backup** (merge with this device or replace everything) as one JSON file that includes photos; remove sample content; delete all outfits; delete everything (typed confirmation); reset preferences.
- **Automatic backup** — link a file (e.g. inside iCloud Drive, OneDrive or Google Drive) and Atelier re-saves it whenever your closet changes, so another device can pick it up. Shows last-saved time, with Save now / Reconnect / Unlink.
- **Cloud sync** — **Google Drive**: paste your OAuth Client ID to sync your closet to a hidden app-data file in your own Drive. It merges this device with the Drive copy (most recent change wins) so you can move between different devices. Nothing is sent anywhere but Google.
- **Help** — built-in guides for the Canvas controls, Dress me tips, and adding items from the web.
- **About** — version, creator info.

### Keeping your photos
Photos and outfits are kept in the browser's IndexedDB and survive closing and reopening the app. Atelier asks the browser to mark its storage as persistent, and Settings shows the current status. For extra safety, link an automatic backup file or use Export backup / Import backup (and the Google Drive sync) to move between devices.

## Notes
- Color match is a **local rule set** (neutrals go with anything, analogous pairs scored as softer, at most one bold accent), not AI.
- Background removal only works well on a plain, uniform background (or transparent PNGs) — there's no AI cutout.

## Files

`src/database.js` storage (IndexedDB) · `src/closet.js`, `src/filters.js`, `src/item-editor.js` closet &amp; editing · `src/image-utils.js` photo processing · `src/outfit-builder.js` canvas &amp; My Outfits · `src/dress-me.js` Dress me · `src/weather.js` weather widget · `src/settings.js`, `src/backup.js`, `src/autobackup.js`, `src/gdrive.js` settings and data safety · `src/screenshot.js` cropper · `src/demo.js` sample closet · `src/app.js` shell · `styles.css` · `atelier.otf` logo font.