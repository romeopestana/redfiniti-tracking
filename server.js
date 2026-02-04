import express from "express";
import cors from "cors";
import fs from "fs";
import { google } from "googleapis";
import path from "path";
import { fileURLToPath } from "url";

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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


