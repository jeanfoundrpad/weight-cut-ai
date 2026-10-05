import { Alert } from 'react-native'
import { router } from 'expo-router'

/**
 * Shared by the tab-bar "+" button and the Today screen's "Add Meal"
 * button — a small popup, not a dedicated screen, so choosing how to add a
 * meal doesn't cost a full navigation before the user even sees an option.
 * The choice travels to camera.tsx as a route param so it can jump straight
 * to the right starting state instead of asking again once there.
 */
export function promptAddMeal(): void {
  Alert.alert('Add a meal', undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Scan with camera', onPress: () => router.push({ pathname: '/camera', params: { mode: 'camera' } }) },
    { text: 'Add manually', onPress: () => router.push({ pathname: '/camera', params: { mode: 'manual' } }) },
    { text: 'Log a recent meal', onPress: () => router.push('/log-recent') },
  ])
}
