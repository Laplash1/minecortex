class Logger {
  constructor(prefix = '') {
    this.prefix = prefix;
  }

  log(message, ...args) {
    const prefixedMessage = this.prefix ? `[${this.prefix}] ${message}` : message;
    console.log(prefixedMessage, ...args);
  }

  warn(message, ...args) {
    const prefixedMessage = this.prefix ? `[${this.prefix}] ${message}` : message;
    console.warn(prefixedMessage, ...args);
  }

  error(message, ...args) {
    const prefixedMessage = this.prefix ? `[${this.prefix}] ${message}` : message;
    console.error(prefixedMessage, ...args);
  }

  debug(message, ...args) {
    if (process.env.DEBUG_MODE === 'true') {
      const prefixedMessage = this.prefix ? `[${this.prefix}] ${message}` : message;
      console.log(`DEBUG: ${prefixedMessage}`, ...args);
    }
  }

  static createLogger(prefix) {
    return new Logger(prefix);
  }
}

module.exports = { Logger };
