// kubi.capabilities
// What the transport can do. With Web Bluetooth the browser shows the device chooser.
export default async function (kubi) {
  console.log(kubi.capabilities);   // { providesDevicePicker: true, canScan: false }
}
