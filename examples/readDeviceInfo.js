// kubi.readDeviceInfo()
// Read the Device Information service (0x180A).
export default async function (kubi) {
  const info = await kubi.readDeviceInfo();
  console.log(info.serialNumber);       // "EFC55E"
  console.log(info.modelNumber);        // "iPre-K"
  console.log(info.manufacturer);       // "iPresence Co., Ltd."
  console.log(info.hardwareRevision);   // "1.0.0"
  console.log(info.firmwareRevision);   // "1.1.1"
}
