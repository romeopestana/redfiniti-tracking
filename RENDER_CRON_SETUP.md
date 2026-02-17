# Render Cron Job Setup - Daily Email Reports

This guide shows how to set up automated daily email reports on Render that run at 8:30 AM Johannesburg time.

---

## Step 1: Create a Cron Job on Render

1. **Go to your Render Dashboard**: https://dashboard.render.com
2. **Click "New +"** → **"Cron Job"**
3. **Connect your GitHub repository** (same repo as your web service)
4. **Configure the Cron Job:**

   | Field | Value |
   |-------|-------|
   **Name** | `daily-email-reports` |
   **Schedule** | `30 6 * * *` (runs at 06:30 UTC daily = 08:30 Johannesburg time) |
   **Build Command** | `npm install` |
   **Start Command** | `npm run cron-email` |
   **Instance Type** | **Starter** ($7/month) - required for email sending |

5. **Click "Create Cron Job"**

---

## Step 2: Set Environment Variables

The Cron Job needs the same environment variables as your web service:

1. **Go to your Cron Job** → **Environment** tab
2. **Add these variables** (same values as your web service):

   | Variable | Description |
   |----------|-------------|
   `SERVICE_ACCOUNT_JSON` | Full contents of your `service-account-key.json` |
   `SMTP_HOST` | `smtp.gmail.com` (or your SMTP host) |
   `SMTP_PORT` | `587` |
   `SMTP_SECURE` | `false` |
   `SMTP_USER` | Your Gmail address |
   `SMTP_PASS` | Your Gmail App Password (16 chars, no spaces) |
   `FROM_EMAIL` | (Optional) Email address to send from |

   **OR if using SendGrid:**

   | Variable | Description |
   |----------|-------------|
   `SERVICE_ACCOUNT_JSON` | Full contents of your `service-account-key.json` |
   `SENDGRID_API_KEY` | Your SendGrid API key |
   `FROM_EMAIL` | Your verified sender email |

---

## Step 3: Verify Schedule

**Schedule format:** `30 6 * * *`
- `30` = minute (30th minute)
- `6` = hour (6 AM UTC)
- `*` = every day of month
- `*` = every month
- `*` = every day of week

**Time conversion:**
- **06:30 UTC** = **08:30 SAST** (South African Standard Time, Johannesburg)
- Johannesburg is UTC+2 year-round (no daylight saving)

---

## Step 4: Test Locally First

Before deploying to Render, test the cron job locally:

```bash
cd C:\Users\romeo\my-first-app
npm run cron-email
```

This will:
- Read all rows from USRPWD tab
- Generate PDFs for each Client tab
- Email them to addresses in columns D-M
- Show logs of what happened

---

## Step 5: Monitor Logs on Render

After the cron job runs, check the **Logs** tab in Render to see:
- Which rows were processed
- How many emails were sent
- Any errors that occurred

---

## How It Works

1. **Every day at 08:30 Johannesburg time** (06:30 UTC), Render runs `npm run cron-email`
2. The script reads the **USRPWD** tab
3. For each row (starting from row 2):
   - Gets **Client** tab name (column A)
   - Collects email addresses from **columns D-M**
   - Generates PDF of that Client tab
   - Emails PDF to all addresses in that row
4. Logs results for monitoring

---

## Troubleshooting

**Cron job not running:**
- Check Render logs for errors
- Verify environment variables are set
- Ensure Instance Type is Starter (not Free)

**Emails not sending:**
- Check SMTP/SendGrid credentials in environment variables
- Verify service account has access to Google Sheet
- Check logs for specific error messages

**PDF generation fails:**
- Ensure service account has Viewer access to the Google Sheet
- Check that Client tab names match exactly

---

## Schedule Examples

| Schedule | Description |
|----------|-------------|
| `30 6 * * *` | Daily at 06:30 UTC (08:30 Johannesburg) |
| `0 8 * * *` | Daily at 08:00 UTC (10:00 Johannesburg) |
| `0 6 * * 1-5` | Weekdays only at 06:00 UTC (08:00 Johannesburg) |

---

## Cost

- **Cron Job**: Requires **Starter** instance ($7/month)
- **Email sending**: 
  - Gmail SMTP: Free (with App Password)
  - SendGrid: Free tier (100 emails/day)

---

## Notes

- The cron job processes **all rows** in USRPWD that have:
  - A Client tab name (column A)
  - At least one valid email address (columns D-M)
- Empty email cells are skipped automatically
- Each row's PDF is sent to all emails in that row
- There's a 1-second delay between rows to avoid rate limiting
