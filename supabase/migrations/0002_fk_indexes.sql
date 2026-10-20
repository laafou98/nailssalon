-- Covering indexes for foreign keys (Supabase performance advisor).
create index salons_owner_idx            on public.salons (owner_id);
create index sessions_salon_idx          on public.sessions (salon_id);
create index images_session_idx          on public.images (session_id);
create index designs_session_idx         on public.designs (session_id);
create index designs_source_image_idx    on public.designs (source_image_id);
create index renders_design_idx          on public.renders (design_id);
create index renders_hand_image_idx      on public.renders (hand_image_id);
create index renders_result_image_idx    on public.renders (result_image_id);
create index recipes_design_idx          on public.recipes (design_id);
create index recipes_render_idx          on public.recipes (render_id);
create index recipes_salon_idx           on public.recipes (salon_id);
create index fidelity_recipe_idx         on public.fidelity_checks (recipe_id);
create index fidelity_after_image_idx    on public.fidelity_checks (after_image_id);
create index unit_ledger_session_idx     on public.unit_ledger (session_id);
create index unit_ledger_render_idx      on public.unit_ledger (render_id);
