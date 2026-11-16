const riyadhCalendar = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short', timeZone: 'Asia/Riyadh' });

export const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
export const riyadhDate = (instant: Date) => riyadhCalendar.format(instant);
