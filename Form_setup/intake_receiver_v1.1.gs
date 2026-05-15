/**
 * SuperSymm Intake Receiver — Google Apps Script
 * Version 1.1 — adds optional logo upload support
 * 
 * Setup instructions are at the bottom of this file.
 * Last updated: May 2026
 */

// ═══════════════════════════════════════════════
// CONFIGURATION — EDIT THESE VALUES
// ═══════════════════════════════════════════════

const CONFIG = {
  // The Drive folder ID where intake files (markdown + logo) will be saved.
  DRIVE_FOLDER_ID: 'PASTE_YOUR_DRIVE_FOLDER_ID_HERE',
  
  // Your email — where notifications go when a new intake arrives.
  NOTIFICATION_EMAIL: 'YOUR_EMAIL@supersymm.com',
  
  // A shared secret — must match the value in the intake form's HTML.
  SHARED_SECRET: 'CHANGE_THIS_TO_A_RANDOM_STRING_AT_LEAST_20_CHARS',
  
  // Optional: subject line prefix for notification emails
  EMAIL_SUBJECT_PREFIX: '[New Intake]',
  
  // Logo file size hard limit (in bytes after base64 decoding).
  // 8MB covers any reasonably-sized SVG/PNG/JPG/PDF logo.
  MAX_LOGO_SIZE_BYTES: 8 * 1024 * 1024,
};

// Allowed logo MIME types — must match the form's allow-list
const ALLOWED_LOGO_MIME_TYPES = [
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'application/pdf'
];

const MIME_TO_EXTENSION = {
  'image/svg+xml': 'svg',
  'image/png':     'png',
  'image/jpeg':    'jpg',
  'image/jpg':     'jpg',
  'application/pdf': 'pdf'
};

// ═══════════════════════════════════════════════
// MAIN HANDLERS
// ═══════════════════════════════════════════════

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    if (data.secret !== CONFIG.SHARED_SECRET) {
      return jsonResponse({ success: false, error: 'Invalid request' });
    }
    
    if (!data.markdown || !data.firmName) {
      return jsonResponse({ success: false, error: 'Missing required fields' });
    }
    
    // Generate matched filename base for markdown + (optional) logo
    const timestamp = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd_HHmm');
    const safeShortName = sanitizeFilename(data.shortName || 'client');
    const fileBase = `${timestamp}_${safeShortName}`;
    const markdownFilename = `${fileBase}_intake.md`;
    
    const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
    
    // Write markdown to Drive
    const mdFile = folder.createFile(markdownFilename, data.markdown, MimeType.PLAIN_TEXT);
    const mdFileUrl = mdFile.getUrl();
    
    // Write logo to Drive if provided
    let logoInfo = null;
    if (data.logo && data.logo.base64 && data.logo.mimeType) {
      logoInfo = handleLogoUpload(data.logo, fileBase, folder);
      // If logo handling failed, log it but don't fail the whole submission —
      // the markdown is the critical part
      if (logoInfo && logoInfo.error) {
        console.warn('Logo upload issue:', logoInfo.error);
      }
    }
    
    // Send notification email
    sendNotificationEmail(data, markdownFilename, mdFileUrl, logoInfo);
    
    return jsonResponse({
      success: true,
      message: 'Intake received',
      filename: markdownFilename,
      logoReceived: !!(logoInfo && logoInfo.file)
    });
    
  } catch (err) {
    console.error('Intake submission error:', err);
    return jsonResponse({
      success: false,
      error: 'Server error: ' + err.message
    });
  }
}

function doGet(e) {
  return jsonResponse({
    success: true,
    message: 'Intake receiver is alive',
    version: '1.1',
    timestamp: new Date().toISOString()
  });
}

// ═══════════════════════════════════════════════
// LOGO HANDLING
// ═══════════════════════════════════════════════

/**
 * Validates and writes a logo file to the Drive folder.
 * Returns { file, filename, url } on success or { error } on failure.
 */
function handleLogoUpload(logoData, fileBase, folder) {
  // Validate MIME type
  const mimeType = String(logoData.mimeType || '').toLowerCase();
  if (ALLOWED_LOGO_MIME_TYPES.indexOf(mimeType) === -1) {
    return { error: 'Unsupported logo file type: ' + mimeType };
  }
  
  // Decode base64
  let bytes;
  try {
    bytes = Utilities.base64Decode(logoData.base64);
  } catch (err) {
    return { error: 'Failed to decode logo base64: ' + err.message };
  }
  
  // Validate size
  if (bytes.length > CONFIG.MAX_LOGO_SIZE_BYTES) {
    return { error: `Logo file too large: ${bytes.length} bytes (max ${CONFIG.MAX_LOGO_SIZE_BYTES})` };
  }
  
  // Build filename
  const extension = MIME_TO_EXTENSION[mimeType] || 'bin';
  const logoFilename = `${fileBase}_logo.${extension}`;
  
  // Create blob and write to Drive
  const blob = Utilities.newBlob(bytes, mimeType, logoFilename);
  const logoFile = folder.createFile(blob);
  
  return {
    file: logoFile,
    filename: logoFilename,
    url: logoFile.getUrl(),
    mimeType: mimeType,
    sizeBytes: bytes.length,
    blob: blob  // pass through for email attachment
  };
}

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function sanitizeFilename(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 40)
    || 'client';
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function sendNotificationEmail(data, markdownFilename, mdFileUrl, logoInfo) {
  const firmName = data.firmName || 'Unknown firm';
  const industry = data.industry || 'unspecified';
  const tier = data.tier || 'unspecified';
  const contactName = data.contactName || '';
  const contactEmail = data.contactEmail || '';
  
  const subject = `${CONFIG.EMAIL_SUBJECT_PREFIX} ${firmName} (${industry}, Tier ${tier})`;
  
  const logoLine = logoInfo && logoInfo.file
    ? `Logo:          ${logoInfo.filename} (${formatBytes(logoInfo.sizeBytes)})`
    : 'Logo:          (not provided)';
  
  const plainBody = [
    'A new intake has been submitted.',
    '',
    `Firm:          ${firmName}`,
    `Industry:      ${industry}`,
    `Tier:          ${tier}`,
    `Contact:       ${contactName} <${contactEmail}>`,
    '',
    `Markdown:      ${markdownFilename}`,
    `Drive link:    ${mdFileUrl}`,
    logoLine,
    logoInfo && logoInfo.url ? `Logo link:     ${logoInfo.url}` : '',
    '',
    'Full markdown is attached. Logo (if provided) is attached as well.',
    '',
    '— SuperSymm Intake Receiver v1.1'
  ].filter(Boolean).join('\n');
  
  const logoHtmlRow = logoInfo && logoInfo.file
    ? `<tr><td style="padding: 4px 16px 4px 0; color: #6B6253;">Logo</td><td style="padding: 4px 0;"><a href="${logoInfo.url}" style="color: #B84A2C;">${escapeHtml(logoInfo.filename)}</a> · ${formatBytes(logoInfo.sizeBytes)}</td></tr>`
    : `<tr><td style="padding: 4px 16px 4px 0; color: #6B6253;">Logo</td><td style="padding: 4px 0; color: #968C7A; font-style: italic;">not provided</td></tr>`;
  
  const htmlBody = `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; color: #1F1B14;">
      <h2 style="font-size: 22px; margin-bottom: 16px; color: #1F1B14;">New intake submitted</h2>
      <table style="border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
        <tr><td style="padding: 4px 16px 4px 0; color: #6B6253;">Firm</td><td style="padding: 4px 0;"><strong>${escapeHtml(firmName)}</strong></td></tr>
        <tr><td style="padding: 4px 16px 4px 0; color: #6B6253;">Industry</td><td style="padding: 4px 0;">${escapeHtml(industry)}</td></tr>
        <tr><td style="padding: 4px 16px 4px 0; color: #6B6253;">Tier</td><td style="padding: 4px 0;">Tier ${escapeHtml(tier)}</td></tr>
        <tr><td style="padding: 4px 16px 4px 0; color: #6B6253;">Contact</td><td style="padding: 4px 0;">${escapeHtml(contactName)} &lt;${escapeHtml(contactEmail)}&gt;</td></tr>
        ${logoHtmlRow}
      </table>
      <p style="font-size: 14px; line-height: 1.6;">
        <a href="${mdFileUrl}" style="color: #B84A2C; font-weight: 600;">Open markdown in Drive →</a>
      </p>
      <p style="font-size: 13px; color: #968C7A; margin-top: 24px;">
        Files attached: <code>${escapeHtml(markdownFilename)}</code>${logoInfo && logoInfo.file ? ` and <code>${escapeHtml(logoInfo.filename)}</code>` : ''}
      </p>
    </div>
  `;
  
  // Build attachments — always include markdown, include logo if provided
  const attachments = [
    Utilities.newBlob(data.markdown, 'text/markdown', markdownFilename)
  ];
  if (logoInfo && logoInfo.blob) {
    attachments.push(logoInfo.blob);
  }
  
  MailApp.sendEmail({
    to: CONFIG.NOTIFICATION_EMAIL,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody,
    attachments: attachments
  });
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Test function — run from Apps Script editor after setup
 * to verify Drive and email permissions are granted.
 */
function testConfiguration() {
  console.log('Testing configuration...');
  
  try {
    const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
    console.log('✓ Drive folder accessible: ' + folder.getName());
  } catch (err) {
    console.error('✗ Drive folder error: ' + err.message);
    console.error('  Check that DRIVE_FOLDER_ID is correct.');
    return;
  }
  
  try {
    MailApp.sendEmail({
      to: CONFIG.NOTIFICATION_EMAIL,
      subject: '[Test] SuperSymm Intake Receiver v1.1 is configured',
      body: 'This is a test email. v1.1 supports optional logo upload (SVG, PNG, JPG, PDF).'
    });
    console.log('✓ Test email sent to ' + CONFIG.NOTIFICATION_EMAIL);
  } catch (err) {
    console.error('✗ Email error: ' + err.message);
    return;
  }
  
  console.log('All checks passed. Ready to deploy as web app.');
}


/* ═══════════════════════════════════════════════
 * SETUP INSTRUCTIONS — same as v1.0
 * ═══════════════════════════════════════════════
 *
 * If you already deployed v1.0:
 * - Edit your existing Apps Script project
 * - Replace the code with this v1.1 version
 * - Keep your existing CONFIG values
 * - Click Deploy → Manage deployments → edit pencil → New version → Deploy
 * - The web app URL stays the same; the form needs no changes
 *
 * If you haven't deployed yet, follow these steps:
 *
 * 1. Create a Drive folder for intakes. Get the folder ID from the URL.
 *
 * 2. Update CONFIG above:
 *    - DRIVE_FOLDER_ID: paste the folder ID
 *    - NOTIFICATION_EMAIL: your email
 *    - SHARED_SECRET: random 20+ char string (must match the form's value)
 *
 * 3. Save the project (Cmd/Ctrl+S). Name it "SuperSymm Intake Receiver".
 *
 * 4. Run testConfiguration() to verify Drive + email permissions.
 *    First run will prompt for permissions. Grant them.
 *
 * 5. Deploy → New deployment → Web app:
 *    - Execute as: Me
 *    - Who has access: Anyone
 *    - Click Deploy, copy the web app URL
 *
 * 6. Paste the URL and SHARED_SECRET into the form HTML
 *    (supersymm_intake_form_v1.3.html).
 *
 * 7. Test end-to-end with a fake submission, including a logo upload.
 *
 * TROUBLESHOOTING LOGO UPLOADS
 * - "Logo file too large" — file exceeds 8MB after decoding
 * - "Unsupported logo file type" — file isn't SVG/PNG/JPG/PDF
 * - Logo email attachment missing — check Apps Script Executions tab
 *   for any base64 decode errors
 * - Apps Script email size limit is 25MB per email; a large markdown
 *   plus a large logo could exceed this. In practice, logos under 8MB
 *   + markdown under 100KB will always fit.
 */
