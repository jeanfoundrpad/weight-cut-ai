import { useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { radius, spacing, type, useTheme } from '../theme'

// Required only on native — this module has no web implementation, and a
// static import would pull it into the web bundle regardless of what's
// rendered. Guarding the require() itself, not just the render, avoids any
// chance of a module-load-time crash on web.
const DateTimePicker = Platform.OS !== 'web' ? require('@react-native-community/datetimepicker').default : null

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * Generic swipeable date field — swipeable native wheel inline on iOS
 * (matching the Cal AI reference), tap-to-open native spinner dialog on
 * Android (that platform's own convention, not an always-visible inline
 * wheel), plain HTML date input on web so the Chrome test tier still works.
 *
 * Deliberately not a hand-built scrollable wheel: a custom ScrollView-driven
 * picker on this exact stack caused a multi-hour gesture-bug saga on an
 * earlier app (nested-scroll conflicts, then a Reanimated-worklets crash
 * trying to fix it, since worklets don't run in Expo Go). This uses the
 * platform's own native picker component instead — verified to actually be
 * bundled with Expo Go for standard usage (unlike that Reanimated
 * dependency), so it doesn't carry the same risk.
 *
 * Callers should default `value` to a real Date rather than `null` if they
 * want their Continue/submit button enabled immediately — native pickers
 * only call `onChange` once the user actually touches them, so a `null`
 * initial value silently blocks validation until the user happens to swipe,
 * even though the wheel already shows *something* selected.
 */
export function DatePickerField({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
}: {
  label: string
  value: Date | null
  onChange: (d: Date) => void
  minimumDate: Date
  maximumDate: Date
}) {
  const theme = useTheme()
  const [androidPickerOpen, setAndroidPickerOpen] = useState(false)
  const current = value ?? maximumDate

  if (Platform.OS === 'web') {
    return (
      <View style={{ marginBottom: spacing.lg }}>
        <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>{label}</Text>
        {/* eslint-disable-next-line react/no-unknown-property -- plain DOM input, web-only branch */}
        <input
          type="date"
          value={value ? isoDate(value) : ''}
          max={isoDate(maximumDate)}
          min={isoDate(minimumDate)}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            if (e.target.value) onChange(new Date(e.target.value))
          }}
          style={{
            backgroundColor: theme.surface,
            borderRadius: radius.md,
            border: `1px solid ${theme.border}`,
            padding: spacing.md,
            color: theme.text,
            fontSize: 16,
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
      </View>
    )
  }

  if (Platform.OS === 'ios') {
    return (
      <View style={{ marginBottom: spacing.lg }}>
        <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>{label}</Text>
        <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.border }}>
          <DateTimePicker
            value={current}
            mode="date"
            display="spinner"
            maximumDate={maximumDate}
            minimumDate={minimumDate}
            onChange={(_: unknown, d?: Date) => d && onChange(d)}
            textColor={theme.text}
          />
        </View>
      </View>
    )
  }

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setAndroidPickerOpen(true)}
        style={{
          backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1,
          borderColor: theme.border, padding: spacing.md,
        }}
      >
        <Text style={[type.body, { color: value ? theme.text : theme.textFaint }]}>
          {value ? formatDate(value) : `Select ${label.toLowerCase()}`}
        </Text>
      </Pressable>
      {androidPickerOpen ? (
        <DateTimePicker
          value={current}
          mode="date"
          display="spinner"
          maximumDate={maximumDate}
          minimumDate={minimumDate}
          onChange={(_: unknown, d?: Date) => {
            setAndroidPickerOpen(false)
            if (d) onChange(d)
          }}
        />
      ) : null}
    </View>
  )
}
