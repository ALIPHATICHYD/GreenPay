/**
 * __tests__/SecurityWarningBanner.test.tsx
 *
 * Covers the dismiss behaviour of the advisory jailbreak/root warning
 * banner, and confirms it renders as a plain, non-blocking overlay
 * alongside other content (no modal/disabling behaviour).
 */
import React from 'react';
import { Text, View } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { SecurityWarningBanner } from '../components/SecurityWarningBanner';

test('renders the warning copy and a dismiss action', () => {
  const { getByText } = render(<SecurityWarningBanner />);

  expect(
    getByText(/This device appears to be jailbroken or rooted/i),
  ).toBeTruthy();
  expect(getByText('Dismiss')).toBeTruthy();
});

test('dismissing the banner removes it from the tree', () => {
  const { getByText, queryByText } = render(<SecurityWarningBanner />);

  fireEvent.press(getByText('Dismiss'));

  expect(queryByText(/This device appears to be jailbroken or rooted/i)).toBeNull();
  expect(queryByText('Dismiss')).toBeNull();
});

test('does not block or disable sibling content', () => {
  const onPress = jest.fn();
  const { getByText } = render(
    <View>
      <SecurityWarningBanner />
      <Text onPress={onPress}>Continue to app</Text>
    </View>,
  );

  fireEvent.press(getByText('Continue to app'));

  expect(onPress).toHaveBeenCalledTimes(1);
});
