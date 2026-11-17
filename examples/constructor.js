// new Kubi(transport)
// Create an instance on your own transport (for tests, or for something other than Web Bluetooth).
// The instance reports what your transport can do.
import { Kubi } from 'kubi-sdk';

export default async function () {
  const myTransport = {
    capabilities: { providesDevicePicker: false, canScan: false },
    availability: 'unknown',
    onAvailabilityChange: () => () => {},
    pick: async () => ({ ok: false, reason: 'couldNotConnect' }),
  };
  const kubi = new Kubi(myTransport);
  console.log(kubi.capabilities);   // { providesDevicePicker: false, canScan: false }
}
