import { useEffect, useMemo, useRef, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { ContributionCalendarData, ContributionDay } from '../../../domain/models';

interface Props {
  data: ContributionCalendarData;
  selectedDates: string[];
  plannedCounts: Record<string, number>;
  publishedDates?: string[];
  failedDates?: string[];
  today: string;
  onSelectDates: (dates: string[]) => void;
}

const levels: Record<ContributionDay['level'], number> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

export function ContributionCalendar({
  data,
  selectedDates,
  plannedCounts,
  publishedDates = [],
  failedDates = [],
  today,
  onSelectDates,
}: Props) {
  const days = useMemo(() => data.weeks.flatMap((week) => week.contributionDays), [data]);
  const dayIndexes = useMemo(() => new Map(days.map((day, index) => [day.date, index])), [days]);
  const [focusIndex, setFocusIndex] = useState(0);
  const cells = useRef<Array<HTMLButtonElement | null>>([]);
  const anchor = useRef<number | null>(null);
  const dragging = useRef(false);
  const selected = new Set(selectedDates);
  const published = new Set(publishedDates);
  const failed = new Set(failedDates);

  useEffect(() => {
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  function selectRange(start: number, end: number): void {
    const dates = days
      .slice(Math.min(start, end), Math.max(start, end) + 1)
      .filter((day) => day.date <= today)
      .map((day) => day.date);
    if (dates.length > 0) onSelectDates(dates);
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const delta =
      event.key === 'ArrowRight'
        ? 7
        : event.key === 'ArrowLeft'
          ? -7
          : event.key === 'ArrowDown'
            ? 1
            : event.key === 'ArrowUp'
              ? -1
              : 0;
    if (delta !== 0) {
      event.preventDefault();
      const next = Math.max(0, Math.min(days.length - 1, index + delta));
      setFocusIndex(next);
      cells.current[next]?.focus();
      if (event.shiftKey) selectRange(anchor.current ?? index, next);
      else anchor.current = next;
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      anchor.current = index;
      selectRange(index, index);
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>, index: number): void {
    if (event.button !== 0 || days[index]!.date > today) return;
    dragging.current = true;
    anchor.current = event.shiftKey ? (anchor.current ?? index) : index;
    setFocusIndex(index);
    selectRange(anchor.current, index);
  }

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="calendar-scroll" aria-label={`${data.year} contribution calendar`}>
        <div className="calendar-layout">
          <div
            className="calendar-months"
            aria-hidden="true"
            style={{ gridTemplateColumns: `repeat(${data.weeks.length}, 14px)` }}
          >
            {data.months.map((month) => {
              const weekIndex = Math.max(
                0,
                data.weeks.findIndex(
                  (week, index) =>
                    week.firstDay <= month.firstDay &&
                    (data.weeks[index + 1]?.firstDay ?? '9999') > month.firstDay,
                ),
              );
              return (
                <span key={`${month.year}-${month.firstDay}`} style={{ gridColumn: weekIndex + 1 }}>
                  {month.name}
                </span>
              );
            })}
          </div>
          <div className="calendar-weekdays" aria-hidden="true">
            <span>Sun</span>
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
          </div>
          <div
            role="grid"
            aria-label="GitHub contributions and commit plan"
            className="calendar-weeks"
          >
            {Array.from({ length: 7 }, (_, weekday) => (
              <div
                role="row"
                className="calendar-week"
                key={weekday}
                style={{ gridTemplateColumns: `repeat(${data.weeks.length}, 14px)` }}
              >
                {data.weeks.map((week) => {
                  const day = week.contributionDays.find((item) => item.weekday === weekday);
                  if (!day)
                    return (
                      <span
                        role="gridcell"
                        aria-hidden="true"
                        className="calendar-empty"
                        key={week.firstDay}
                      />
                    );
                  const index = dayIndexes.get(day.date)!;
                  const count = plannedCounts[day.date] ?? 0;
                  const isFuture = day.date > today;
                  const isSelected = selected.has(day.date);
                  const isPublished = published.has(day.date);
                  const isFailed = failed.has(day.date);
                  const description = `${day.date}, ${day.contributionCount} contributions, ${count} planned commits${isPublished ? ', published and awaiting verification' : ''}${isFailed ? ', publication failed' : ''}`;
                  return (
                    <Tooltip.Root key={day.date}>
                      <Tooltip.Trigger asChild>
                        <button
                          ref={(node) => {
                            cells.current[index] = node;
                          }}
                          role="gridcell"
                          type="button"
                          className="calendar-day"
                          data-level={levels[day.level]}
                          data-planned={count > 0 || undefined}
                          data-published={isPublished || undefined}
                          data-failed={isFailed || undefined}
                          data-selected={isSelected || undefined}
                          aria-label={description}
                          aria-selected={isSelected}
                          aria-disabled={isFuture}
                          tabIndex={index === focusIndex ? 0 : -1}
                          onKeyDown={(event) => handleKey(event, index)}
                          onPointerDown={(event) => handlePointerDown(event, index)}
                          onPointerEnter={() => {
                            if (dragging.current && anchor.current !== null)
                              selectRange(anchor.current, index);
                          }}
                          onClick={(event) => {
                            if (event.detail === 0 && !isFuture) selectRange(index, index);
                          }}
                        >
                          {count > 0 && (
                            <span className="calendar-count" aria-hidden="true">
                              {count}
                            </span>
                          )}
                          {isFailed && <span className="calendar-error-dot" aria-hidden="true" />}
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content className="calendar-tooltip" sideOffset={8}>
                          {description}
                          <Tooltip.Arrow className="tooltip-arrow" />
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  );
}
