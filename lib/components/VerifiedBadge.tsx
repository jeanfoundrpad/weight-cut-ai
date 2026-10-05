import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../theme'

/**
 * Shown next to a fighter's name wherever it appears, only when
 * claimedByUserId is set -- per Jean directly, once claiming became an
 * admin-approval flow (0036) rather than instant self-service, a claimed
 * profile genuinely means "a real person confirmed this and it was
 * reviewed," which is exactly what a verified mark should promise. Fixed
 * blue, not themed -- a verification mark, not a design accent.
 */
export function VerifiedBadge({ size = 15 }: { size?: number }) {
  const theme = useTheme()
  return <Ionicons name="checkmark-circle" size={size} color={theme.isDark ? '#4DA3FF' : '#1D7FE0'} style={{ marginLeft: 4 }} />
}
