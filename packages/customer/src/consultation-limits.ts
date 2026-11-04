// Frontvia public consultation contract; lengths match the Support JS owner.
export const HELP_REASON_LIMIT = 300;
export const ORIGINAL_BYTES_LIMIT = 1024 * 1024;
export const ORIGINAL_BASE64_LIMIT = 4 * Math.ceil(ORIGINAL_BYTES_LIMIT / 3);
// Filename, digest, content type and JSON-RPC envelope remain bounded separately.
export const ORIGINAL_RESPONSE_LIMIT = ORIGINAL_BASE64_LIMIT + 16 * 1024;
