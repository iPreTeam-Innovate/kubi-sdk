// Kubi.forBrowser()
// Create an instance that uses Web Bluetooth. A new instance is not connected yet.
import { Kubi } from 'kubi-sdk';

export default async function () {
  const kubi = Kubi.forBrowser();
  console.log(kubi.connectionState);   // "disconnected"
}
