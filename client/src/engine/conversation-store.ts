// conversation-store.ts — compatibility shim.
// Renamed to sim-state-store.ts. Import from there directly.
export {
  createSimStateStore as createConversationStore,
  type SimStateStore as ConversationStore,
  type SimStateStoreSnapshot as ConversationStoreSnapshot,
} from './sim-state-store'
