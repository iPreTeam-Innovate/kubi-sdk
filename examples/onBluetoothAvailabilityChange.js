// kubi.onBluetoothAvailabilityChange(callback)
// Be told when Bluetooth becomes available or unavailable.
// Turn Bluetooth off and on within 10 seconds.
export default async function (kubi) {
  const unsubscribe = kubi.onBluetoothAvailabilityChange((availability) => console.log(availability));   // "unavailable"
  await new Promise((resolve) => setTimeout(resolve, 10000));
  unsubscribe();
}
