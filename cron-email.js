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

// Validate configuration
console.log("=== Cron Job Startup ===");
console.log("Node version:", process.version);
console.log("Working directory:", process.cwd());
console.log("KEYFILE path:", KEYFILE);
console.log("KEYFILE exists:", fs.existsSync(KEYFILE));

// On Render: create service-account-key.json from env if file doesn't exist
if (process.env.SERVICE_ACCOUNT_JSON && !fs.existsSync(KEYFILE)) {
  console.log("Creating service-account-key.json from SERVICE_ACCOUNT_JSON env var...");
  try {
    const jsonContent = process.env.SERVICE_ACCOUNT_JSON;
    // Validate it's valid JSON
    JSON.parse(jsonContent);
    fs.writeFileSync(KEYFILE, jsonContent, "utf8");
    console.log("✓ service-account-key.json created successfully");
  } catch (err) {
    console.error("✗ Failed to create service-account-key.json:", err.message);
    if (err instanceof SyntaxError) {
      console.error("✗ SERVICE_ACCOUNT_JSON is not valid JSON");
    }
    process.exit(1);
  }
}

if (!fs.existsSync(KEYFILE)) {
  console.error("✗ ERROR: service-account-key.json not found and SERVICE_ACCOUNT_JSON not set");
  console.error("Please set SERVICE_ACCOUNT_JSON environment variable in Render");
  process.exit(1);
}

// Validate the key file is valid JSON
try {
  const keyContent = fs.readFileSync(KEYFILE, "utf8");
  const keyData = JSON.parse(keyContent);
  console.log("✓ service-account-key.json is valid JSON");
  console.log("Service account email:", keyData.client_email || "NOT FOUND");
  if (!keyData.client_email || !keyData.private_key) {
    console.error("✗ ERROR: service-account-key.json is missing required fields (client_email or private_key)");
    process.exit(1);
  }
} catch (err) {
  console.error("✗ ERROR: service-account-key.json is not valid JSON:", err.message);
  process.exit(1);
}

// Check email configuration
const useSendGrid = !!process.env.SENDGRID_API_KEY;
const hasSMTP = !!(process.env.SMTP_USER && process.env.SMTP_PASS);

console.log("Email config:", {
  method: useSendGrid ? "SendGrid" : hasSMTP ? "SMTP" : "NOT CONFIGURED",
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY ? "SET" : "NOT SET",
  SMTP_USER: process.env.SMTP_USER ? "SET" : "NOT SET",
  SMTP_PASS: process.env.SMTP_PASS ? "SET" : "NOT SET",
});

if (!useSendGrid && !hasSMTP) {
  console.error("✗ ERROR: No email configuration found");
  console.error("Please set either SENDGRID_API_KEY or SMTP_USER/SMTP_PASS");
  process.exit(1);
}

async function getSheetsClient() {
  try {
    console.log("Initializing Google Auth...");
    const auth = new google.auth.GoogleAuth({
      keyFile: KEYFILE,
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
      ],
    });
    
    console.log("Getting authenticated client...");
    const client = await auth.getClient();
    
    // Verify we can get credentials
    const credentials = await client.getAccessToken();
    if (!credentials.token) {
      throw new Error("Failed to get access token from service account");
    }
    console.log("✓ Successfully authenticated with Google");
    
    return google.sheets({ version: "v4", auth: client });
  } catch (err) {
    console.error("✗ Error initializing Google Sheets client:", err.message);
    if (err.message.includes("ENOENT")) {
      throw new Error(`Service account key file not found at ${KEYFILE}. Check SERVICE_ACCOUNT_JSON environment variable.`);
    }
    throw err;
  }
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
  const startTime = new Date().toISOString();
  console.log(`\n[${startTime}] ========================================`);
  console.log(`[${startTime}] Starting daily email job...`);
  console.log(`[${startTime}] ========================================\n`);

  try {
    console.log("Connecting to Google Sheets...");
    const sheets = await getSheetsClient();
    console.log("✓ Connected to Google Sheets API");
    
    // Test connection by getting spreadsheet metadata first
    console.log("Verifying access to spreadsheet...");
    try {
      const testResponse = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
        fields: "properties.title",
      });
      console.log(`✓ Access verified. Spreadsheet: ${testResponse.data.properties?.title || "Unknown"}`);
    } catch (testErr) {
      console.error("✗ Cannot access spreadsheet:", testErr.message);
      console.error("Error code:", testErr.code);
      console.error("Error response:", testErr.response?.data);
      
      if (testErr.message.includes("unregistered callers") || testErr.message.includes("API key")) {
        throw new Error(
          `Google Sheets API authentication failed.\n\n` +
          `This usually means:\n` +
          `1. Google Sheets API is not enabled in your Google Cloud project\n` +
          `   → Go to: https://console.cloud.google.com/apis/library/sheets.googleapis.com\n` +
          `   → Enable "Google Sheets API"\n\n` +
          `2. The service account key file is invalid or corrupted\n` +
          `   → Regenerate the service account key in Google Cloud Console\n\n` +
          `3. The service account email needs access to the sheet\n` +
          `   → Share the Google Sheet with: ${JSON.parse(fs.readFileSync(KEYFILE, "utf8")).client_email || "service account email"}`
        );
      }
      
      throw new Error(`Cannot access Google Sheet: ${testErr.message}`);
    }
    
    // Read USRPWD tab - columns A (Client), D-M (emails)
    console.log("Reading USRPWD tab...");
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "USRPWD!A1:M5000",
    });
    console.log(`✓ Read ${response.data.values?.length || 0} rows from USRPWD tab`);

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

    const endTime = new Date().toISOString();
    console.log(`\n[${endTime}] ========================================`);
    console.log(`[${endTime}] Daily email job completed:`);
    console.log(`  Success: ${successCount} rows`);
    console.log(`  Errors: ${errorCount} rows`);
    console.log(`[${endTime}] ========================================\n`);
  } catch (err) {
    console.error(`\n[${new Date().toISOString()}] FATAL ERROR in daily email job:`);
    console.error("Error message:", err.message);
    console.error("Error stack:", err.stack);
    if (err.response) {
      console.error("Error response:", err.response);
    }
    throw err; // Re-throw to be caught by outer handler
  }
}

// Run the job with comprehensive error handling
(async () => {
  try {
    await runDailyEmailJob();
    console.log("\n✓ Job finished successfully");
    process.exit(0);
  } catch (err) {
    console.error("\n✗ Job failed with error:");
    console.error("Message:", err.message);
    console.error("Code:", err.code);
    console.error("Stack:", err.stack);
    
    // Provide helpful error messages
    if (err.message.includes("service-account-key.json")) {
      console.error("\n💡 TIP: Make sure SERVICE_ACCOUNT_JSON is set in Render environment variables");
    } else if (err.message.includes("SMTP") || err.message.includes("email")) {
      console.error("\n💡 TIP: Check your email configuration (SMTP_USER/SMTP_PASS or SENDGRID_API_KEY)");
    } else if (err.message.includes("SHEET_ID") || err.message.includes("spreadsheet")) {
      console.error("\n💡 TIP: Verify the Google Sheet is shared with your service account email");
    }
    
    process.exit(1);
  }
})();
