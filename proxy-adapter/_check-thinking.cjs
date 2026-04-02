const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./conversations.sqlite');

// Check if thinking events exist for the session
const sessionId = 'a197ac17-9500-4c47-8304-1b3eb5bb5a4e';
const r1 = db.prepare('SELECT COUNT(*) as cnt FROM session_events WHERE session_id = ? AND event_type = ?').get(sessionId, 'assistant.thinking');
console.log('Thinking events for session:', JSON.stringify(r1));

// Check all event types in the DB
const r2 = db.prepare('SELECT event_type, COUNT(*) as cnt FROM session_events GROUP BY event_type ORDER BY cnt DESC').all();
console.log('All event types:', JSON.stringify(r2, null, 2));

// Check if ANY session has thinking events
const r3 = db.prepare('SELECT session_id, COUNT(*) as cnt FROM session_events WHERE event_type = ? GROUP BY session_id').get('assistant.thinking');
console.log('Any session with thinking:', JSON.stringify(r3));

// Check total events for the specific session
const r4 = db.prepare('SELECT event_type, COUNT(*) as cnt FROM session_events WHERE session_id = ? GROUP BY event_type').all(sessionId);
console.log('Events for specific session:', JSON.stringify(r4, null, 2));

// Sample a thinking payload if any exist
const r5 = db.prepare('SELECT seq, payload FROM session_events WHERE event_type = ? LIMIT 2').all('assistant.thinking');
console.log('Sample thinking payloads:', JSON.stringify(r5, null, 2));

db.close();
