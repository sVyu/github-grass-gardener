import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContributionCalendar } from './ContributionCalendar';
import type { ContributionCalendarData } from '../../../domain/models';

const data: ContributionCalendarData = {
  year: 2026,
  totalContributions: 2,
  months: [{ name: 'Jan', year: 2026, firstDay: '2026-01-01', totalWeeks: 1 }],
  weeks: [
    {
      firstDay: '2026-01-04',
      contributionDays: [
        { date: '2026-01-04', weekday: 0, contributionCount: 0, level: 'NONE', color: '#252A31' },
        {
          date: '2026-01-05',
          weekday: 1,
          contributionCount: 2,
          level: 'SECOND_QUARTILE',
          color: '#1A7A44',
        },
        { date: '2026-01-06', weekday: 2, contributionCount: 0, level: 'NONE', color: '#252A31' },
      ],
    },
  ],
};

describe('contribution calendar', () => {
  it('supports roving keyboard focus and selection without color dependence', async () => {
    const select = vi.fn();
    render(
      <ContributionCalendar
        data={data}
        selectedDates={[]}
        plannedCounts={{}}
        onSelectDates={select}
        today="2026-01-10"
      />,
    );
    expect(screen.getAllByRole('row')).toHaveLength(7);
    const first = screen.getByRole('gridcell', { name: /2026-01-04/ });
    first.focus();
    await userEvent.keyboard('{ArrowDown} ');
    expect(screen.getByRole('gridcell', { name: /2026-01-05/ })).toHaveFocus();
    expect(select).toHaveBeenCalledWith(['2026-01-05']);
    expect(screen.getByRole('gridcell', { name: /2026-01-05/ })).toHaveAttribute(
      'aria-label',
      expect.stringContaining('2 contributions'),
    );
  });

  it('prevents a future day from being selected', async () => {
    const select = vi.fn();
    render(
      <ContributionCalendar
        data={data}
        selectedDates={[]}
        plannedCounts={{}}
        onSelectDates={select}
        today="2026-01-05"
      />,
    );
    await userEvent.click(screen.getByRole('gridcell', { name: /2026-01-06/ }));
    expect(select).not.toHaveBeenCalled();
  });
});
