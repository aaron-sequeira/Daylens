// Node 20 does not include a native WebSocket implementation.
// @supabase/realtime-js checks for WebSocket at createClient() time and throws
// if it is absent. Polyfill it with the "ws" package (already in node_modules).
import ws from 'ws';
// @ts-expect-error – ws satisfies the WebSocket interface well enough for Supabase
globalThis.WebSocket = ws;
