-- CodeRun's original generic FAILED/ERROR values were never produced by the
-- browser runner. Preserve any legacy unsuccessful rows as runtime errors.
BEGIN;
CREATE TYPE "CodeRunStatus_new" AS ENUM ('SUCCESS', 'RUNTIME_ERROR', 'TIMEOUT');

ALTER TABLE "CodeRun"
    ALTER COLUMN "status" TYPE "CodeRunStatus_new"
    USING (
        CASE "status"::text
            WHEN 'SUCCESS' THEN 'SUCCESS'
            WHEN 'FAILED' THEN 'RUNTIME_ERROR'
            WHEN 'ERROR' THEN 'RUNTIME_ERROR'
        END
    )::"CodeRunStatus_new";

ALTER TYPE "CodeRunStatus" RENAME TO "CodeRunStatus_old";
ALTER TYPE "CodeRunStatus_new" RENAME TO "CodeRunStatus";
DROP TYPE "CodeRunStatus_old";
COMMIT;

CREATE INDEX "CodeRun_interviewId_questionId_createdAt_id_idx"
    ON "CodeRun"("interviewId", "questionId", "createdAt", "id");
