-- Rate limiting that survives more than one instance.
--
-- The in-memory limiter counts per process, which on Vercel means the cap is
-- really the cap times however many instances happen to be warm. What it is
-- protecting is the model provider's bill, so "roughly" is not good enough.
--
-- A table rather than Redis: the database is already there, the write is tiny,
-- and a turn does several queries anyway. One more is not what makes it slow.

CREATE TABLE IF NOT EXISTS rate_limits (
  -- Scope plus subject, e.g. 'turn:<auth-user-id>'.
  key text PRIMARY KEY,
  -- Fixed window: everything in the current window counts toward `count`.
  window_started_at timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0
);

-- Old windows are dead weight; this makes cleaning them cheap.
CREATE INDEX IF NOT EXISTS ix_rate_limits_window ON rate_limits (window_started_at);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- No client policy at all: counters are written by trusted server code only.
-- With RLS on and no policy the default is deny, which is the intent here
-- rather than an oversight.

-- Count one hit and report whether it is allowed, in a single statement.
--
-- The upsert is what makes it correct under concurrency: two instances racing
-- on the same key serialise on the primary key, so the counter cannot be lost
-- the way a read-then-write would lose it.
CREATE OR REPLACE FUNCTION app.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) RETURNS TABLE (allowed boolean, remaining integer, reset_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  row_out rate_limits%ROWTYPE;
BEGIN
  INSERT INTO rate_limits (key, window_started_at, count)
  VALUES (p_key, now(), 1)
  ON CONFLICT (key) DO UPDATE
    SET
      -- A window that has expired restarts rather than accumulating.
      window_started_at = CASE
        WHEN rate_limits.window_started_at < now() - make_interval(secs => p_window_seconds)
        THEN now() ELSE rate_limits.window_started_at END,
      count = CASE
        WHEN rate_limits.window_started_at < now() - make_interval(secs => p_window_seconds)
        THEN 1 ELSE rate_limits.count + 1 END
  RETURNING * INTO row_out;

  allowed := row_out.count <= p_limit;
  remaining := GREATEST(0, p_limit - row_out.count);
  reset_at := row_out.window_started_at + make_interval(secs => p_window_seconds);
  RETURN NEXT;
END;
$$;

-- Housekeeping, safe to call from anywhere: drops windows nothing can consult.
CREATE OR REPLACE FUNCTION app.prune_rate_limits(p_older_than_hours integer DEFAULT 24)
RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM rate_limits
  WHERE window_started_at < now() - make_interval(hours => p_older_than_hours);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
