// Re-export shim — re-exports all shared event types so server code can import
// from either '@shared/types/events' or '../types/events' interchangeably.
// The canonical source is shared/types/events.ts.
// See LLD 01 §3 and §9.
export * from '@shared/types/events'
