const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const readline = require('node:readline');
const version = require('../config/paper-version.json');

class PaperProcess extends EventEmitter {
  constructor(logFile) {
    super();
    this.directory = path.resolve(__dirname, '../.runtime/paper');
    const properties = fs.readFileSync(path.join(this.directory, 'server.properties'), 'utf8');
    const settings = Object.fromEntries(properties.split(/\r?\n/).filter(l => !l.startsWith('#'))
      .map(l => l.split('=').map(s => s.trim())));
    for (const [key, expected] of Object.entries({
      'server-ip': '127.0.0.1',
      'server-port': '25565',
      'online-mode': 'false',
      'enable-rcon': 'false',
      'enable-query': 'false'
    })) {
      if (settings[key] !== expected) throw new Error(`Local test server requires ${key}=${expected}`);
    }
    this.output = fs.createWriteStream(logFile);
    this.counter = 0;
  }

  waitLine(match, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.off('line', onLine); this.off('exit', onExit); };
      const onLine = line => {
        if (match(line)) { cleanup(); resolve(line); }
      };
      const onExit = code => { cleanup(); reject(new Error(`Paper exited (${code})`)); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Paper response deadline exceeded')); }, timeout);
      this.on('line', onLine);
      this.on('exit', onExit);
    });
  }

  async start() {
    const ready = this.waitLine(line => /Done \([\d.]+s\)!/.test(line), 120000);
    this.child = spawn(process.env.JAVA_BIN || 'java', ['-Dterminal.jline=false', '-Dterminal.ansi=false', '-Xms256M', '-Xmx768M', '-XX:+UseSerialGC',
      '-XX:ActiveProcessorCount=2', '-jar', version.file, '--nogui'], {
      cwd: this.directory, stdio: ['pipe', 'pipe', 'pipe']
    });
    for (const stream of [this.child.stdout, this.child.stderr]) {
      readline.createInterface({ input: stream }).on('line', line => {
        this.output.write(line + '\n');
        this.emit('line', line);
      });
    }
    this.child.on('error', error => this.emit('line', error.message));
    this.child.on('exit', code => this.emit('exit', code));
    await ready;
  }

  // Call commands sequentially; a console-generated marker acknowledges that
  // preceding commands were processed on the server thread.
  async command(command) {
    const marker = `MINECORTEX_ACK_${++this.counter}`;
    const lines = [];
    const listener = line => lines.push(line);
    this.on('line', listener);
    const done = this.waitLine(line => line.includes(`Found no elements matching ${marker}`));
    this.child.stdin.write(`${command}\ndata get storage minecortex:barrier ${marker}\n`);
    try { await done; } finally { this.off('line', listener); }
    return lines.filter(line => !line.includes(marker)).join('\n');
  }

  async stop() {
    if (!this.child || this.child.exitCode !== null) { this.output.end(); return; }
    await new Promise(resolve => {
      const timer = setTimeout(() => this.child.kill('SIGKILL'), 20000);
      this.child.once('exit', () => { clearTimeout(timer); resolve(); });
      this.child.stdin.write('stop\n');
    });
    this.output.end();
  }
}
module.exports = { PaperProcess };
