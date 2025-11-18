#!/usr/bin/env node

/**
 * arjson2tree.js
 *
 * Parses JSON input containing ArDrive file metadata and generates an HTML index file
 * with a table displaying file information in a tree-like structure.
 *
 * Usage examples:
 *   ./enode.sh jsutils/arjson2tree.js < input.json > index.html
 *   ./enode.sh jsutils/arjson2tree.js --input=input.json --output=index.html
 *   ./enode.sh jsutils/arjson2tree.js --ltrim=2 < input.json > index.html
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const trimmed = arg.slice(2);
    if (trimmed === 'help' || trimmed === 'h') {
      args.help = true;
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex >= 0) {
      const key = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);
      args[key] = value;
    } else {
      const key = trimmed;
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage: arjson2tree.js [options]\n\n` +
    `Options:\n` +
    `  --input=PATH        Path to input JSON file (default: read from stdin)\n` +
    `  --output=PATH       Path to output HTML file (default: write to stdout)\n` +
    `  --ltrim=N           Number of path components to remove from links (default: 2)\n` +
    `  --help              Show this help text\n\n` +
    `Examples:\n` +
    `  ./enode.sh jsutils/arjson2tree.js < input.json > index.html\n` +
    `  ./enode.sh jsutils/arjson2tree.js --input=data.json --output=index.html --ltrim=2\n`);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

function createRelativeLink(fullPath, ltrim) {
  if (!fullPath || fullPath === '/') return '';
  const parts = fullPath.split('/').filter(p => p);
  if (parts.length <= ltrim) return '';
  return parts.slice(ltrim).join('/');
}

function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateHTML(data, ltrim) {
  const inlineCSS = `
    <style>
      body {
        background-color: #1e1e28;
        color: #ddd;
        font-family: "Segoe UI", "Open Sans", sans-serif;
        margin: 0;
        padding: 0;
      }
      .page-header {
        text-align: center;
        padding: 2rem 1rem;
        border-bottom: 1px solid #333;
      }
      .page-header h1 {
        color: #b88cff;
        font-weight: 600;
        margin-bottom: 0.3rem;
      }
      .content {
        max-width: 1400px;
        margin: 2rem auto;
        padding: 1rem;
      }
      .table-section {
        background-color: #2a2a36;
        border-radius: 10px;
        padding: 1rem;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
        overflow-x: auto;
      }
      .release-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9rem;
      }
      .release-table th,
      .release-table td {
        padding: 0.75rem 0.5rem;
        text-align: left;
        border-bottom: 1px solid #444;
      }
      .release-table thead {
        background-color: #333344;
      }
      .release-table th {
        color: #b88cff;
        font-weight: 500;
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .release-table tbody tr {
        cursor: pointer;
      }
      .release-table tbody tr:nth-child(even) {
        background-color: #242430;
      }
      .release-table tbody tr:hover {
        background-color: #353545;
      }
      .release-table tbody tr.expanded {
        background-color: #3a3a4a;
      }
      .release-table a {
        color: #80aaff;
        text-decoration: none;
      }
      .release-table a:hover {
        text-decoration: underline;
      }
      .expandable-row {
        display: none;
      }
      .expandable-content {
        padding: 0.5rem 0;
        font-size: 0.85rem;
        color: #bbb;
      }
      .expandable-content div {
        margin: 0.25rem 0;
        padding-left: 1rem;
        word-break: break-all;
      }
      .expandable-content strong {
        color: #b88cff;
      }
      .footer {
        text-align: center;
        font-size: 0.9rem;
        color: #777;
        padding: 1.5rem 0;
        border-top: 1px solid #333;
      }
    </style>
  `;

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ArDrive File Index</title>
  ${inlineCSS}
</head>
<body>
  <header class="page-header">
    <h1>ArDrive File Index</h1>
  </header>

  <main class="content">
    <section class="table-section">
      <table class="release-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>LastModified</th>
            <th>DataContentType</th>
            <th>Path</th>
            <th>entityType</th>
            <th>entityId</th>
            <th>parentFolderId</th>
          </tr>
        </thead>
        <tbody>
`;

  data.forEach((item, index) => {
    const relativeLink = createRelativeLink(item.path, ltrim);
    const nameLink = relativeLink ? `<a href="${escapeHtml(relativeLink)}">${escapeHtml(item.name)}</a>` : escapeHtml(item.name);
    const pathLink = relativeLink ? `<a href="${escapeHtml(relativeLink)}">${escapeHtml(item.path)}</a>` : escapeHtml(item.path);
    const size = formatBytes(item.size || 0);
    const lastModified = item.lastModifiedDate ? formatDate(item.lastModifiedDate) : '';
    const dataContentType = escapeHtml(item.dataContentType || '');
    const entityType = escapeHtml(item.entityType || '');
    const entityId = escapeHtml(item.entityId || '');
    const parentFolderId = escapeHtml(item.parentFolderId || '');
    const txIdPath = escapeHtml(item.txIdPath || '');
    const entityIdPath = escapeHtml(item.entityIdPath || '');

    html += `          <tr class="data-row" data-index="${index}">
            <td>${nameLink}</td>
            <td>${size}</td>
            <td>${lastModified}</td>
            <td>${dataContentType}</td>
            <td>${pathLink}</td>
            <td>${entityType}</td>
            <td>${entityId}</td>
            <td>${parentFolderId}</td>
          </tr>
          <tr class="expandable-row" data-parent="${index}">
            <td colspan="8">
              <div class="expandable-content">
                <div><strong>txIdPath:</strong> ${txIdPath}</div>
                <div><strong>entityIdPath:</strong> ${entityIdPath}</div>
              </div>
            </td>
          </tr>
`;
  });

  html += `        </tbody>
      </table>
    </section>
  </main>

  <footer class="footer">
    <p>© 2025 ArDrive File Index</p>
  </footer>

  <script>
    // Handle row expansion
    document.querySelectorAll('.data-row').forEach(row => {
      row.addEventListener('click', function(e) {
        // Prevent link clicks from toggling expansion
        if (e.target.tagName === 'A') {
          return;
        }
        const index = this.getAttribute('data-index');
        const expandableRow = document.querySelector('.expandable-row[data-parent="' + index + '"]');
        if (expandableRow) {
          const isExpanded = this.classList.contains('expanded');
          if (isExpanded) {
            this.classList.remove('expanded');
            expandableRow.style.display = 'none';
          } else {
            this.classList.add('expanded');
            expandableRow.style.display = '';
          }
        }
      });
    });
  </script>
</body>
</html>`;

  return html;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const ltrim = parseInt(args.ltrim || '2', 10);
  if (isNaN(ltrim) || ltrim < 0) {
    console.error('Error: --ltrim must be a non-negative integer');
    process.exit(1);
  }

  let inputData = '';
  let outputStream = process.stdout;

  // Read input
  if (args.input) {
    try {
      inputData = fs.readFileSync(args.input, 'utf8');
    } catch (err) {
      console.error(`Error reading input file: ${err.message}`);
      process.exit(1);
    }
  } else {
    // Read from stdin
    inputData = fs.readFileSync(0, 'utf8');
  }

  // Parse JSON
  let data;
  try {
    data = JSON.parse(inputData);
  } catch (err) {
    console.error(`Error parsing JSON: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(data)) {
    console.error('Error: JSON input must be an array');
    process.exit(1);
  }

  // Generate HTML
  const html = generateHTML(data, ltrim);

  // Write output
  if (args.output) {
    try {
      fs.writeFileSync(args.output, html, 'utf8');
    } catch (err) {
      console.error(`Error writing output file: ${err.message}`);
      process.exit(1);
    }
  } else {
    outputStream.write(html);
  }
}

if (require.main === module) {
  main();
}

module.exports = { generateHTML, formatBytes, formatDate, createRelativeLink };

