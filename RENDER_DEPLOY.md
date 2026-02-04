# Deploy tracking app to Render – step by step

## 1. Prepare the project (already done in your repo)

- `.gitignore` includes `service-account-key.json` so the key is never committed.
- `server.js` creates `service-account-key.json` from the `SERVICE_ACCOUNT_JSON` env var on Render when the file doesn’t exist.
- `package.json` has `"start": "node server.js"` and `"engines": { "node": ">=18" }`.

## 2. Create a GitHub repo and push your code

1. On [github.com](https://github.com), click **New repository**.
2. Name it (e.g. `redfiniti-tracking`), leave it empty (no README), click **Create repository**.
3. In your project folder (`my-first-app`), open a terminal and run:

   ```bash
   git init
   git add .
   git status
   ```

   Confirm that `service-account-key.json` does **not** appear in the list (it must be ignored).

4. Commit and push:

   ```bash
   git commit -m "Initial commit - tracking app for Render"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git push -u origin main
   ```

   Replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your GitHub username and repo name.

## 3. Create a Web Service on Render

1. Go to [render.com](https://render.com) and sign up or log in (e.g. with GitHub).
2. Click **New +** → **Web Service**.
3. Connect your GitHub account if asked, then select the repo you just pushed (e.g. `redfiniti-tracking`).
4. Configure the service:
   - **Name:** `redfiniti-tracking` (or any name you like).
   - **Region:** Choose the one closest to your users.
   - **Runtime:** **Node**.
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free** (or a paid plan if you prefer).
5. Click **Advanced** and add one environment variable:
   - **Key:** `SERVICE_ACCOUNT_JSON`
   - **Value:** Paste the **entire contents** of your local `service-account-key.json` file (the whole JSON, including `{` and `}`). You can copy it from the file on your computer. Render accepts multi-line values; you can paste the JSON as-is.
6. Click **Create Web Service**.

## 4. Wait for the first deploy

- Render will run `npm install` and then `npm start`.
- Watch the **Logs** tab. When you see something like “Server running on http://localhost:4000” (or the port Render uses), the app has started.
- If the build or start fails, check the logs for errors (e.g. missing env var, wrong Node version).

## 5. Get your app URL

- At the top of the service page, Render shows a URL like:
  `https://redfiniti-tracking.onrender.com`
- Open it in a browser. You should see your tracking page (same as `indexshipping.html`).
- Use this URL to:
  - Open the tracking app directly, or
  - Link to it from your main site (e.g. “Container tracking” / “Customer login”), or
  - Embed it in an iframe.

## 6. (Optional) Custom domain

- In the Render dashboard, open your service → **Settings** → **Custom Domain**.
- Add a domain (e.g. `tracking.sheshalogistics.com`) and follow Render’s instructions to point DNS to Render.

## 7. (Optional) Keep the free instance awake

- Free instances spin down after inactivity. The first request after that can be slow.
- To reduce that, you can use an external “ping” service (e.g. UptimeRobot) to hit your Render URL every few minutes, or upgrade to a paid plan so the instance stays on.

---

## Quick checklist

| Step | Done |
|------|------|
| 1. `.gitignore` includes `service-account-key.json` | ✓ |
| 2. Code pushed to GitHub (no key in repo) | |
| 3. Render Web Service created, linked to repo | |
| 4. Env var `SERVICE_ACCOUNT_JSON` set with full JSON | |
| 5. Deploy succeeded and app URL opens tracking page | |
