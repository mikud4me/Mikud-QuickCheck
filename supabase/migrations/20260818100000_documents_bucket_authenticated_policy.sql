-- Authenticated-role counterparts of the anon policies in
-- 20260729110945 / 20260729111153. The app is fully anonymous today, so this
-- grants nothing extra in practice — it just keeps the 'documents' bucket
-- policies symmetric for signed-in users (and matches the state already
-- applied on the live project under this same migration version).
create policy "authenticated can upload documents"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'documents');

create policy "authenticated can read (for signed URL generation) documents"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'documents');
