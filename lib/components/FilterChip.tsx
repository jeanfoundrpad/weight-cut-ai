import { Pressable, Text } from 'react-native'
import { radius, spacing, type, useTheme } from '../theme'

/** Shared pill filter control -- was local to the Fighters tab, now also used on the weight-class roster's sex filter. */
export function FilterChip({ label, active, onPress, theme }: { label: string; active: boolean; onPress: () => void; theme: ReturnType<typeof useTheme> }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: active ? theme.primary : theme.border, backgroundColor: active ? theme.primary : 'transparent',
      }}
    >
      <Text style={[type.caption, { color: active ? theme.onPrimary : theme.text, fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  )
}
