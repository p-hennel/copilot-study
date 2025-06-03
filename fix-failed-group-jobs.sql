-- Check for failed jobs with 'group' DataType that can be retried
SELECT 
    id,
    command,
    status,
    created_at,
    finished_at,
    progress
FROM job 
WHERE status = 'failed' 
  AND command = 'group' 
  AND progress LIKE '%Unknown DataType mapping%'
ORDER BY created_at DESC
LIMIT 10;

-- Reset failed jobs with 'group' DataType mapping errors to queued status
-- (uncomment the following lines to execute the fix)
/*
UPDATE job 
SET 
    status = 'queued',
    finished_at = NULL,
    progress = NULL,
    updated_at = unixepoch()
WHERE status = 'failed' 
  AND command = 'group' 
  AND progress LIKE '%Unknown DataType mapping%';
*/