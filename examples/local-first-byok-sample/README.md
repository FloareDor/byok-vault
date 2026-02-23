# Local-First BYOK Sample (Gemini)

This sample is a separate app that depends on `byok-vault` via `file:../..` and calls the Gemini API.

## Run the app

```bash
npm run build
npm --prefix examples/local-first-byok-sample install
npm --prefix examples/local-first-byok-sample run dev
```

Then open the local Vite URL, paste your Gemini API key in the app's API key input, save/unlock, and run a Gemini call.

## Smoke checks

Offline vault behavior check:

```bash
npm --prefix examples/local-first-byok-sample run smoke
```

Live Gemini check (optional):

```bash
$env:GEMINI_API_KEY="your-real-key"
npm --prefix examples/local-first-byok-sample run smoke
```

Optional live overrides:

- `GEMINI_MODEL` (default: `gemini-2.0-flash`)
- `GEMINI_PROMPT` (default: short BYOK prompt)
