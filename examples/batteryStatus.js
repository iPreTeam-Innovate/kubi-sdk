// kubi.batteryStatus
// The latest battery status reported by the device, or null while disconnected.
export default async function (kubi) {
  console.log(kubi.batteryStatus);   // { charging: false, low: false }
}
