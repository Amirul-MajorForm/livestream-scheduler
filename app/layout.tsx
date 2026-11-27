import './globals.css';
import type { Metadata } from 'next';
import TooltipLayer from '@/components/TooltipLayer';
import { THEME_SCRIPT } from '@/components/ThemeToggle';

export const metadata: Metadata = {
  title: 'Livestream Scheduler',
  description: 'MajorForm livestream capacity and scheduling',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Space+Grotesk:wght@500;600;700&display=swap" />
      </head>
      <body>
        {children}
        <TooltipLayer />
      </body>
    </html>
  );
}
