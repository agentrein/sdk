const fs = require('fs');
const path = require('path');

const srcDir = 'd:/AgentRein/backend/src/connectors';
const destDir = 'd:/AgentRein/sdk/src/connectors';

if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
}

const files = [
    'stripe', 'slack', 'github', 'hubspot', 'salesforce',
    'notion', 'gmail', 'gdrive', 'gsheets'
];

for (const p of files) {
    const srcPath = path.join(srcDir, `${p}.connector.ts`);
    const destPath = path.join(destDir, `${p}.ts`);
    
    let content = fs.readFileSync(srcPath, 'utf8');
    
    // Replace the types imports
    content = content.replace(/import\s+(?:type\s+)?{([^}]+)}\s+from\s+['"](?:\.\/types|\.\.\/connectors\/types)['"];/g, (match, p1) => {
        return `import type { ConnectorAction } from '../agentreinClient';\n// @ts-ignore\ntype ResourceUrlResolver = any;`;
    });
    
    fs.writeFileSync(destPath, content);
}
console.log('Files copied!');
