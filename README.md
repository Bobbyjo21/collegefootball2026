# Saturday Lab CFB Simulator

A static, phone-friendly college football simulator with a secure daily CFBD data pipeline. The API key is used only by GitHub Actions and is never sent to the browser.

## One-time setup

1. Create a new GitHub repository and upload every file in this folder, including `.github`.
2. Open **Settings → Secrets and variables → Actions → Secrets**.
3. Create the repository secret `CFBD_API_KEY` and paste your key as its value.
4. In the same area, open **Variables** and create `CFB_SEASON` with value `2026`.
5. Open **Actions → Update CFB data → Run workflow**.
6. Confirm that `data/live-data.json` is updated and committed by `CFB Data Bot`.
7. Open **Settings → Pages**. Choose **Deploy from a branch**, branch `main`, folder `/ (root)`.

The daily workflow runs at 10:15 UTC. It downloads current games, basic and advanced statistics, CORE ratings, FBS teams, venues, talent, returning production, and completed-game box scores. Optional endpoints fail gracefully and are listed in `warnings` instead of erasing the previous structure.

## Data priority

The simulator uses manual values first, measured live values second, and rating-based priors last. Current-season measurements are shrunk toward the priors using `games / (games + 4)`, which prevents one early game from taking over the forecast.

## Automatic context

When the selected teams have a scheduled matchup, the simulator fills in game date, neutral-site status, rest days, travel distance, time zones, venue elevation, surface, dome status and—within the forecast window—hourly weather from Open-Meteo. You can still override any field.

## Local test

Set `CFBD_API_KEY` in your terminal, then run:

```bash
npm run update
npm test
npm run serve
```

Do not place the API key in `index.html`, `data/live-data.json`, a URL, a commit, or an issue.
