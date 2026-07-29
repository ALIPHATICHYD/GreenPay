const axios = {
  get: jest.fn(),
  post: jest.fn(),
  create: jest.fn(() => axios),
  defaults: { headers: { common: {} } },
  // @stellar/stellar-sdk registers a response interceptor on the client
  // returned by axios.create() at import time (horizon_axios_client.js).
  // Without this shape, any test that pulls in the stellar-sdk barrel
  // (directly or via a component that imports it) crashes at require time.
  interceptors: {
    request: { use: jest.fn(), eject: jest.fn() },
    response: { use: jest.fn(), eject: jest.fn() },
  },
};
module.exports = axios;
module.exports.default = axios;
