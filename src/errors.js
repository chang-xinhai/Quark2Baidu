export class Q2BError extends Error {
  constructor(message, { code = "Q2B_ERROR", cause } = {}) {
    super(message, { cause });
    this.name = "Q2BError";
    this.code = code;
  }
}

export class AuthError extends Q2BError {
  constructor(message, options = {}) {
    super(message, { code: "AUTH_ERROR", ...options });
    this.name = "AuthError";
  }
}

export class HttpError extends Q2BError {
  constructor(message, { status, bodyPreview, cause } = {}) {
    super(message, { code: "HTTP_ERROR", cause });
    this.name = "HttpError";
    this.status = status;
    this.bodyPreview = bodyPreview;
  }
}

export class ValidationError extends Q2BError {
  constructor(message, options = {}) {
    super(message, { code: "VALIDATION_ERROR", ...options });
    this.name = "ValidationError";
  }
}
