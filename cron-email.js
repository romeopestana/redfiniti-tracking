import fs from "fs";
import { google } from "googleapis";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const SHEET_ID = "10y_pzCwdu-iqdylknQKFvZvz1EP-bHBIqAGBB4660kY";
const KEYFILE = path.join(__dirname, "service-account-key.json");

// On Render: create service-account-key.json from env if file doesn't exist
if (process.env.SERVICE_ACCOUNT_JSON && !fs.existsSync(KEYFILE)) {
  fs.writeFileSync(KEYFILE, process.env.SERVICE_ACCOUNT_JSON, "utf8");
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILE,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

async function getEmailTransporter() {
  const useSendGrid = process.env.SENDGRID_API_KEY;
  
  if (useSendGrid) {
    return nodemailer.createTransport({
      host: "smtp.sendgrid.net",
      port: 587,
      secure: false,
      auth: {
        user: "apikey",
        pass: process.env.SENDGRID_API_KEY,
      },
    });
  } else {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
}

async function getTabId(sheets, tabName) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: "sheets.properties(title,sheetId)",
  });

  const sheetsList = metadata.data.sheets || [];
  let targetSheet = sheetsList.find(
    (s) => (s.properties?.title || "").trim() === tabName
  );

  if (!targetSheet) {
    targetSheet = sheetsList.find(
      (s) => (s.properties?.title || "").trim().toLowerCase() === tabName.toLowerCase()
    );
  }

  if (!targetSheet?.properties?.sheetId) {
    throw new Error(`Tab "${tabName}" not found`);
  }

  return targetSheet.properties.sheetId;
}

async function downloadPDF(tabName, tabId) {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILE,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
  const authClient = await auth.getClient();
  const accessToken = await authClient.getAccessToken();

  if (!accessToken.token) {
    throw new Error("Failed to get access token for PDF export");
  }

  const pdfUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=pdf&gid=${tabId}&portrait=false`;
  
  const pdfResponse = await fetch(pdfUrl, {
    headers: {
      Authorization: `Bearer ${accessToken.token}`,
    },
  });
  
  if (!pdfResponse.ok) {
    const errorText = await pdfResponse.text();
    throw new Error(`Failed to download PDF: ${pdfResponse.statusText} - ${errorText}`);
  }
  
  return Buffer.from(await pdfResponse.arrayBuffer());
}

async function sendEmail(transporter, emails, tabName, pdfBuffer) {
  const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER || "noreply@sheshalogistics.com";
  
  const mailOptions = {
    from: `"Shesha Logistics" <${fromEmail}>`,
    to: emails.join(", "),
    subject: `Daily Shipment Tracking Report - ${tabName}`,
    text: `Please find attached your daily shipment tracking report for ${tabName}.`,
    html: `
      <p>Dear Customer,</p>
      <p>Please find attached your daily shipment tracking report for <strong>${tabName}</strong>.</p>
      <p>This is an automated daily report.</p>
      <p>Best regards,<br>Shesha Logistics</p>
    `,
    attachments: [
      {
        filename: `${tabName}_Daily_Report.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  };

  const result = await transporter.sendMail(mailOptions);
  return result;
}

async function runDailyEmailJob() {
  console.log(`[${new Date().toISOString()}] Starting daily email job...`);

  try {
    const sheets = await getSheetsClient();
    
    // Read USRPWD tab - columns A (Client), D-M (emails)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "USRPWD!A1:M1000",
    });

    const rows = response.data.values || [];
    if (rows.length < 2) {
      console.log("No data rows found in USRPWD tab");
      return;
    }

    // Skip header row (row 1), process from row 2 onwards
    const dataRows = rows.slice(1);
    const transporter = await getEmailTransporter();

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2; // Row number in sheet (accounting for header)

      const clientTab = (row[0] || "").trim();
      if (!clientTab) {
        console.log(`Row ${rowNum}: Skipping - no Client tab name`);
        continue;
      }

      // Collect email addresses from columns D-M (indices 3-12)
      const emails = [];
      for (let colIdx = 3; colIdx <= 12; colIdx++) {
        const email = (row[colIdx] || "").trim();
        if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          emails.push(email);
        }
      }

      if (emails.length === 0) {
        console.log(`Row ${rowNum} (${clientTab}): Skipping - no email addresses`);
        continue;
      }

      try {
        console.log(`Row ${rowNum} (${clientTab}): Processing ${emails.length} email(s)...`);
        
        // Get tab ID
        const tabId = await getTabId(sheets, clientTab);
        
        // Download PDF
        const pdfBuffer = await downloadPDF(clientTab, tabId);
        console.log(`Row ${rowNum} (${clientTab}): PDF downloaded (${pdfBuffer.length} bytes)`);
        
        // Send email
        const emailResult = await sendEmail(transporter, emails, clientTab, pdfBuffer);
        console.log(`Row ${rowNum} (${clientTab}): Email sent successfully to ${emails.join(", ")}`);
        successCount++;

        // Small delay between emails to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        console.error(`Row ${rowNum} (${clientTab}): Error - ${err.message}`);
        errorCount++;
      }
    }

    console.log(`\n[${new Date().toISOString()}] Daily email job completed:`);
    console.log(`  Success: ${successCount} rows`);
    console.log(`  Errors: ${errorCount} rows`);
  } catch (err) {
    console.error(`Fatal error in daily email job:`, err);
    process.exit(1);
  }
}

// Run the job
runDailyEmailJob()
  .then(() => {
    console.log("Job finished successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Job failed:", err);
    process.exit(1);
  });
