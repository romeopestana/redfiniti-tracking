# Cron Job Troubleshooting Guide

## Error: "Method doesn't allow unregistered callers"

This error means Google Sheets API authentication is failing. Follow these steps:

---

### **Step 1: Enable Google Sheets API**

1. **Go to Google Cloud Console**: https://console.cloud.google.com/
2. **Select your project** (the one where you created the service account)
3. **Go to APIs & Services** → **Library**
4. **Search for "Google Sheets API"**
5. **Click on it** → **Enable**
6. **Also enable "Google Drive API"** (needed for PDF export)

---

### **Step 2: Verify Service Account Key**

1. **Check your service account key file**:
   - Go to Google Cloud Console → **IAM & Admin** → **Service Accounts**
   - Find your service account
   - Click **Keys** → **Add Key** → **Create new key** → **JSON**
   - Download the new key file

2. **Verify the key file contains**:
   - `client_email` (looks like `xxx@xxx.iam.gserviceaccount.com`)
   - `private_key`
   - `project_id`

3. **Update Render environment variable**:
   - Open the downloaded JSON file
   - Copy the **entire contents** (all of it, including `{` and `}`)
   - In Render → Cron Job → **Environment**
   - Set `SERVICE_ACCOUNT_JSON` = paste the full JSON content

---

### **Step 3: Share Google Sheet with Service Account**

1. **Get the service account email**:
   - From your `service-account-key.json` file
   - Look for `"client_email": "xxx@xxx.iam.gserviceaccount.com"`

2. **Share your Google Sheet**:
   - Open your Google Sheet
   - Click **Share** button
   - Add the service account email (e.g., `xxx@xxx.iam.gserviceaccount.com`)
   - Give it **Viewer** or **Editor** access
   - Click **Send**

---

### **Step 4: Verify Environment Variables in Render**

In your **Cron Job** → **Environment**, ensure:

| Variable | Status |
|----------|--------|
| `SERVICE_ACCOUNT_JSON` | ✅ Set (full JSON content) |
| `SMTP_USER` + `SMTP_PASS` OR `SENDGRID_API_KEY` | ✅ Set |

---

### **Step 5: Check Render Logs**

After redeploying, check the logs for:

✅ **Good signs:**
```
✓ service-account-key.json is valid JSON
Service account email: xxx@xxx.iam.gserviceaccount.com
✓ Successfully authenticated with Google
✓ Access verified. Spreadsheet: [Your Sheet Name]
```

❌ **Bad signs:**
```
✗ ERROR: service-account-key.json is missing required fields
✗ Cannot access spreadsheet
Method doesn't allow unregistered callers
```

---

### **Step 6: Test Locally**

Before deploying to Render, test locally:

```bash
cd C:\Users\romeo\my-first-app
npm run cron-email
```

If it works locally but not on Render, the issue is likely:
- Environment variables not set correctly in Render
- Service account key file not being created from `SERVICE_ACCOUNT_JSON`

---

### **Common Issues**

**Issue:** `SERVICE_ACCOUNT_JSON` is set but still getting errors
- **Fix:** Make sure you copied the **entire** JSON file content, including the opening `{` and closing `}`
- **Check:** In Render logs, look for "service-account-key.json is valid JSON" - if this fails, your JSON is malformed

**Issue:** "Cannot access spreadsheet"
- **Fix:** Share the Google Sheet with the service account email (from the key file)

**Issue:** "Google Sheets API is not enabled"
- **Fix:** Enable it in Google Cloud Console (see Step 1)

---

### **Quick Checklist**

- [ ] Google Sheets API enabled in Google Cloud project
- [ ] Google Drive API enabled in Google Cloud project
- [ ] Service account key file downloaded and verified
- [ ] `SERVICE_ACCOUNT_JSON` set in Render (full JSON content)
- [ ] Google Sheet shared with service account email
- [ ] Email configuration set (SMTP or SendGrid)
- [ ] Cron Job redeployed after setting variables

---

### **Still Not Working?**

Check Render logs and look for:
1. The exact error message
2. Whether "service-account-key.json is valid JSON" appears
3. What the "Service account email" shows
4. Any authentication errors

Share these details for further troubleshooting.
