# Production Rollback Checklist

Safety checkpoint tag: **`prod-safe-2026-06-16`**  
Commit: `71ccb56` — *Remove duplicate local cron testing heading.*

Use this if a future deploy (login audit / Drive sync / monitor page) needs to be reverted.

---

## Quick rollback (Render — fastest)

1. Open [Render Dashboard](https://dashboard.render.com) → your **web service**.
2. Go to **Deploys**.
3. Find the last **successful** deploy from before the bad release.
4. Click **Redeploy** on that deploy.
5. Confirm the site and cron jobs behave normally.

**Cron jobs** are separate services — only redeploy them if their config or code changed in the bad release.

---

## Git rollback (code on `main`)

### Option A — Revert a merge commit (keeps history)

```bash
git checkout main
git pull origin main
git log --oneline -10
git revert -m 1 <merge-commit-hash>
git push origin main
```

Render will auto-deploy the reverted `main` if connected.

### Option B — Reset to safety tag (use only if you intend to force-align `main`)

```bash
git checkout main
git pull origin main
git reset --hard prod-safe-2026-06-16
git push origin main
```

> **Warning:** `reset --hard` + push rewrites `main`. Coordinate with anyone else using the repo. Prefer **Option A** or Render redeploy when possible.

---

## Verify after rollback

- [ ] Login page loads: `/`
- [ ] Valid customer login works
- [ ] Secure view loads shipment data
- [ ] Morning cron: `daily-email-reports-06h30` (weekdays 08:30 JHB)
- [ ] TNL cron: `daily-email-reports-tnl-16h00` (weekdays 16:00 JHB)
- [ ] No new errors in Render web service logs
- [ ] No unintended env var changes left in place

---

## What this checkpoint includes

- Dual weekday cron jobs (all customers + TNL-only)
- Safe email guardrails (`EMAIL_MODE`, `SAFE_EMAIL_RECIPIENTS`)
- Updated `CUSTOMER_OVERVIEW.md` and `PROJECT_DOCUMENTATION.md`

## What this checkpoint does **not** include

- Login audit CSV logging
- `login-audit-monitor.html` live monitor
- Google Drive audit sync

Those remain on branch `feature/login-audit-drive-sync` until merged and deployed.

---

## Before the next production upgrade

1. Confirm this tag exists: `git show prod-safe-2026-06-16`
2. Test changes locally on the feature branch.
3. Merge to `main` only when ready.
4. Deploy and run the verify checklist above.
5. If broken, use **Quick rollback (Render)** first.
