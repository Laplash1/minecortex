const path = require('node:path');
const { PaperProcess } = require('./paper-process');
const server = new PaperProcess(path.resolve(__dirname, '../.runtime/paper-console.log'));
server.on('line', line => console.log(line));
server.start().catch(async error => { console.error(error); await server.stop(); process.exitCode = 1; });
process.stdin.on('data', data => server.child?.stdin.write(data));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.stop());
