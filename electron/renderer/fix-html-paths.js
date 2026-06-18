import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const assetsDir = path.join(__dirname, 'dist', 'assets');
const assetsGitignorePath = path.join(assetsDir, '.gitignore');
const assetsGitignoreContent = 'index.html\nindex-*.css\nindex-*.js\n';

// Vite emptyOutDir wipes dist/ each build; restore tracked ignore rules for hashed assets.
fs.mkdirSync(assetsDir, { recursive: true });
fs.writeFileSync(assetsGitignorePath, assetsGitignoreContent, 'utf8');
console.log('Restored dist/assets/.gitignore');

const htmlPath = path.join(__dirname, 'dist', 'index.html');
if (fs.existsSync(htmlPath)) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  console.log('Before fix:', html.match(/src="[^"]+"/));
  // Replace absolute paths with relative paths (handle both " and ' quotes)
  html = html.replace(/src="\/assets\//g, 'src="./assets/');
  html = html.replace(/src='\/assets\//g, "src='./assets/");
  html = html.replace(/href="\/assets\//g, 'href="./assets/');
  html = html.replace(/href='\/assets\//g, "href='./assets/");
  console.log('After fix:', html.match(/src="[^"]+"/));
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('Fixed HTML paths in dist/index.html');
} else {
  console.error('HTML file not found:', htmlPath);
}
