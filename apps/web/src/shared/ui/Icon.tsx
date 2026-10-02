import type { SVGProps } from 'react';

type IconName =
  | 'dashboard'
  | 'questions'
  | 'interview'
  | 'plus'
  | 'arrow'
  | 'search'
  | 'check'
  | 'chevron'
  | 'code';
const paths: Record<IconName, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  questions: 'M5 3h14v18H5zM9 7h6M9 11h6M9 15h4',
  interview: 'M4 4h16v12H9l-5 4zM8 9h8M8 12h5',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  search: 'M21 21l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  check: 'M5 12l4 4L19 6',
  chevron: 'M9 5l7 7-7 7',
  code: 'M8 6l-6 6 6 6M16 6l6 6-6 6M14 3l-4 18',
};
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
