# Conversation Storage Guidelines

## 1. Where to Look
| Domain | Path |
| :--- | :--- |
| Database Layer | `db.ts` |
| Session Manager | `manager.ts` |
| Compressor | `compressor.ts` |
| Types | `types.ts` |

## 2. Database
- **SQLite**: Local storage using `node:sqlite`
- **Schema**: `sessions` (metadata) + `messages` (role-based content)
- **Indexing**: Optimized for `updated_at` and `session_id`

## 3. Key Operations
- Session lifecycle, message addition, context windowing
- Session compression and summary generation
- Message metadata support (tool calls, extra context)

## 4. Anti-Patterns
- No SQL injection; use parameterized queries
- No direct DB access in business logic; use `ConversationManager`
- Never use string interpolation for queries

See parent AGENTS.md for conventions and patterns.
