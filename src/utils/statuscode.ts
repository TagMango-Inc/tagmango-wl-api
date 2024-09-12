export const StatusCode = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
};

export const StatusText = {
  OK: "OK",
  CREATED: "Created",
  NO_CONTENT: "No Content",
  BAD_REQUEST: "Bad Request",
  UNAUTHORIZED: "Unauthorized",
  FORBIDDEN: "Forbidden",
  NOT_FOUND: "Not Found",
  METHOD_NOT_ALLOWED: "Method Not Allowed",
  CONFLICT: "Conflict",
  INTERNAL_SERVER_ERROR: "Internal Server Error",
  SERVICE_UNAVAILABLE: "Service Unavailable",
  GATEWAY_TIMEOUT: "Gateway Timeout",
};

export const Response = {
  OK: {
    status: StatusCode.OK,
    statusText: StatusText.OK,
  },
  CREATED: {
    status: StatusCode.CREATED,
    statusText: StatusText.CREATED,
  },
  NO_CONTENT: {
    status: StatusCode.NO_CONTENT,
    statusText: StatusText.NO_CONTENT,
  },
  BAD_REQUEST: {
    status: StatusCode.BAD_REQUEST,
    statusText: StatusText.BAD_REQUEST,
  },
  UNAUTHORIZED: {
    status: StatusCode.UNAUTHORIZED,
    statusText: StatusText.UNAUTHORIZED,
  },
  FORBIDDEN: {
    status: StatusCode.FORBIDDEN,
    statusText: StatusText.FORBIDDEN,
  },
  NOT_FOUND: {
    status: StatusCode.NOT_FOUND,
    statusText: StatusText.NOT_FOUND,
  },
  METHOD_NOT_ALLOWED: {
    status: StatusCode.METHOD_NOT_ALLOWED,
    statusText: StatusText.METHOD_NOT_ALLOWED,
  },
  CONFLICT: {
    status: StatusCode.CONFLICT,
    statusText: StatusText.CONFLICT,
  },
  INTERNAL_SERVER_ERROR: {
    status: StatusCode.INTERNAL_SERVER_ERROR,
    statusText: StatusText.INTERNAL_SERVER_ERROR,
  },
  SERVICE_UNAVAILABLE: {
    status: StatusCode.SERVICE_UNAVAILABLE,
    statusText: StatusText.SERVICE_UNAVAILABLE,
  },
  GATEWAY_TIMEOUT: {
    status: StatusCode.GATEWAY_TIMEOUT,
    statusText: StatusText.GATEWAY_TIMEOUT,
  },
};
