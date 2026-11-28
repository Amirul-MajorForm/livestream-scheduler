import type { HostStream } from './hostEarnings';

/** How a stream's earnings stand, as hosts see it. */
export const HOST_STATE: Record<HostStream['state'], { label: string; cls: string; tip: string }> = {
  paid: { label: 'Paid', cls: 'ok', tip: 'Paid to you.' },
  due: { label: 'To be paid', cls: 'accent', tip: 'Worked out, not paid yet.' },
  pending: { label: 'Sales not in yet', cls: '', tip: 'The ops team hasn\u2019t entered this stream\u2019s sales yet, so the fee isn\u2019t worked out.' },
  none: { label: 'No fee', cls: '', tip: 'There\u2019s no talent fee for this stream (for example a creator-account deal).' },
  upcoming: { label: 'Upcoming', cls: '', tip: 'This stream hasn\u2019t happened yet.' },
};
