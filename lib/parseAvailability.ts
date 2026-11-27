import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { DAYS_SHORT, MONTH_NAMES } from './scheduler';
import { HOURS, hourRange } from './hours';
import { isoDate } from './workbook';

/**
 * Reads a host's free-text availability message (e.g. pasted from WhatsApp) and turns it into
 * 2-hour slots for one month, using Claude with structured output. The result is only a proposal:
 * the UI shows it in the grid for ops to check and save.
 */

const ResultSchema = z.object({
  mode: z.enum(['replace', 'add', 'remove']).describe(
    'replace = the message describes the host’s full availability for the month (or the dates it covers); ' +
    'add = extra times on top of what is already saved; remove = times the host can no longer do.'),
  replace_dates: z.array(z.string()).describe(
    'Only for mode "replace" when the message covers part of the month: the YYYY-MM-DD dates whose availability should be cleared and replaced. ' +
    'Leave empty to replace the whole month.'),
  hours: z.array(z.object({
    date: z.string().describe('YYYY-MM-DD, inside the month'),
    hours: z.array(z.number().int()).describe('Start hours 10-23 that this date gains (or loses, for mode "remove"); 14 means 2PM-3PM'),
  })),
  summary: z.string().describe('One or two plain sentences describing what was understood, for the ops team to check.'),
  unclear: z.array(z.string()).describe('Anything ambiguous or that could not be placed, each as a short sentence. Empty if none.'),
});

export type ParsedAvailability = z.infer<typeof ResultSchema>;

export class MissingApiKeyError extends Error {}

export async function parseAvailabilityMessage(args: {
  hostName: string;
  year: number;
  month: number; // 0-based
  text: string;
  saleDays: { name: string; day: number }[];
  current: { date: string; hour: number }[];
}): Promise<ParsedAvailability> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new MissingApiKeyError('ANTHROPIC_API_KEY is not set');
  }
  const { hostName, year, month, text, saleDays, current } = args;
  const days = new Date(year, month + 1, 0).getDate();
  const sale = new Map(saleDays.map(s => [s.day, s.name]));
  const calendar = Array.from({ length: days }, (_, i) => {
    const d = i + 1;
    const dow = DAYS_SHORT[new Date(Date.UTC(year, month, d)).getUTCDay()];
    return `${isoDate(year, month, d)} ${dow}${sale.has(d) ? ' (' + sale.get(d) + ')' : ''}`;
  }).join('\n');
  const currentByDate = new Map<string, number[]>();
  current.forEach(c => currentByDate.set(c.date, [...(currentByDate.get(c.date) || []), c.hour].sort((a, b) => a - b)));
  const currentText = currentByDate.size
    ? [...currentByDate.entries()].sort().map(([d, s]) => `${d}: ${s.join(',')}`).join('\n')
    : '(nothing saved yet)';

  const system = `You turn a livestream host's availability message into one-hour time slots for a scheduling app.

The bookable day runs 10AM to midnight, as 14 one-hour slots numbered by their start hour (24-hour clock):
${HOURS.map(h => `${h} = ${hourRange(h)}`).join('\n')}

Rules:
- An hour counts only if the host can do the whole hour. "Free from 3pm" = hours 15-23. "Until 9pm" = hours up to 20 (8PM-9PM). "After 6:30pm" = from 19. "Evenings"/"nights" = 18-23. "Afternoon" = 12-17. "Morning" = 10-11. "Whole day"/"free"/"anytime" = all 14 (10-23).
- Expand recurring phrases ("every Tuesday", "weekdays", "weekends", "all of week 2") into concrete dates using the calendar below. Weeks start on Monday.
- Exceptions win: "free every evening except the 12th" means no slots on the 12th.
- Dates outside the month are ignored; mention them under unclear.
- Messages are often informal, mixed English/Singlish/Malay/Chinese, with typos and emoji. Interpret generously, but put anything you had to guess under unclear rather than silently guessing.
- Choose mode: "replace" when the message lays out their availability (most messages); "add" when they say they can also do something extra; "remove" when they cancel or say they can no longer do something. For a partial replace (e.g. "update for next week: ..."), list the covered dates in replace_dates.`;

  const user = `Host: ${hostName}
Month: ${MONTH_NAMES[month]} ${year}

Calendar:
${calendar}

Currently saved availability (date: start hours):
${currentText}

Message from the host:
<message>
${text}
</message>`;

  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(ResultSchema) },
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The message could not be processed. Please enter the availability by hand.');
  if (!response.parsed_output) throw new Error('Could not read that message. Try rephrasing it or enter it by hand.');

  // Keep only valid dates/slots inside this month.
  const prefix = isoDate(year, month, 1).slice(0, 8);
  const ok = (d: string) => d.startsWith(prefix) && Number(d.slice(8)) >= 1 && Number(d.slice(8)) <= days;
  const out = response.parsed_output;
  return {
    ...out,
    replace_dates: out.replace_dates.filter(ok),
    hours: out.hours.filter(s => ok(s.date)).map(s => ({ date: s.date, hours: [...new Set(s.hours.filter(n => n >= 10 && n <= 23))].sort((a, b) => a - b) })),
  };
}
