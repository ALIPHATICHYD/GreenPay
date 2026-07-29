// __mocks__/@react-native-community/netinfo.js
const NetInfo = {
  addEventListener: jest.fn().mockImplementation(() => jest.fn()),
  fetch: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }),
};

module.exports = NetInfo;
module.exports.default = NetInfo;
