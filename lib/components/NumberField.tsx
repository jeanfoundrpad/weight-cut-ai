import { useId } from 'react'
import { InputAccessoryView, Keyboard, Platform, Pressable, Text, TextInput, View } from 'react-native'
import { radius, spacing, type, useTheme } from '../theme'

/**
 * iOS never shows a Return/Done key on numeric keyboards (decimal-pad,
 * number-pad, etc.) — a platform restriction, not something any app can
 * configure around. Without an explicit dismiss control the keyboard just
 * sits there permanently covering the screen once you've typed a digit.
 * `InputAccessoryView` is the standard fix: a small bar docked above the
 * keyboard with its own Done button. Each field gets its own via a unique
 * id (React's useId) so multiple NumberFields on one screen don't collide.
 */
export function NumberField({
  label, unit, value, onChange, placeholder,
}: {
  label: string
  unit: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const theme = useTheme()
  const accessoryId = useId()

  return (
    <View style={{ marginBottom: spacing.lg }}>
      {label ? <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>{label}</Text> : null}
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
          backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
          paddingHorizontal: spacing.lg, minHeight: 56,
        }}
      >
        <TextInput
          keyboardType="decimal-pad"
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={theme.textFaint}
          accessibilityLabel={`${label || unit} field`}
          inputAccessoryViewID={Platform.OS === 'ios' ? accessoryId : undefined}
          style={[type.bodyStrong, { flex: 1, color: theme.text, fontSize: 20, paddingVertical: spacing.md }]}
        />
        {unit ? <Text style={[type.body, { color: theme.textMuted }]}>{unit}</Text> : null}
      </View>

      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={accessoryId}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: spacing.sm, backgroundColor: theme.surfaceRaised }}>
            <Pressable accessibilityRole="button" onPress={Keyboard.dismiss} hitSlop={spacing.md}>
              <Text style={[type.bodyStrong, { color: theme.primary }]}>Done</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </View>
  )
}
