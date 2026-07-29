// __mocks__/jail-monkey.js
// Matches jail-monkey's real shape: a plain object of functions exported as
// the module's default export (`import JailMonkey from 'jail-monkey'`).
const JailMonkey = {
  isJailBroken: jest.fn(() => false),
  jailBrokenMessage: jest.fn(() => ''),
  hookDetected: jest.fn(() => false),
  canMockLocation: jest.fn(() => false),
  trustFall: jest.fn(() => false),
  isOnExternalStorage: jest.fn(() => false),
  isDebuggedMode: jest.fn(() => false),
  isDevelopmentSettingsMode: jest.fn(() => Promise.resolve(false)),
  AdbEnabled: jest.fn(() => false),
};

module.exports = JailMonkey;
