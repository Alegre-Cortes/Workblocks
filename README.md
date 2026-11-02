# Workblocks (v0.1)

**A tiny, offline-first work-hours tracker designed for Android.** No accounts, libraries, subscription, or server database required.

## What works now

- **One tap to start, one tap to stop.** A running session continues to be timed correctly if you close/reopen the app or restart the phone, because its start timestamp is saved immediately.
- **Any number of sessions per day.** Sessions can cross midnight; totals are allocated to the correct local day (including daylight-saving transitions).
- **Optional categories:** Research, Mentoring, Bureaucracy, Outreach, Other, or Uncategorized. You can set the category before or during a block, or edit it later.
- **Manual correction**: add, edit, and delete blocks; optional note per block. The editor prevents overlapping work sessions.
- **Insights**: today, last 7 days, a simple daily chart, a category breakdown, and recent blocks.
- **Offline after first successful visit:** cached app shell via service worker; records persist locally via `localStorage`.
- **Export a CSV** for Google Sheets, **export a JSON backup**, and merge a JSON backup into the local database. Deleted blocks are retained as tombstones in the JSON backup for future sync handling.

## How to put it on your Android phone (recommended)

1. Create a new GitHub repository (e.g. `workblocks`). Extract this ZIP and upload its **contents** to the repository's root so `index.html` is at the top level. You can use GitHub's **Add file → Upload files** feature.
2. In the repository, open **Settings → Pages**. Choose **Deploy from a branch**, `main`, `/ (root)`, and save.
3. Open the HTTPS site URL that GitHub Pages gives you, typically `https://YOUR-USERNAME.github.io/workblocks/`, in **Chrome on Android**.
4. In Chrome's menu choose **Install app** or **Add to Home screen** (the wording depends on Android/Chrome). You will get a Workblocks icon in your launcher.
5. Open it from the launcher and start tracking. When the app has been visited online once, its shell should work offline.

**Important:** The GitHub repository and deployed page contain only app code. Your time logs stay **on the device/browser where you use the app**. They are not automatically uploaded to GitHub, Google, or ChatGPT.

A PWA needs HTTPS (or localhost) for installation; opening `index.html` directly is not an installable PWA. You can still inspect the files locally. GitHub Pages is just one possible free static host.

## Test it on a computer before deploying

```bash
cd workblocks-pwa
python3 -m http.server 8000
```

Open `http://localhost:8000/` in Chrome. Start a block, change its category, reload, stop, then check the Today list and Insights tab.

## Google Sheets right now

Choose **Data (top-right settings icon) → Export CSV**, and import that file into a Google Sheet using **File → Import → Upload**. The export includes:

`id, date_local, start_local, end_local, start_iso, end_iso, category, note, duration_minutes, timezone, updated_at`

`start_iso` and `end_iso` are absolute UTC timestamps. Local dates/times are included for convenient analysis. Hours are calculated from timestamps, not from a constantly running background process. If one block crosses midnight, split it by local day when calculating a daily report in Sheets; the in-app report does this automatically.

Export **Backup JSON** periodically. Device/browser storage can be cleared by the browser or operating system, and installing an app from a different URL or using a different browser creates separate storage. Do not uninstall/clear site data without a backup.

## Future Google Sheets automatic sync (v0.2 design)

The groundwork is in place: each block has a stable `id`, `startedAt`, `endedAt`, `category`, `note`, `updatedAt`, and optional `deletedAt`. The next version can add:

1. **Google OAuth login** using Google Identity Services, with your own OAuth application configured on Google Cloud.
2. Create/select an **app-owned spreadsheet** in your Google Drive, accessed via Google Sheets API. Prefer the `drive.file` scope where supported, rather than blanket Drive access.
3. **Upsert by block ID** and compare `updatedAt`, so edited blocks replace prior rows, and syncing cannot append duplicates. `deletedAt` would propagate deletions.
4. **Sync on app open / when back online / on demand**; don't rely on background syncing from a closed PWA. Keep local records canonical until a sync succeeds.
5. Handle conflicts and allow downloading/merging the original JSON backup.

**Do not put access tokens, API secrets, or a publicly writable Apps Script endpoint in a static GitHub Pages repository.** A private spreadsheet is not a secure server, but OAuth authorizes your app to communicate with it. Authentication/permission setup is intentionally **not** in v0.1.

## Project files

- `index.html` — UI and dialogs
- `styles.css` — responsive styling
- `app.js` — timer, local storage, edit, stats and exports
- `manifest.webmanifest` — Android install metadata
- `sw.js` — caches the app shell for offline use
- `icons/` — generated 192px and 512px icons

## Known prototype limitations

- Data lives in each browser/device's local storage; it **does not sync** automatically between phone and desktop yet.
- There is no background notification or home-screen timer widget in this first PWA; reopening shows the correct elapsed time.
- If the phone's system clock changes manually while a block is running, time measurement can be inaccurate. The app uses absolute wall-clock timestamps.
- The last-7-days summary uses seven calendar days, including non-working days; its average is total/7.
- If a block is longer than one day, Today's list clips its displayed duration to today, but editing opens the **full block**.
- App-shell updates require changing the cache version in `sw.js` when deploying modified files.

## Privacy

No analytics, trackers, external API calls or third-party dependencies are included. The service worker only caches the static app's own files. Local records remain on your device unless you export them.

## Next useful iteration

After testing a normal workweek, prioritize a **Google Sheets OAuth connection**, then consider a native Android widget or quick-start shortcut only if the web app isn't convenient enough.
