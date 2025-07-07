class ErrorHandler {
  static handleError(error, context = '', logger = console) {
    const errorMessage = `${context ? `[${context}] ` : ''}${error.message || error}`;
    logger.error(errorMessage);

    if (error.stack && process.env.DEBUG_MODE === 'true') {
      logger.error(error.stack);
    }

    return {
      success: false,
      error: errorMessage
    };
  }

  static wrapAsync(fn, context = '') {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        return this.handleError(error, context);
      }
    };
  }

  static createSafeWrapper(fn, context = '', fallbackValue = null) {
    return (...args) => {
      try {
        return fn(...args);
      } catch (error) {
        this.handleError(error, context);
        return fallbackValue;
      }
    };
  }
}

module.exports = { ErrorHandler };
