-- Tighten chat message role constraint: only user/assistant are valid client roles
-- Clean up any messages with invalid roles before adding the constraint
DELETE FROM ai_chat_messages WHERE role NOT IN ('user', 'assistant');

ALTER TABLE ai_chat_messages
  DROP CONSTRAINT IF EXISTS ai_chat_messages_role_check;

ALTER TABLE ai_chat_messages
  ADD CONSTRAINT ai_chat_messages_role_check CHECK (role IN ('user', 'assistant'));
