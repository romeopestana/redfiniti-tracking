import express from "express";
import cors from "cors";
import fs from "fs";
import { google } from "googleapis";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// On Render: create service-account-key.json from env if file doesn't exist
const KEYFILE = path.join(__dirname, "service-account-key.json");
if (process.env.SERVICE_ACCOUNT_JSON && !fs.existsSync(KEYFILE)) {
  fs.writeFileSync(KEYFILE, process.env.SERVICE_ACCOUNT_JSON, "utf8");
}

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files (so visiting http://localhost:4000 shows your page)
app.use(express.static(__dirname));

// If you want the root URL to open the tracking page specifically:
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "indexshipping.html"));
});

// === CONFIGURE THESE VALUES ===
const SHEET_ID = "10y_pzCwdu-iqdylknQKFvZvz1EP-bHBIqAGBB4660kY";

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILE,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// Existing example endpoint (by container number + optional line)
app.get("/api/containers", async (req, res) => {
  const containerNumber = (req.query.number || "").trim().toUpperCase();
  const line = (req.query.line || "").trim().toUpperCase();

  if (!containerNumber) {
    return res.status(400).json({ error: "Missing container number" });
  }

  try {
    // Default to "Sheet1" tab for this endpoint
    const RANGE = "Sheet1!A1:Z1000";

    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: RANGE,
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      return res.status(404).json({ error: "No data in sheet" });
    }

    const header = rows[0].map((h) => (h || "").trim());
    const dataRows = rows.slice(1);

    // Assume first column is container number, second column might be shipping line (optional).
    const match = dataRows.find((row) => {
      const rowContainer = (row[0] || "").trim().toUpperCase();
      const rowLine = (row[1] || "").trim().toUpperCase();
      const containerMatches = rowContainer === containerNumber;
      const lineMatches = !line || rowLine === line;
      return containerMatches && lineMatches;
    });

    if (!match) {
      return res.status(404).json({ error: "Container not found" });
    }

    // Turn row into object: { HeaderName: CellValue }
    const result = {};
    header.forEach((key, idx) => {
      if (!key) return;
      result[key.replace(/\s+/g, "")] = match[idx] || "";
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to read Google Sheet" });
  }
});

// New endpoint: return full tab data by sheet/tab name (used for Secure Customer Access)
// GET /api/tab?sheet=TabName
app.get("/api/tab", async (req, res) => {
  const sheetName = (req.query.sheet || "").trim();
  if (!sheetName) {
    return res.status(400).json({ error: "Missing sheet/tab name" });
  }

  try {
    // Quote sheet name to support spaces/special characters, escape single quotes per Sheets A1 syntax
    const safeSheetName = `'${sheetName.replace(/'/g, "''")}'`;
    const range = `${safeSheetName}!A1:Z1000`;

    const sheets = await getSheetsClient();
    // Use spreadsheets.get with grid data so we can see which rows are hidden
    const response = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      ranges: [range],
      includeGridData: true,
      fields:
        "sheets(data(rowMetadata(hiddenByUser),rowData(values(formattedValue))))",
    });

    const sheet = response.data.sheets?.[0];
    const data = sheet?.data?.[0];
    const rowMetadata = data?.rowMetadata || [];
    const rowData = data?.rowData || [];

    if (!rowData.length) {
      return res.status(404).json({ error: "No data in this tab" });
    }

    // Helper to determine if a row index is hidden
    const isHidden = (idx) =>
      rowMetadata[idx]?.hiddenByUser === true;

    // Use Row 2 (index 1) as the column header row in every tab
    const headerRowIndex = 1;
    if (!rowData[headerRowIndex]) {
      return res.status(404).json({ error: "Row 2 (header row) not found in this tab" });
    }

    const header = (rowData[headerRowIndex].values || []).map(
      (cell) => cell?.formattedValue ?? ""
    );
    if (!header.length) {
      return res.status(404).json({ error: "Row 2 (header row) is empty in this tab" });
    }

    const dataRows = [];
    for (let i = headerRowIndex + 1; i < rowData.length; i++) {
      if (isHidden(i)) continue; // skip hidden rows
      const values = rowData[i].values || [];
      const row = header.map(
        (_, colIdx) => values[colIdx]?.formattedValue ?? ""
      );
      dataRows.push(row);
    }

    res.json({ header, rows: dataRows });
  } catch (err) {
    // Log more detail server-side, but keep client message generic
    console.error("Error reading tab:", err?.response?.data || err.message || err);
    res.status(500).json({ error: "Failed to read requested tab" });
  }
});

// Login endpoint: validate username/password against USRPWD tab
// Tab USRPWD:
// - Column A (Client): tab name to open
// - Column B (USERNAME): login username
// - Column C (PWD): login password
app.post("/api/login", async (req, res) => {
  const username = (req.body.username || "").trim();
  const password = (req.body.password || "").trim();

  if (!username || !password) {
    return res.status(400).json({ error: "Missing username or password" });
  }

  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "USRPWD!A1:M1000", // Columns A-M to include email addresses (D-M)
    });

    const rows = response.data.values || [];
    if (rows.length < 2) {
      return res.status(404).json({ error: "No user data in USRPWD tab" });
    }

    // Assume row 1 is header (Client, USERNAME, PWD, then email columns D-M); data starts from row 2
    const dataRows = rows.slice(1);
    const match = dataRows.find((row) => {
      const rowClient = (row[0] || "").trim();
      const rowUser = (row[1] || "").trim();
      const rowPwd = (row[2] || "").trim();
      return rowUser === username && rowPwd === password && rowClient;
    });

    if (!match) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const clientTab = (match[0] || "").trim();
    if (!clientTab) {
      return res.status(500).json({ error: "Client tab not configured for this user" });
    }

    // Get authorized email addresses from columns D-M (indices 3-12)
    const authorizedEmails = [];
    for (let colIdx = 3; colIdx <= 12; colIdx++) {
      const email = (match[colIdx] || "").trim();
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        authorizedEmails.push(email);
      }
    }

    res.json({ client: clientTab, username, authorizedEmails });
  } catch (err) {
    console.error("Error during login:", err?.response?.data || err.message || err);
    res.status(500).json({ error: "Failed to validate login" });
  }
});

// Get authorized email addresses for a user
// GET /api/authorized-emails?username=...
app.get("/api/authorized-emails", async (req, res) => {
  const username = (req.query.username || "").trim();

  if (!username) {
    return res.status(400).json({ error: "Missing username" });
  }

  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "USRPWD!A1:M1000",
    });

    const rows = response.data.values || [];
    if (rows.length < 2) {
      return res.status(404).json({ error: "No user data in USRPWD tab" });
    }

    const dataRows = rows.slice(1);
    const match = dataRows.find((row) => {
      const rowUser = (row[1] || "").trim();
      return rowUser === username;
    });

    if (!match) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get authorized email addresses from columns D-M (indices 3-12)
    const authorizedEmails = [];
    for (let colIdx = 3; colIdx <= 12; colIdx++) {
      const email = (match[colIdx] || "").trim();
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        authorizedEmails.push(email);
      }
    }

    res.json({ authorizedEmails });
  } catch (err) {
    console.error("Error getting authorized emails:", err?.response?.data || err.message || err);
    res.status(500).json({ error: "Failed to get authorized emails" });
  }
});

// Get PDF export URL for a specific tab (landscape mode)
// GET /api/pdf-url?sheet=TabName
app.get("/api/pdf-url", async (req, res) => {
  const sheetName = (req.query.sheet || "").trim();
  if (!sheetName) {
    return res.status(400).json({ error: "Missing sheet/tab name" });
  }

  try {
    const sheets = await getSheetsClient();
    // Get spreadsheet metadata to find the tab ID (gid)
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      fields: "sheets.properties(title,sheetId)",
    });

    const sheetsList = metadata.data.sheets || [];
    console.log("Available tabs:", sheetsList.map(s => s.properties?.title));
    console.log("Looking for tab:", sheetName);

    // Try exact match first
    let targetSheet = sheetsList.find(
      (s) => (s.properties?.title || "").trim() === sheetName
    );

    // If not found, try case-insensitive match
    if (!targetSheet) {
      targetSheet = sheetsList.find(
        (s) => (s.properties?.title || "").trim().toLowerCase() === sheetName.toLowerCase()
      );
    }

    if (!targetSheet || !targetSheet.properties?.sheetId) {
      console.error("Tab not found. Available tabs:", sheetsList.map(s => s.properties?.title));
      return res.status(404).json({ 
        error: `Tab "${sheetName}" not found. Available tabs: ${sheetsList.map(s => s.properties?.title).join(", ")}` 
      });
    }

    const tabId = targetSheet.properties.sheetId;
    console.log("Found tab ID:", tabId, "for tab:", targetSheet.properties.title);
    
    // Construct Google Sheets PDF export URL (landscape mode)
    // portrait=false means landscape
    const pdfUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=pdf&gid=${tabId}&portrait=false`;

    res.json({ pdfUrl });
  } catch (err) {
    console.error("Error getting PDF URL:", err?.response?.data || err.message || err);
    const errorMsg = err?.response?.data?.error?.message || err.message || "Unknown error";
    res.status(500).json({ 
      error: "Failed to generate PDF URL",
      details: errorMsg 
    });
  }
});

// Email PDF endpoint
// POST /api/email-pdf
// Body: { sheet: "TabName", email: "user@example.com" }
app.post("/api/email-pdf", async (req, res) => {
  const sheetName = (req.body.sheet || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();

  if (!sheetName) {
    return res.status(400).json({ error: "Missing sheet/tab name" });
  }
  if (!email) {
    return res.status(400).json({ error: "Missing email address" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email address format" });
  }

  // Email configuration from environment variables
  const emailConfig = {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  };

  if (!emailConfig.auth.user || !emailConfig.auth.pass) {
    return res.status(500).json({ 
      error: "Email service not configured. Please set SMTP_USER and SMTP_PASS environment variables." 
    });
  }

  try {
    const sheets = await getSheetsClient();
    // Get spreadsheet metadata to find the tab ID (gid)
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      fields: "sheets.properties(title,sheetId)",
    });

    const sheetsList = metadata.data.sheets || [];
    let targetSheet = sheetsList.find(
      (s) => (s.properties?.title || "").trim() === sheetName
    );

    if (!targetSheet) {
      targetSheet = sheetsList.find(
        (s) => (s.properties?.title || "").trim().toLowerCase() === sheetName.toLowerCase()
      );
    }

    if (!targetSheet || !targetSheet.properties?.sheetId) {
      return res.status(404).json({ error: `Tab "${sheetName}" not found` });
    }

    const tabId = targetSheet.properties.sheetId;
    
    // Get authenticated access token
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

    // Use authenticated export URL with access token in Authorization header
    const pdfUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=pdf&gid=${tabId}&portrait=false`;
    
    const pdfHttpResponse = await fetch(pdfUrl, {
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
      },
    });
    
    if (!pdfHttpResponse.ok) {
      const errorText = await pdfHttpResponse.text();
      throw new Error(`Failed to download PDF: ${pdfHttpResponse.statusText} - ${errorText}`);
    }
    const pdfBuffer = Buffer.from(await pdfHttpResponse.arrayBuffer());

    // Create email transporter
    const transporter = nodemailer.createTransport(emailConfig);

    // Send email with PDF attachment
    const mailOptions = {
      from: `"Shesha Logistics" <${emailConfig.auth.user}>`,
      to: email,
      subject: `Shipment Tracking Report - ${targetSheet.properties.title}`,
      text: `Please find attached your shipment tracking report for ${targetSheet.properties.title}.`,
      html: `
        <p>Dear Customer,</p>
        <p>Please find attached your shipment tracking report for <strong>${targetSheet.properties.title}</strong>.</p>
        <p>Best regards,<br>Shesha Logistics</p>
      `,
      attachments: [
        {
          filename: `${targetSheet.properties.title}_Report.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    };

    await transporter.sendMail(mailOptions);

    res.json({ 
      success: true, 
      message: `PDF has been sent to ${email}` 
    });
  } catch (err) {
    console.error("Error emailing PDF:", err);
    res.status(500).json({ 
      error: "Failed to email PDF",
      details: err.message 
    });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


