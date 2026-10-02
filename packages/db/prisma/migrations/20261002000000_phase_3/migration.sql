-- Additive only: existing interviews retain null snapshots. Current Question
-- content is not evidence of what an older interview used when it started.
ALTER TABLE "InterviewQuestion"
    ADD COLUMN "snapshotTitle" TEXT,
    ADD COLUMN "snapshotDescription" TEXT,
    ADD COLUMN "snapshotDifficulty" "QuestionDifficulty",
    ADD COLUMN "snapshotLanguage" "ProgrammingLanguage",
    ADD COLUMN "snapshotStarterCode" TEXT,
    ADD COLUMN "snapshotCapturedAt" TIMESTAMP(3);

-- Prisma does not express this CHECK. Preserve it when reviewing migrations.
-- Empty starter code is valid; NULL means no snapshot has been captured.
ALTER TABLE "InterviewQuestion"
    ADD CONSTRAINT "InterviewQuestion_snapshot_complete" CHECK (
        (
            "snapshotTitle" IS NULL AND
            "snapshotDescription" IS NULL AND
            "snapshotDifficulty" IS NULL AND
            "snapshotLanguage" IS NULL AND
            "snapshotStarterCode" IS NULL AND
            "snapshotCapturedAt" IS NULL
        ) OR (
            "snapshotTitle" IS NOT NULL AND
            "snapshotDescription" IS NOT NULL AND
            "snapshotDifficulty" IS NOT NULL AND
            "snapshotLanguage" IS NOT NULL AND
            "snapshotStarterCode" IS NOT NULL AND
            "snapshotCapturedAt" IS NOT NULL
        )
    );
