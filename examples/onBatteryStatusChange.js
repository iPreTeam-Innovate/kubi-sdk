// kubi.onBatteryStatusChange(callback)
// Be told when the battery status changes. Plug in or unplug the USB cable within 10 seconds.
export default async function (kubi) {
  const unsubscribe = kubi.onBatteryStatusChange((status) => console.log(status));   // { charging: true, low: false }
  await new Promise((resolve) => setTimeout(resolve, 10000));
  unsubscribe();
}
