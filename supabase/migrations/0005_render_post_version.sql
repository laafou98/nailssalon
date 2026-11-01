-- Which version of our post-passes (true-colour composite, realism) produced a render's stored result.
-- A finished Nail VTO render with an older version is re-processed from YouCam's stored original the next time
-- it is shown, so improving the passes reaches renders made before (no unit spent). 0 = before versioning.
alter table public.renders add column post_version integer not null default 0;
