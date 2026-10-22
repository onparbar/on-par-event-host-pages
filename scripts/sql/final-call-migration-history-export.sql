-- OWNER-OPERATED, PRIVATE OUTPUT: recorded SQL may contain secrets or data
-- belonging to other applications. Do not paste results into a public PR.
-- Run the entire file on the separately verified target, using existing access.
-- Save only the history_json cell as a JSON array in a private local file.
begin read only;
select coalesce(jsonb_agg(jsonb_build_object(
  'version', version::text,
  'statements', statements
) order by version), '[]'::jsonb) as history_json
from supabase_migrations.schema_migrations;
rollback;
