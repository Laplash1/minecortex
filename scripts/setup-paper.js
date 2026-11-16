const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const version = require('../config/paper-version.json');
const directory = path.resolve(__dirname, '../.runtime/paper');
fs.mkdirSync(directory, { recursive: true });

function download(url, destination, sha256) {
  if (!fs.existsSync(destination) || digest(destination) !== sha256) {
    execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2',
      '--user-agent', 'MineCortex-local-validation/1.5 (https://github.com/Laplash1/minecortex)',
      url, '--output', destination], { stdio: 'inherit' });
  }
  if (digest(destination) !== sha256) throw new Error(`Checksum mismatch: ${destination}`);
  console.log(`Verified ${path.basename(destination)} SHA-256 ${sha256}`);
}
function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
const jar = path.join(directory, version.file);
download(version.url, jar, version.sha256);
// Prefetch Paperclip's original Mojang jar through curl, which supports this
// VM's HTTPS proxy. Read its URL and checksum from the verified Paper jar.
const metadata = execFileSync('python3', ['-c',
  'import zipfile,sys; print(zipfile.ZipFile(sys.argv[1]).read("META-INF/download-context").decode())', jar],
{ encoding: 'utf8' }).trim().split('\t');
const [sha256, url, name] = metadata;
fs.mkdirSync(path.join(directory, 'cache'), { recursive: true });
download(url, path.join(directory, 'cache', path.basename(name)), sha256);
const properties = path.join(directory, 'server.properties');
if (!fs.existsSync(properties)) fs.copyFileSync(path.resolve(__dirname, '../config/paper-server.properties'), properties);
fs.writeFileSync(path.join(directory, 'eula.txt'), 'eula=true\n');
console.log(`Paper ${version.minecraft} build ${version.build} prepared in ${directory}`);
