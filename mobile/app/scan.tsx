/**
 * app/scan.tsx
 * Expo Router entry point for the QR scanner. Thin wrapper — all scanning
 * and validation logic lives in src/screens/QRScannerScreen.tsx.
 */
import { QRScannerScreen } from '../src/screens/QRScannerScreen';

export default function ScanScreen() {
  return <QRScannerScreen />;
}
