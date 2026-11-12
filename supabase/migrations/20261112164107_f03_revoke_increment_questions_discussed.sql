-- F-03: Revoke execution of the unsafe question-progress RPC.
-- The function remains in the database but is no longer executable
-- by application roles.

REVOKE EXECUTE
ON FUNCTION public.increment_questions_discussed(uuid, uuid)
FROM PUBLIC, anon, authenticated, service_role;
