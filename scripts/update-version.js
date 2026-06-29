const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  const commitHash = execSync('git rev-parse --short HEAD').toString().trim();
  const commitMessage = execSync('git log -1 --pretty=%B').toString().trim().split('\n')[0];

  const versionData = {
    hash: commitHash,
    message: commitMessage
  };

  const outputPath = path.join(__dirname, '..', 'src', 'version.json');
  fs.writeFileSync(outputPath, JSON.stringify(versionData, null, 2));

  console.log('Updated src/version.json with commit:', commitHash);
} catch (error) {
  console.error('Failed to update version info from git:', error.message);
  // If git fails (e.g., no commits yet, or not a git repo), provide a fallback
  const fallbackPath = path.join(__dirname, '..', 'src', 'version.json');
  if (!fs.existsSync(fallbackPath)) {
    fs.writeFileSync(fallbackPath, JSON.stringify({ hash: 'unknown', message: 'No commit info' }, null, 2));
  }
}
