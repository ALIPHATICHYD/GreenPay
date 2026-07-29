const axios = {
  get: jest.fn(),
  post: jest.fn(),
  create: jest.fn(() => axios),
  defaults: { headers: { common: {} } },
  // @stellar/stellar-sdk's horizon client registers a response interceptor
  // at import time (`AxiosClient.interceptors.response.use(...)`), so any
  // test importing from '@stellar/stellar-sdk' needs this shape present on
  // the mock, even if it never triggers an actual HTTP call.
  interceptors: {
    request: { use: jest.fn(), eject: jest.fn() },
    response: { use: jest.fn(), eject: jest.fn() },
  },
};
module.exports = axios;
module.exports.default = axios;
