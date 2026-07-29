/**
 * components/SecurityWarningBanner.tsx
 *
 * Advisory-only banner shown when the device appears to be jailbroken or
 * rooted while a wallet is connected. This is defense-in-depth, not a
 * gate: jailbreak/root detection has known false positives, so the banner
 * is dismissible and never disables or blocks any surrounding content.
 * Dismissal state is intentionally local/unpersisted so the warning
 * reappears each app session, which is the desired security salience.
 */
import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export function SecurityWarningBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.message}>
        This device appears to be jailbroken or rooted. Your wallet key may be
        less secure on this device. Proceed with caution.
      </Text>
      <TouchableOpacity
        onPress={() => setDismissed(true)}
        accessibilityRole="button"
        accessibilityLabel="Dismiss security warning"
        style={styles.dismissButton}
      >
        <Text style={styles.dismissText}>Dismiss</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#7a1f1f',
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  message: {
    flex: 1,
    color: '#ffffff',
    fontSize: 13,
    marginRight: 12,
  },
  dismissButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  dismissText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
});
