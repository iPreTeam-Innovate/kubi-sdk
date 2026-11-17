// kubi.dispose()
// Release an instance for good. Every later call on it fails.
// This example uses its own instance, so the one on this page stays usable.
import { Kubi } from 'kubi-sdk';

export default async function () {
  const kubi = Kubi.forBrowser();
  await kubi.dispose();
  try {
    await kubi.readPan();
  } catch (error) {
    console.log(error.name);   // "KubiDisposedError"
  }
}
