// __mocks__/expo-secure-store.js
const store = {};

module.exports = {
  getItemAsync: jest.fn().mockImplementation((key) => Promise.resolve(store[key] ?? null)),
  setItemAsync: jest.fn().mockImplementation((key, value) => {
    store[key] = value;
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn().mockImplementation((key) => {
    delete store[key];
    return Promise.resolve();
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  __store: store,
};
