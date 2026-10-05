import * as Notifications from 'expo-notifications'
import { localDateFrom } from './repo'

/**
 * "You haven't logged today" reminders.
 *
 * Meal/weight data is local-only (SQLite, never synced to the backend --
 * see lib/db.ts), so a server-side cron can't know who's gone quiet. The
 * alternative of only rescheduling on app-open would only ever reach
 * people who already came back, missing exactly the person this is meant
 * to reach. Instead this schedules a handful of days of local
 * notifications in advance every time the app opens, so someone who
 * doesn't open the app for a few days still gets nudged. Each day's
 * notification has a deterministic identifier (its local date), so
 * logging a meal for that day can cancel that one specific reminder
 * without touching the others.
 */

const REMINDER_HOUR = 19
const LOOKAHEAD_DAYS = 5

function identifierFor(localDate: string): string {
  return `daily-log-reminder-${localDate}`
}

/** Called from app/camera.tsx right after a meal is actually saved, so someone who already logged doesn't get nagged later that day. ensureDailyReminders (Today's own focus effect) also cancels today's reminder on its next reload as a backstop, but that could be minutes away -- this cancels it the moment it's no longer needed. */
export async function cancelReminderFor(localDate: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(identifierFor(localDate)).catch(() => {})
}

/**
 * Re-run on every app open (Today screen load). Only schedules against
 * permission already granted via Profile's notification toggle -- this
 * never itself prompts for permission.
 *
 * Fire times are scheduled as absolute instants computed from the
 * device's local time *right now* -- a fighter who crosses timezones
 * mid-cut (a real scenario for this audience) could have an
 * already-queued day fire at the old zone's 7pm instead of the new one's.
 * Not specifically corrected for, but self-healing in practice: every
 * app open re-derives all `LOOKAHEAD_DAYS` fire times from the device's
 * current zone and overwrites the same deterministic identifiers, so at
 * most one already-queued day (the one closest to firing) can be off by a
 * few hours, not a growing drift.
 */
export async function ensureDailyReminders(todayAlreadyLogged: boolean): Promise<void> {
  const permission = await Notifications.getPermissionsAsync()
  if (permission.status !== 'granted') return

  const now = new Date()
  for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
    const fireAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, REMINDER_HOUR, 0, 0)
    const localDate = localDateFrom(fireAt.getTime())
    const id = identifierFor(localDate)

    if (fireAt.getTime() <= now.getTime() || (i === 0 && todayAlreadyLogged)) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
      continue
    }

    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title: "You haven't logged today", body: 'Takes 10 seconds. Snap a photo and keep your cut on track.' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
    }).catch(() => {})
  }
}
