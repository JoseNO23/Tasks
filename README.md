# Task Map Template

Reusable starter for a small task-map application with:

- phases
- categories
- parent and child tasks
- dependency validation
- safe deletion strategies
- local JSON persistence
- JSON import and export
- simple Spanish and English UI

## Run

```bash
npm install
npm run dev
```

The app runs at `http://localhost:8181`.

## Project shape

- `src/`: small Express server, domain rules, storage, API routes
- `public/`: static frontend modules, styles, language support
- `scripts/`: optional read-only import helpers
- `examples/`: starter JSON example
- `data/`: runtime storage directory

## Persistence

The source of truth is `data/task-map.json`.
Business data is never stored in `localStorage`.
`localStorage` is only used for UI preferences such as filters, expanded panels, and selected language.

## Read-only imports

Import from a local JSON snapshot:

```bash
npm run import:file -- C:\path\to\snapshot.json
```

Import from a read-only URL:

```bash
npm run import:url -- https://example.com/task-map.json
```

These helpers only update this template's local storage file. They do not write back to the source system.

## Example data

Use [examples/starter-snapshot.json](examples/starter-snapshot.json) as a reference import file.

## Notes

- The UI ships with English and Spanish labels.
- The backend stays intentionally small and framework-light.
- No auth, database, or external services are required to start.
