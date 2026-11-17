import './globals.css';
import type { Metadata } from 'next';
import TooltipLayer from '@/components/TooltipLayer';

export const metadata: Metadata = {
  title: 'Livestream Scheduler',
  description: 'MajorForm livestream capacity and scheduling',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <TooltipLayer />
      </body>
    </html>
  );
}
