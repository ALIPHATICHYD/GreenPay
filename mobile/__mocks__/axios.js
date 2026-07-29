const axios = {
  get: jest.fn(),
  post: jest.fn(),
  create: jest.fn(() => axios),
  defaults: { headers: { common: {} } },
  // @stellar/stellar-sdk registers a response interceptor on its Horizon
  // axios instance at module-load time (server.js -> horizon_axios_client.js).
  // Without these, simply importing @stellar/stellar-sdk in a test file
  // throws "Cannot read properties of undefined (reading 'response')".
  interceptors: {
    request: { use: jest.fn(), eject: jest.fn() },
    response: { use: jest.fn(), eject: jest.fn() },
  },
};
module.exports = axios;
module.exports.default = axios;
