/**
 * Machine-readable error codes for API responses.
 * Each code is a kebab-case string constant for programmatic handling.
 */

/* ─── Auth / Session ─────────────────────────────────────────────────────── */
export const API_ERROR_UNAUTHORIZED = "unauthorized";
export const API_ERROR_INVALID_TOKEN = "invalid-token";
export const API_ERROR_INVALID_PREVIEW_TOKEN = "invalid-preview-token";

/* ─── Resource Not Found ─────────────────────────────────────────────────── */
export const API_ERROR_PROJECT_NOT_FOUND = "project-not-found";
export const API_ERROR_ROOM_NOT_FOUND = "room-not-found";
export const API_ERROR_REQUEST_NOT_FOUND = "request-not-found";
export const API_ERROR_USER_NOT_FOUND = "user-not-found";

/* ─── Validation / Input ──────────────────────────────────────────────────── */
export const API_ERROR_MISSING_REQUIRED_FIELDS = "missing-required-fields";
export const API_ERROR_INVALID_REQUEST = "invalid-request";
export const API_ERROR_INVALID_SIGNATURE = "invalid-signature";
export const API_ERROR_INVALID_PROJECT = "invalid-project";
export const API_ERROR_INVALID_CONCEPT = "invalid-concept";

/* ─── Business Logic ──────────────────────────────────────────────────────── */
export const API_ERROR_ALREADY_SIGNED = "already-signed";
export const API_ERROR_SAVE_FAILED = "save-failed";
export const API_ERROR_SETUP_REQUIRED = "setup-required";

/* ─── Quota / Rate Limit ──────────────────────────────────────────────────── */
export const API_ERROR_RATE_LIMIT_EXCEEDED = "rate-limit-exceeded";
export const API_ERROR_TOO_MANY_REQUESTS = "too-many-requests";

/* ─── Third-Party / Integration ───────────────────────────────────────────── */
export const API_ERROR_PDF_GENERATION_FAILED = "pdf-generation-failed";
export const API_ERROR_PDF_AUTHENTICATION_FAILED = "pdf-authentication-failed";
export const API_ERROR_EXPORT_FAILED = "export-failed";
export const API_ERROR_COPY_GENERATION_FAILED = "copy-generation-failed";
export const API_ERROR_INPAINT_SUBMIT_FAILED = "inpaint-submit-failed";
export const API_ERROR_INPAINT_FETCH_FAILED = "inpaint-fetch-failed";
export const API_ERROR_INPAINT_STATUS_FAILED = "inpaint-status-failed";
export const API_ERROR_INPAINT_TERMINAL = "inpaint-terminal-error";
export const API_ERROR_SEGMENTATION_FAILED = "segmentation-failed";
export const API_ERROR_DETECTION_FAILED = "detection-failed";

/* ─── Configuration ────────────────────────────────────────────────────────── */
export const API_ERROR_CONFIGURATION_MISSING = "configuration-missing";

/* ─── External / Service ──────────────────────────────────────────────────── */
export const API_ERROR_EXTERNAL_SERVICE_ERROR = "external-service-error";

/* ─── Server / Unknown ────────────────────────────────────────────────────── */
export const API_ERROR_INTERNAL_SERVER = "internal-server-error";
