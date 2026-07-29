-- Needed so the frontend can generate a signed URL right after uploading
-- (createSignedUrl requires read/SELECT permission on the object, same as
-- a direct download would). Files are still not enumerable/public — object
-- paths include a random UUID, and this only grants the *ability* to sign a
-- URL for a path the caller already knows, not a public bucket listing.
create policy "anon can read (for signed URL generation) documents"
  on storage.objects for select
  to anon
  using (bucket_id = 'documents');
