-- Allow the frontend (anon/publishable key) to upload directly into the
-- private 'documents' bucket, matching the app's existing security model:
-- anyone can upload (it's a public quick-check form), but nothing is
-- directly readable back without a signed URL — reads only happen via the
-- backend (service-role, bypasses RLS) generating short-lived signed URLs.
-- No anon SELECT/UPDATE/DELETE policy is added on purpose.
create policy "anon can upload documents"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'documents');
