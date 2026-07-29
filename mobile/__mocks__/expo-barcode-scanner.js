// __mocks__/expo-barcode-scanner.js
const React = require('react');
const { View } = require('react-native');

function BarCodeScanner(props) {
  return React.createElement(View, { testID: 'mock-barcode-scanner', ...props });
}

BarCodeScanner.Constants = {
  BarCodeType: { qr: 'qr' },
  Type: { back: 'back', front: 'front' },
};

BarCodeScanner.ConversionTables = { type: {} };

BarCodeScanner.requestPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
BarCodeScanner.getPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });

module.exports = { BarCodeScanner };
