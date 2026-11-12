-- F-04: Restrict authenticated access to private user metadata.
-- Preserve public active-profile reads and legitimate matched-user access.

BEGIN;

DROP POLICY IF EXISTS "Users can read matched users profiles"
ON public.users;

CREATE POLICY "Users can read paired users profiles"
ON public.users
FOR SELECT
TO authenticated
USING (
    auth.uid() IS NOT NULL
    AND id <> auth.uid()
    AND public.users_are_paired(auth.uid(), id)
    AND NOT EXISTS (
        SELECT 1
        FROM public.user_blocks b
        WHERE (b.blocker_id = auth.uid() AND b.blocked_id = id)
           OR (b.blocker_id = id AND b.blocked_id = auth.uid())
    )
    AND NOT EXISTS (
        SELECT 1
        FROM public.conversations c
        WHERE c.user_a_id = LEAST(auth.uid(), id)
          AND c.user_b_id = GREATEST(auth.uid(), id)
          AND c.status = 'unmatched'
    )
);

REVOKE SELECT (
    onesignal_player_id,
    reg_number,
    reputation_score,
    section1_last_edited,
    section1_progress,
    section2_free_expires_at,
    section2_unlocked,
    share_email,
    share_phone,
    share_social_instagram,
    share_social_tiktok,
    share_social_x,
    share_whatsapp,
    status
)
ON public.users FROM authenticated;

-- Regression assertions: fail the migration if the intended
-- access-control changes are not present.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'users'
          AND policyname = 'Users can read matched users profiles'
    ) THEN
        RAISE EXCEPTION 'F-04 regression: unrestricted policy still exists';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'users'
          AND policyname = 'Users can read paired users profiles'
    ) THEN
        RAISE EXCEPTION 'F-04 regression: paired-user policy missing';
    END IF;

    IF has_column_privilege(
        'authenticated', 'public.users', 'reg_number', 'SELECT'
    ) THEN
        RAISE EXCEPTION 'F-04 regression: reg_number remains readable';
    END IF;

    IF has_column_privilege(
        'authenticated', 'public.users', 'onesignal_player_id', 'SELECT'
    ) THEN
        RAISE EXCEPTION 'F-04 regression: OneSignal ID remains readable';
    END IF;
END;
$$;

COMMIT;
