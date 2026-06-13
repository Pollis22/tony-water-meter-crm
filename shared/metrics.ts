// Tony's field-activity metrics — shared between server tallies and client UI.
// Daily targets come from his printed scorecard; week/month/year targets are
// derived (5 workdays, ~21 workdays, ~250 workdays).

export const METRICS = [
  { key: "face_to_face", label: "Face-to-Face Stops", pick: "Face-to-face visit", target: 5 },
  { key: "real_conversation", label: "Real Conversations", pick: "Actual conversation", target: 3 },
  { key: "follow_up", label: "Follow-Ups", pick: "Follow-up", target: 5 },
  { key: "secondary_call", label: "Secondary Calls", pick: "Secondary call", target: 3 },
  { key: "meeting_set", label: "Meetings Set", pick: "Appointment confirmed", target: 2 },
] as const;

export type MetricKey = (typeof METRICS)[number]["key"];
export const METRIC_KEYS = METRICS.map((m) => m.key) as MetricKey[];

export const DEFAULT_DAILY_TARGETS: Record<MetricKey, number> =
  Object.fromEntries(METRICS.map((m) => [m.key, m.target])) as Record<MetricKey, number>;

export const PERIOD_MULTIPLIER = { day: 1, week: 5, month: 21, year: 250 } as const;
export type Period = keyof typeof PERIOD_MULTIPLIER;

/** Sensible default metric for each quick-log outcome chip (overridable in the dialog). */
export const OUTCOME_DEFAULT_METRIC: Record<string, MetricKey | null> = {
  visit: "face_to_face",
  spoke: "real_conversation",
  meeting: "meeting_set",
  email: "follow_up",
  voicemail: null,
  no_answer: null,
};
