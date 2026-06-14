-- Add result_sha256 to patchblobs for catalog lookup and future verification
ALTER TABLE patchblobs ADD COLUMN result_sha256 varchar(255);
