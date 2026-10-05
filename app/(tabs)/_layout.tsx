import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { promptAddMeal } from '../../lib/addMeal'
import { ProgressTabIcon } from '../../lib/components/ProgressTabIcon'
import { radius, spacing, useTheme } from '../../lib/theme'

// Ionicons instead of emoji: full-color emoji glyphs ignore RN's `color`
// style entirely (fire/people/etc. render in their own fixed colors no
// matter what), which was quietly breaking the app's monochrome rule right
// in the one place a user sees on every screen — the tab bar itself.
function TabIcon({ name, focused, color }: { name: keyof typeof Ionicons.glyphMap; focused: boolean; color: string }) {
  return <Ionicons name={name} size={22} color={color} style={{ opacity: focused ? 1 : 0.7 }} />
}

export default function TabsLayout() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.text,
          tabBarInactiveTintColor: theme.textFaint,
          tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Today',
            tabBarIcon: ({ focused, color }) => <TabIcon name={focused ? 'flame' : 'flame-outline'} focused={focused} color={color} />,
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: 'Progress',
            tabBarIcon: ({ focused }) => <ProgressTabIcon focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="fighters"
          options={{
            title: 'Fighters',
            tabBarIcon: ({ focused, color }) => <TabIcon name={focused ? 'trophy' : 'trophy-outline'} focused={focused} color={color} />,
          }}
        />
        <Tabs.Screen
          name="groups"
          options={{
            title: 'Groups',
            tabBarIcon: ({ focused, color }) => <TabIcon name={focused ? 'people' : 'people-outline'} focused={focused} color={color} />,
          }}
        />
        {/* Hidden for now at Jean's request — core MVP focus first, not
            deleted, `href: null` keeps the route reachable (e.g. a future
            direct link) without showing it in the tab bar. Re-add a
            title/icon here to bring it back. */}
        <Tabs.Screen name="nutrition" options={{ href: null }} />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ focused, color }) => <TabIcon name={focused ? 'person' : 'person-outline'} focused={focused} color={color} />,
          }}
        />
      </Tabs>

      {/* Reachable from every tab, not just Today — adding a meal shouldn't
          require navigating to a specific screen first. Floats just above
          the tab bar, matching nut-ai's own persistent "+" placement. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add meal"
        onPress={promptAddMeal}
        style={{
          position: 'absolute', right: spacing.lg, bottom: insets.bottom + 78,
          width: 56, height: 56, borderRadius: radius.pill,
          backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center',
          shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 6,
        }}
      >
        <Ionicons name="add" size={30} color={theme.onPrimary} />
      </Pressable>
    </View>
  )
}
