import {
  DEMO_USER_EMAIL,
  type InterviewParticipant,
  type PrismaClient,
  type User,
} from '@codemeet/db';

import { findValidParticipantSession } from '../auth/participant-session.js';
import { ApiError } from './errors.js';

export type ApiIdentity =
  { kind: 'interviewer'; user: User } | { kind: 'candidate'; participant: InterviewParticipant };

export interface ApiContext {
  prisma: PrismaClient;
  currentUser: User | null;
  getIdentity(): Promise<ApiIdentity>;
  getCurrentParticipant(): Promise<InterviewParticipant | null>;
  getCurrentUser(): Promise<User>;
}

export function createApiContext(
  prisma: PrismaClient,
  demoAuthEnabled: boolean,
  authorizationHeader?: string | null,
): ApiContext {
  let identity: Promise<ApiIdentity> | undefined;

  const context: ApiContext = {
    prisma,
    currentUser: null,
    getIdentity() {
      identity ??= resolveIdentity();
      return identity;
    },
    async getCurrentParticipant() {
      const resolved = await context.getIdentity();
      return resolved.kind === 'candidate' ? resolved.participant : null;
    },
    getCurrentUser() {
      // TEMP DEMO AUTH: identity is server configured, never read from headers
      // or GraphQL input. Candidate sessions are separately verified bearers.
      return context.getIdentity().then((resolved) => {
        if (resolved.kind !== 'interviewer') {
          throw new ApiError('This operation is not available to candidates.', 'FORBIDDEN');
        }
        return resolved.user;
      });
    },
  };

  async function resolveIdentity(): Promise<ApiIdentity> {
    if (authorizationHeader !== undefined && authorizationHeader !== null) {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorizationHeader);
      if (!match) throw new ApiError('A valid participant session is required.', 'UNAUTHENTICATED');
      const session = await findValidParticipantSession(prisma, match[1]!);
      if (!session) {
        throw new ApiError('This participant session is invalid or expired.', 'UNAUTHENTICATED');
      }
      return { kind: 'candidate', participant: session.participant };
    }

    if (!demoAuthEnabled) {
      throw new ApiError('Authentication is required.', 'UNAUTHENTICATED');
    }

    const user = await prisma.user.findUnique({
      where: { email: DEMO_USER_EMAIL },
    });
    if (!user) {
      throw new ApiError('The demo user is unavailable. Run the database seed.', 'UNAUTHENTICATED');
    }

    context.currentUser = user;
    return { kind: 'interviewer', user };
  }

  return context;
}
