CREATE TABLE "ParticipantSession" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ParticipantSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ParticipantSession_tokenHash_key"
    ON "ParticipantSession"("tokenHash");

CREATE INDEX "ParticipantSession_participantId_expiresAt_idx"
    ON "ParticipantSession"("participantId", "expiresAt");

ALTER TABLE "ParticipantSession"
    ADD CONSTRAINT "ParticipantSession_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "InterviewParticipant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
