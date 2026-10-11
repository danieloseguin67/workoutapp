# Mouvement

Mouvement is a responsive workout planner built with **Angular 20**, with a bilingual interface (French by default, English available). It works on desktop, tablet, and phone. It stores workouts as JSON, shows a short demonstration video for each exercise, and logs when each session and exercise begins and ends.

## Features

- **Profile:** name, age, goal (*Remise en forme* or *Force*), and weight-loss target.
- **Workouts:** create, edit, duplicate, reorder, and delete sessions. Each session has a warm-up, a main block (with rounds), and a cool-down.
- **Session player:** choose a session, follow each exercise with its looping video, and use the timer with play/pause, previous, and next controls.
- **History:** start and end times are recorded for every session and every exercise.
- **Configuration:** manage sessions, import or export them as JSON, restore the defaults, and browse the video library.
- **Language:** switch between French and English with the **FR / EN** buttons (sidebar, phone header, profile, or Configuration). French is the default and the choice is remembered.
- **Browser save:** workouts, the in-progress session, history, and profile are saved in the browser, with auto-save, restore points, and full export/import.
- **Responsive layout:** a sidebar on desktop and a bottom tab bar on phones.

Four sessions (A–D) are included by default.

## Requirements

- Node.js 20.19 or newer, or 22.12 or newer
- npm

## Getting started

```bash
npm install
npm start          # dev server at http://localhost:4200
npm run build      # production build in dist/mouvement
```

To use another port, run `npm start -- --port 53217`.

## Project structure

```
public/
  videos/            exercise demonstration clips (.mp4)
    index.json       list of available video files
src/
  index.html
  main.ts            bootstrap (imports zone.js)
  styles.css         global styles
  app/
    app.component.ts     application logic
    app.component.html   templates for every view
    i18n.ts              French and English translations
    workouts.json        default workout sessions (French)
    workouts.en.json     default workout sessions (English)
```

## Data storage

The default sessions come from `src/app/workouts.json` (French) or `src/app/workouts.en.json` (English). Switching language swaps the defaults only if you haven't modified them. Your own workouts are never translated or overwritten.

Everything is saved in the browser's **localStorage** under these keys:

| Key | Content |
| --- | --- |
| `mouvement.workouts` | workout sessions |
| `mouvement.profile` | user profile |
| `mouvement.logs` | session history with start and end times |
| `mouvement.activeSession` | the session in progress, so it can be resumed after closing or reloading the page |
| `mouvement.settings` | language and auto-save preference |
| `mouvement.backups` | restore points (up to 10) |

**Configuration → Données et sauvegarde / Data & backup** offers:

- **Auto-save** (on by default). When it's off, changes stay in memory, an "unsaved changes" bar appears, and you save with **Enregistrer maintenant / Save now**. The browser warns you before you leave with unsaved changes.
- **Restore points:** snapshots of workouts, history, and profile that you can restore or delete.
- **Export everything / Import everything:** a single JSON file with workouts, history, profile, and settings, useful for moving to another device.
- **Protect storage:** asks the browser not to clear the data automatically (`navigator.storage.persist`).
- **Erase all data:** resets workouts, history, and profile. The language setting is kept.

**Exporter JSON** at the top of Configuration exports workouts only. Both import buttons accept either a workout list or a full Mouvement backup. A workout list replaces only workouts, keeping the current profile and history; a full backup asks for confirmation before restoring workouts, profile, history, and language. This also works with JSON files downloaded from Google Drive on a phone.

### Export to your computer or Google Drive

The full backup (`mouvement-backup-YYYY-MM-DD-HH-MM.json`, containing profile, history, workouts, and settings) can be saved several ways:

- **↓ Export everything:** downloads the file to your Downloads folder.
- **💾 Save as…** (Chrome/Edge desktop): lets you pick the folder. If you pick a **Google Drive for desktop** folder, the file syncs to Drive.
- **↗ Share** (phones): opens the share sheet, from which you can send the file to Google Drive, email, and so on.
- **Open Google Drive ↗:** opens drive.google.com so you can drag the downloaded file in.
- **Google Drive (direct):** sign in with Google, then save, list, restore, or delete backups right in your Drive. This option needs a one-time setup:
  1. In the [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Google Drive API**.
  2. Configure the **OAuth consent screen** as External, add the scope `.../auth/drive.file`, and add yourself as a test user (or publish the app).
  3. Go to **Credentials → Create credentials → OAuth client ID → Web application**. Under **Authorized JavaScript origins**, add `https://danieloseguin67.github.io` and `http://localhost:4200`.
  4. Paste the Client ID (`…apps.googleusercontent.com`) in **Configuration → Google Drive**. To make it the default for every visitor, set `GOOGLE_CLIENT_ID` in [`src/app/google-drive.ts`](src/app/google-drive.ts) instead.

  The app uses the `drive.file` scope, so it can only see files it created itself. The access token lives in memory only (about 1 hour), and the Client ID isn't included in exported backups.

### Workout JSON format

```json
[
  {
    "id": "seance-a",
    "name": "Séance A — Cardio de Base",
    "subtitle": "Un premier pas, tout simplement.",
    "duration": 20,
    "level": "Débutant",
    "color": "mint",
    "optional": false,
    "exercises": [
      {
        "id": "a1",
        "name": "Marche active",
        "phase": "Échauffement",
        "seconds": 60,
        "tip": "Marchez sur place en balançant les bras naturellement.",
        "video": "marche-active.mp4"
      }
    ]
  }
]
```

- `phase` takes one of these values: `Échauffement`, `Bloc principal`, or `Retour au calme`.
- `rounds` (optional, on main-block exercises) sets how many times the main block repeats.
- `color` takes one of these values: `mint`, `peach`, `lavender`, or `blue`.
- `video` (optional) is a file name in `public/videos/`.

## Exercise videos

The app serves videos from `public/videos/` at `videos/<file>`. The default clips are generated animated silhouettes, about 360×360 and H.264, and you can replace them with real videos.

To add or replace a video:

1. Put an `.mp4` file in `public/videos/`. A short, muted, square clip works best.
2. Add its file name to `public/videos/index.json`.
3. Select it in the exercise's video field, either in **Configuration → ✎** or directly in `workouts.json`.

If you overwrite an existing file and keep the same name, every exercise that uses it is updated. When an exercise has no video, the default illustration is shown.

## Create a cardio workout with ChatGPT

**✨ Créer avec ChatGPT** is available in *Mes séances*, in *Configuration*, and in the "Créer une séance" dialog. It works in four steps:

1. **Describe the workout.** Choose the duration, level, intensity, type of cardio, impact, equipment, and space, and add any remarks or limitations. Then press **Créer le prompt**.
2. **Copy the prompt.** Press **Copier le prompt**, then **Ouvrir ChatGPT**, paste the prompt there, and send it. The prompt is written in the selected language and includes your profile, the exact JSON format, and the list of available MP4 files. ChatGPT must give each exercise a `video` field taken from that list.
3. **Paste the answer.** Copy ChatGPT's whole reply, paste it into the app, and press **Analyser la réponse**. Any text around the JSON block is ignored.
4. **Review the preview.** If you like the workout, press **Ajouter à mes séances**. Otherwise press **Modifier avant d’ajouter** to edit it first, or ask ChatGPT for a variant and paste the new reply.

When imported, phases, levels (French or English), durations, and rounds are normalized. **Every exercise gets an MP4.** If ChatGPT omits a video or invents a file name, the app picks the closest clip from the library by name and keywords, falling back to a default clip for the phase. Videos chosen this way are marked *vidéo choisie automatiquement / video chosen automatically* in the preview. New videos aren't generated: clips always come from `public/videos/`.

No API key is needed. The app never calls ChatGPT directly; everything goes through copy and paste.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and publishes the app every time you push to `main` or `master`.

1. Create a GitHub repository and push this project:
   ```bash
   git remote add origin https://github.com/<user>/<repo>.git
   git add . && git commit -m "Initial commit"
   git push -u origin master
   ```
2. On GitHub, go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. Wait for the **Deploy to GitHub Pages** workflow in the **Actions** tab to finish. The site will be at `https://<user>.github.io/<repo>/`.

`npm run build:gh-pages` builds the site with a relative base href (`./`), so it works under any repository name. The output is in `dist/mouvement/browser`. The `public/.nojekyll` file stops GitHub from running Jekyll on the site. You can also run the workflow manually with **Run workflow**.

On GitHub Pages, data is saved in each visitor's browser (localStorage), so it isn't shared between devices. Use the JSON export and import to move sessions from one device to another.

## License

Private project.
