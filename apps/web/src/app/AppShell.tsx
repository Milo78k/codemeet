'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from '../shared/ui/Icon';
import {
  hasCandidateSession,
  subscribeToParticipantSession,
} from '../shared/api/participant-session';
import styles from '../shared/ui/workspace.module.css';
const navigation = [
  { href: '/dashboard', label: 'Overview', icon: 'dashboard' },
  { href: '/questions', label: 'Question library', icon: 'questions' },
  { href: '/interviews/new', label: 'Create interview', icon: 'interview' },
] as const;
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const candidateSession = useSyncExternalStore(
    subscribeToParticipantSession,
    hasCandidateSession,
    () => false,
  );
  const invitePage = pathname.startsWith('/join/');
  const showWorkspaceNavigation = !invitePage && !candidateSession;
  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to content
      </a>
      <aside className={styles.sidebar}>
        <Link href="/dashboard" className={styles.brand}>
          <span className={styles.brandMark}>
            <Icon name="code" />
          </span>
          CodeMeet<span className={styles.brandDot}>.</span>
        </Link>
        {showWorkspaceNavigation ? (
          <>
            <div className={styles.workspaceLabel}>YOUR WORKSPACE</div>
            <nav aria-label="Main navigation" className={styles.navigation}>
              {navigation.map(({ href, label, icon }) => {
                const active =
                  href === '/questions' ? pathname.startsWith('/questions') : pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`${styles.navLink} ${active ? styles.navActive : ''}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon name={icon} />
                    {label}
                  </Link>
                );
              })}
            </nav>
            <div className={styles.sidebarBottom}>
              <span className={styles.avatar}>DI</span>
              <div>
                <strong>Demo Interviewer</strong>
                <span>Demo workspace</span>
              </div>
            </div>
          </>
        ) : (
          <div className={styles.workspaceLabel}>
            {candidateSession ? 'CANDIDATE SESSION' : 'INTERVIEW INVITE'}
          </div>
        )}
      </aside>
      <div className={styles.contentArea}>
        <header className={styles.topbar}>
          <span>
            {candidateSession
              ? 'Candidate session'
              : invitePage
                ? 'Interview invite'
                : 'Workspace / Interviews & questions'}
          </span>
          <span className={styles.workspacePill}>
            <span />
            Personal workspace
          </span>
        </header>
        <main id="main-content" className={styles.main}>
          {children}
        </main>
        <footer className={styles.footer}>
          <span>CodeMeet</span>
          <span>A little structure. A better conversation.</span>
        </footer>
      </div>
    </div>
  );
}
