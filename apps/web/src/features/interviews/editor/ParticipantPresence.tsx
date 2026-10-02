'use client';

import type { PresenceParticipant } from './presence';

import styles from './editor.module.css';

export function ParticipantPresence({ participants }: { participants: PresenceParticipant[] }) {
  return (
    <div className={styles.presence} aria-label="Participants">
      <span className={styles.presenceHeading}>Participants</span>
      {participants.length === 0 ? (
        <span className={styles.presenceEmpty}>Waiting for authorized participants…</span>
      ) : (
        <ul className={styles.presenceList}>
          {participants.map((participant) => (
            <li className={styles.presenceParticipant} key={participant.participantId}>
              <span
                className={styles.presenceDot}
                style={{ backgroundColor: participant.color }}
                aria-hidden="true"
              />
              <span className={styles.presenceName}>{participant.displayName}</span>
              <span className={styles.presenceRole}>
                {participant.role === 'INTERVIEWER' ? 'Interviewer' : 'Candidate'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
