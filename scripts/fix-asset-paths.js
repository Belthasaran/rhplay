#!/usr/bin/env node

/**
 * Cross-platform asset path fixing script
 * Converts absolute paths to relative paths in HTML files
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Fixing asset paths in HTML files...');

// Find all index.html files in the renderer dist directory
const distDir = path.join('electron', 'renderer', 'dist');

if (!fs.existsSync(distDir)) {
    console.error('❌ Renderer dist directory not found:', distDir);
    process.exit(1);
}

// Find index.html files
const findHtmlFiles = (dir) => {
    const files = [];
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
            files.push(...findHtmlFiles(fullPath));
        } else if (item === 'index.html') {
            files.push(fullPath);
        }
    }
    
    return files;
};

const htmlFiles = findHtmlFiles(distDir);

if (htmlFiles.length === 0) {
    console.error('❌ No index.html files found in:', distDir);
    process.exit(1);
}

// Process each HTML file
for (const htmlFile of htmlFiles) {
    console.log('Processing:', htmlFile);
    
    try {
        let content = fs.readFileSync(htmlFile, 'utf8');
        
        // Replace absolute paths with relative paths
        content = content.replace(/src="\/assets\//g, 'src="./assets/');
        content = content.replace(/href="\/assets\//g, 'href="./assets/');
        
        fs.writeFileSync(htmlFile, content);
        console.log('Fixed asset paths in', htmlFile);
        
    } catch (error) {
        console.error('❌ Error processing', htmlFile, ':', error.message);
        process.exit(1);
    }
}

console.log('✅ Asset path fixing completed!');
