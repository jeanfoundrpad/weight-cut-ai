import { Pressable, Text, View } from 'react-native'
import { radius, spacing, type, useTheme } from '../theme'

export function OptionRow<T extends string>({
  options, value, onChange, label,
}: {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
  label: string
}) {
  const theme = useTheme()
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {options.map((o) => {
          const active = o.value === value
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(o.value)}
              style={{
                paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.pill,
                backgroundColor: active ? theme.text : theme.surface,
                borderWidth: 1, borderColor: active ? theme.text : theme.border,
              }}
            >
              <Text style={[type.body, { color: active ? theme.bg : theme.text, fontWeight: active ? '700' : '400' }]}>
                {o.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}
