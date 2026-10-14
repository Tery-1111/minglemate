-- fix_bot_question_trigger.sql
--
-- CONFIRMED DEFECT: trg_auto_bot_question (AFTER INSERT on messages) runs
-- handle_bot_question_trigger(), which queries section2_chat_progress by
-- match_week_id — a column that table does not have — so EVERY message
-- insert fails with 42703 (column "match_week_id" does not exist) once this
-- trigger exists. Its body is also an early prototype: it inserts literal
-- 'Question N of 20: [Insert Question Text]' placeholder rows.
--
-- The shipping bot-question flow is client-side (Chat.jsx sendBotQuestion,
-- driven by section2_chat_progress keyed on user_id_a/user_id_b), so this
-- DB trigger is dead legacy code whose only possible effect was to break
-- every message insert. Fix = drop the trigger. The function definition is
-- left in place (harmless without its trigger).

drop trigger if exists trg_auto_bot_question on public.messages;
