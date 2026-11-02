# Workblocks v0.2

Offline-first Android-installable PWA for tracking work time. No account or server is required. **Your sessions remain stored in your device's `localStorage`**, under the **unchanged** `workblocks.state.v1` key, so updating from v0.1 retains existing records.

## What's new in v0.2

- **Forgot to start?** Tap the small link below Start, select 15/30/60/120 minutes ago or an exact start timestamp, then start a backdated **running** session. If a session is already running, use **Adjust start time**. A past start cannot overlap an existing completed block.
- **Forgot to stop?** After an active session exceeds **10 hours**, a quiet reminder appears on the Today screen. You can **Fix end time** to finish the active session at its actual end time, or **Not now** to suppress the reminder for 24 hours. The app **never stops or truncates a timer automatically**.
- **History** calendar: browse months, select any date, inspect, edit, delete, or add sessions for that day. Sessions crossing midnight are correctly attributed per local calendar day.
- **Remember last category**: enabled by default; after you select a category it is suggested for your next session. You can always select Uncategorized or disable the feature in **Data & backups**.
- **More insights**: last seven days, current Monday–Sunday week, current month, last month and current year. The graphs show daily totals, week portions within a month, or monthly totals for a year. Per-active-day average excludes days with zero recorded time.
- **Backup reminders**: if you have saved blocks and haven't requested a JSON backup for at least seven days, a quiet notice prompts you to save one. You can snooze it for three days. The reminder is displayed **only while the app is open**, not as a background notification.

## Installation or upgrade

1. On GitHub, upload the updated `index.html`, `app.js`, `styles.css`, `sw.js`, `README.md`, and `tests/smoke.cjs` to the **same repository and same paths**. Keep all other files (icons and manifest) unchanged.
2. Wait until **Actions → pages build and deployment** is successful.
3. On Android, open your existing Workblocks icon. If you see the old interface, close and reopen the app or refresh its website in Chrome. The offline cache was bumped from v1 to v2; an existing open page may initially display the previous cached version.
4. Verify that your previous sessions still appear in **History** before adding new ones.

**Before updating**, choose **Data & backups → Backup JSON** inside your existing app and save the file somewhere safe. Updating code should not remove your records, but a backup is prudent.

## Existing functionality

- One-tap Start/Stop; multiple blocks/day; optional Research, Mentoring, Bureaucracy, Outreach, Other or Uncategorized; add/edit/delete blocks and notes; offline after first visit; basic statistics.
- CSV export for Google Sheets and JSON backup/merge import.
- Stable IDs, timestamps, update timestamps, and deletion records for future synchronization.

## Storage, privacy and limitations

- GitHub Pages hosts the app **code only**. Work logs and preferences remain on the device/browser that created them. There is **no Google Drive synchronization yet**, and no transfer between phones and computers.
- Clearing site data, switching to a different hostname, or uninstalling an app in a way that removes site data may delete your sessions. **Keep periodic JSON backups.** A download being requested does not guarantee the backup file was safely saved; check your Downloads folder.
- An offline service worker caches app files, but background timers do not run in an Android service. Time is computed from stored wall-clock timestamps when the app is reopened; correcting your phone's clock while tracking may affect elapsed time.
- The 10-hour and backup reminders are **in-app** reminders, not system-level alarms. If the PWA is closed, there are no notifications.
- A remembered category is optional; no category is required for Start/Stop.

## Local tests

From this directory, with Node.js 18+:

```bash
node tests/smoke.cjs
```

To test in a browser, run `python3 -m http.server 8000` and visit `http://localhost:8000` (a service worker can also operate on localhost).

## Source files

- `index.html` — UI, calendar, recovery and edit dialogs
- `styles.css` — visual styling
- `app.js` — timers, local storage, history, summaries, category memory, exports
- `sw.js` — v2 offline shell cache
- `manifest.webmanifest` and `icons/` — installation assets (unchanged)
- `tests/smoke.cjs` — deterministic Node smoke tests