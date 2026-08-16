/**
 * Shared JSON types for the HermesCN HTTP API.
 * Domain types (Session, ApprovalPayload, ...) land with their surfaces;
 * only types the client itself needs live here.
 */

/** Any JSON-serializable object (API request/response payloads). */
export type JsonObject = Record<string, unknown>

/** A JSON value: object, array, primitive, or null. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonValue[]
