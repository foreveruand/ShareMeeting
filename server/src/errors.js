class ApiError extends Error {
  constructor(message, code = 1600) {
    super(message);
    this.code = code;
  }
}

module.exports = { ApiError };
